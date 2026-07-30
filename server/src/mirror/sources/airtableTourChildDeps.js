// Live dependencies for the Airtable tour-child adapter.
//
// The adapter is pure translation + declaration; everything that touches the
// network or the database lives here, injected. That split is what lets the
// adapter be tested without an Airtable account and keeps the recompute logic
// free of I/O concerns.
//
// EFFICIENCY IS THE POINT OF THIS FILE. A recompute needs ALL of a parent's
// children, which is the expensive part, so:
//
//   * children are fetched per PARENT with a server-side filter, never by
//     scanning a table;
//   * the fetch is memoised per run, so the coalescer's single recompute per
//     parent costs one fetch even when several kinds changed;
//   * deal and PersonRef crosswalks are resolved in ONE query for the whole
//     batch rather than per row (the N+1 the brief forbids);
//   * every request goes through the shared budget, so a bug cannot outspend
//     the ceiling.

import { normalizePhoneIntl } from '../../whatsapp/phone.js';
import { CHILD_TABLES } from './airtableTourChildren.js';
import { escapeFormulaValue } from './airtableClient.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);
const t = (v) => {
  const x = first(v);
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
};
const num = (v) => {
  const s = t(v);
  if (s === null) return null;
  const n = Number(String(s).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Fetch every child of ONE tour, filtered server-side by the parent link.
 *
 * One request per (table, parent) instead of a table scan. Memoised per run so
 * the coalescer's single recompute pays for the children once even when a
 * coordination row AND a payroll row both changed on the same tour.
 */
export function createChildFetcher({ client, budget = null, maxPerTable = 200 }) {
  const cache = new Map(); // `${table}:${parentRecId}` → records

  async function fetchTable(tableId, parentField, parentRecId) {
    const key = `${tableId}:${parentRecId}`;
    if (cache.has(key)) return cache.get(key);
    if (budget) budget.spend();

    // FIND on the link field: Airtable link fields stringify to the linked
    // record's primary-field value in a formula context, so a substring match
    // on the recId is the reliable server-side filter available here.
    const formula = `FIND('${escapeFormulaValue(parentRecId)}', ARRAYJOIN({${parentField}}))>0`;
    const records = await client.listWhere(tableId, { formula, maxRecords: maxPerTable });
    cache.set(key, records);
    return records;
  }

  return {
    reset() { cache.clear(); },
    get cached() { return cache.size; },
    fetchTable,
  };
}

/**
 * The dep bundle the adapter expects.
 *
 * `masterFromCrosswalk` is deliberate: the master tour's own fields were already
 * captured in the tour crosswalk payload at import time, so a recompute of a
 * CHILD change does not re-read the parent from Airtable. That removes one
 * request per recompute, and the parent's own changes arrive through the tours
 * poller in entity_merge mode anyway.
 */
export function createChildDeps({ fetcher, prisma, today = () => new Date() }) {
  return {
    today,

    async loadTourChildren(db, parentRecId) {
      const link = await (db || prisma).legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: parentRecId } },
        select: { payload: true },
      });
      const raw = link?.payload || null;
      if (!raw) return { masterTour: null, coordRows: [], payrollRows: [] };

      // Shape the crosswalked master record the way planTourImport expects. The
      // normaliser's own output was stored at import time, so this is a read of
      // captured truth rather than a second parsing of Airtable.
      const f = raw.fields || raw;
      const masterTour = {
        recId: parentRecId,
        tourId: num(f.Tour_ID ?? raw.tourId),
        name: t(f['שם'] ?? f.Name ?? raw.name) || '',
        date: t(raw.date ?? f.DATE),
        startTime: t(raw.startTime ?? f['שעת התחלה']),
        endTime: t(raw.endTime ?? f['שעת סיום']),
        status: t(raw.status ?? f['סטטוס']) || '',
        legacyCalendarId: null,
        cardExtras: [],
      };

      const [coordRaw, payrollRaw] = await Promise.all([
        fetcher.fetchTable(CHILD_TABLES.coordination, 'שם סיור', parentRecId),
        fetcher.fetchTable(CHILD_TABLES.payroll, 'שם סיור', parentRecId),
      ]);

      const coordRows = coordRaw.map((r) => {
        const cf = r.fields || {};
        return {
          recId: r.id,
          masterRecId: parentRecId,
          legacyDealId: num(cf['פייפ דיל ID']),
          seats: num(cf['משתתפים']),
          guideEmails: []
            .concat(cf['מייל מדריך'] || [])
            .map((e) => t(e))
            .filter(Boolean),
        };
      });

      const payrollRows = payrollRaw.map((r) => {
        const pf = r.fields || {};
        return {
          recId: r.id,
          masterRecId: parentRecId,
          guideName: t(pf['שם המדריך']),
          guideEmail: t(pf['מייל']),
          totalPreVatMinor: Math.round((num(pf['סה"כ לפני מעמ']) ?? 0) * 100),
          approved: !!first(pf['מאושר']),
        };
      });

      return { masterTour, coordRows, payrollRows };
    },

    /** ONE query for the whole batch of legacy deal ids — never per row. */
    async dealXwalk(db, coordRows) {
      const ids = [...new Set(coordRows.map((c) => c.legacyDealId).filter((v) => v != null).map(String))];
      if (!ids.length) return new Map();
      const rows = await (db || prisma).legacyRecord.findMany({
        where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: { in: ids }, entityId: { not: null } },
        select: { sourceId: true, entityId: true },
      });
      return new Map(rows.map((r) => [r.sourceId, r.entityId]));
    },

    /** ONE query for the activity types of those same deals. */
    async dealMeta(db, coordRows) {
      const ids = [...new Set(coordRows.map((c) => c.legacyDealId).filter((v) => v != null).map(String))];
      if (!ids.length) return new Map();
      const links = await (db || prisma).legacyRecord.findMany({
        where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: { in: ids }, entityId: { not: null } },
        select: { sourceId: true, entityId: true },
      });
      if (!links.length) return new Map();
      const deals = await (db || prisma).deal.findMany({
        where: { id: { in: links.map((l) => l.entityId) } },
        select: { id: true, activityType: true },
      });
      const byId = new Map(deals.map((d) => [d.id, d]));
      return new Map(links.map((l) => [l.sourceId, { activityType: byId.get(l.entityId)?.activityType ?? null }]));
    },

    /**
     * Guide identity by EMAIL — the resolution order the ownership map mandates
     * (externalPersonId first, email second, NEVER name). Resolved in one query.
     */
    async personRefByEmail(db, payrollRows) {
      const emails = [...new Set(payrollRows.map((p) => p.guideEmail).filter(Boolean).map((e) => e.toLowerCase()))];
      if (!emails.length) return new Map();
      const refs = await (db || prisma).personRef.findMany({
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true, externalPersonId: true },
      });
      return new Map(refs.map((r) => [String(r.email || '').toLowerCase(), r.id]));
    },

    /** The CURRENT derived set, read from GOS in the adapter's own shape. */
    async loadCurrentSet(db, tourEventId) {
      const client = db || prisma;
      const [bookings, assignments] = await Promise.all([
        client.booking.findMany({
          where: { tourEventId, status: 'active' },
          select: { id: true, dealId: true, seats: true },
        }),
        client.tourAssignment.findMany({
          where: { tourEventId },
          select: { id: true, personRefId: true, externalPersonId: true, role: true },
        }),
      ]);

      const regs = await client.ticketRegistration.findMany({
        where: { tourEventId, status: { in: ['held', 'confirmed', 'active'] } },
        select: { dealId: true, quantity: true },
      });
      const regsByDeal = new Map();
      for (const r of regs) {
        if (!r.dealId) continue;
        regsByDeal.set(r.dealId, [...(regsByDeal.get(r.dealId) || []), r.quantity]);
      }

      return [
        ...bookings.map((b) => ({
          kind: 'booking', id: b.id, dealId: b.dealId, seats: b.seats,
          // Feeds the seat guard: a recompute must never drop below what GOS has
          // already registered.
          registrations: regsByDeal.get(b.dealId) || [],
        })),
        ...assignments.map((a) => ({
          kind: 'assignment', id: a.id,
          personRefId: a.personRefId, externalPersonId: a.externalPersonId, role: a.role,
        })),
      ];
    },

    /**
     * Apply the diff. The ONLY writer in this file.
     *
     * Deliberately conservative about REMOVALS: a booking is not deleted, it is
     * cancelled, because payments and registrations hang off it and GOS owns
     * that history. An assignment genuinely can be removed — it carries no
     * money — but payroll never is, for the same reason as bookings.
     */
    async applyDiff(db, parent, diff) {
      const client = db || prisma;
      for (const m of diff.add) {
        if (m.kind === 'booking') {
          await client.booking.create({
            data: { tourEventId: parent.entityId, dealId: m.dealId, seats: m.seats ?? 0, status: 'active' },
          });
        } else if (m.kind === 'assignment') {
          await client.tourAssignment.create({
            data: {
              tourEventId: parent.entityId,
              personRefId: m.personRefId || null,
              externalPersonId: m.externalPersonId || null,
              role: m.role || 'guide',
            },
          });
        }
      }
      for (const u of diff.update) {
        if (u.to.kind === 'booking') {
          await client.booking.update({ where: { id: u.from.id }, data: { seats: u.to.seats ?? 0 } });
        } else if (u.to.kind === 'assignment') {
          await client.tourAssignment.update({ where: { id: u.from.id }, data: { role: u.to.role || 'guide' } });
        }
      }
      for (const r of diff.remove) {
        if (r.kind === 'booking') {
          // Cancelled, never deleted — payments and registrations hang off it.
          await client.booking.update({ where: { id: r.id }, data: { status: 'cancelled' } });
        } else if (r.kind === 'assignment') {
          await client.tourAssignment.delete({ where: { id: r.id } });
        }
        // payroll removals are deliberately ignored: approved pay is never
        // withdrawn by a sync.
      }
    },

    _phoneNormalizer: normalizePhoneIntl,
  };
}
