// Airtable → GOS mirror adapter + poller source.
//
// Airtable is polled, not pushed. Its webhooks do not cover every change type
// and give no trustworthy delete signal, so polling is the correctness
// mechanism here rather than a fallback — a missed change would otherwise be
// invisible forever.
//
// Two rules carried over verbatim from the Wave-1 migration, because they are
// the ones that cost real money if broken:
//
//   LAW 2  — a cancelled tour NEVER becomes an active GOS tour.
//   DATE GATE — a tour whose date will not parse is never guessed at and never
//               silently dropped; it is surfaced so a human resolves it.

import { readIsoDate } from '../../migration/import/tourNormalize.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);
const t = (v) => {
  const x = first(v);
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
};

// Airtable time fields arrive in several shapes across bases.
export function hhmm(v) {
  const s = t(v);
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

// The Hebrew status vocabulary, frozen at migration time.
const STATUS_MAP = Object.freeze({
  'מבוטל': 'cancelled',
  'בוטל': 'cancelled',
  'הושלם': 'completed',
  'בוצע': 'completed',
  'מתוכנן': 'scheduled',
  'נדחה': 'postponed',
});

export function mapStatus(raw) {
  const s = t(raw);
  if (!s) return null;
  return STATUS_MAP[s] || null;
}

export const CANCELLED_STATES = Object.freeze(['cancelled']);

/**
 * The TourEvent adapter. Only tours carrying an `airtable/tour` crosswalk are
 * mirrored — GOS-native tours are class G throughout and must not be touched.
 */
export function tourAdapter({ fieldMap = {} } = {}) {
  const F = {
    date: 'DATE',
    startTime: 'שעת התחלה',
    status: 'סטטוס',
    // NO capacity mapping. 'משתתפים בסיור' is the CURRENT PARTICIPANT COUNT,
    // not a capacity — mirroring it into TourEvent.capacity tried to shrink two
    // native group slots from 15 seats to their booked counts (caught as
    // conflicts by the 3-way merge on 2026-07-30). Legacy private tours have no
    // capacity concept; group-slot capacity is GOS-owned.
    notes: 'הערות',
    ...fieldMap,
  };

  return {
    sourceType: 'tour',

    async normalize(payload) {
      if (payload?.deleted === true) return { sourceDeleted: true, fields: {} };
      const f = payload?.fields || {};

      const parsed = readIsoDate(f[F.date]);
      const fields = {};

      // DATE GATE — an unusable date is never guessed at. Offering nothing for
      // the field leaves GOS as it is; the rejection is reported on the event.
      if (parsed.date) fields.date = parsed.date;

      const startTime = hhmm(f[F.startTime]);
      if (startTime) fields.startTime = startTime;

      const status = mapStatus(f[F.status]);
      if (status) fields.status = status;



      const notes = t(f[F.notes]);
      if (notes) fields.notes = notes;

      return {
        fields,
        dateRejected: parsed.date ? null : (parsed.reason || 'unparsable'),
        sourceStatus: status,
      };
    },

    async loadGos(db, id) {
      return db.tourEvent.findUnique({
        where: { id },
        select: { id: true, date: true, startTime: true, status: true, capacity: true, notes: true, locationId: true, tourLanguage: true },
      });
    },

    /**
     * LAW 2, enforced at the WRITE boundary as well as in the merge.
     * Defence in depth: even if a future change let a status through the merge,
     * a cancelled tour can never be revived here.
     */
    async applyGos(db, id, set) {
      const current = await db.tourEvent.findUnique({ where: { id }, select: { status: true } });
      const data = { ...set };
      if (current && CANCELLED_STATES.includes(current.status) && data.status && !CANCELLED_STATES.includes(data.status)) {
        delete data.status;
      }
      if (Object.keys(data).length) await db.tourEvent.update({ where: { id }, data });
    },

    describe: (gos) => ({ label: `${gos.date ?? ''} ${gos.startTime ?? ''}`.trim() }),
  };
}

/**
 * Poller source. `client.listModifiedSince(cursor)` must return
 * `{ records: [{ id, fields, lastModified }], nextCursor }`.
 *
 * Deliberately dependency-injected: the poller is fully testable without an
 * Airtable account, and the mirror never embeds a second Airtable HTTP client.
 */
export function airtableTourSource(client) {
  return {
    async fetchChanges(cursor) {
      const { records, nextCursor } = await client.listModifiedSince(cursor);
      return {
        records: records.map((r) => ({
          externalId: r.id,
          // lastModified is the version marker; without it every poll would
          // re-process every record forever.
          version: r.lastModified || null,
          payload: { id: r.id, fields: r.fields, lastModified: r.lastModified },
        })),
        nextCursor,
      };
    },
  };
}
