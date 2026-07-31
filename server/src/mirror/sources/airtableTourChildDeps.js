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
import { CAPACITY_STATUSES } from '../../tours/registrationStatus.js';
import { CHILD_TABLES, PARENT_LINK_FIELDS } from './airtableTourChildren.js';
import { normalizeCoordRow, normalizePayrollRow } from '../../migration/import/tourNormalize.js';
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
    /** The master tours row itself, by record id — used only to heal a
     *  crosswalk that was written without a payload. */
    async fetchMasterById(recId) {
      const key = `master:${recId}`;
      if (cache.has(key)) return cache.get(key);
      if (budget) budget.spend();
      const records = await client.listWhere('tblTI7iaGm6qsQA4a', {
        formula: `RECORD_ID()='${escapeFormulaValue(recId)}'`,
        maxRecords: 1,
      });
      cache.set(key, records);
      return records;
    },
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
      let raw = link?.payload || null;
      if (!raw) {
        // A crosswalked tour WITHOUT a stored master payload. Returning an empty
        // masterTour here made derive() produce an EMPTY desired set, and the
        // diff then "corrected" GOS by removing the whole roster — 27 bookings
        // and assignments were destroyed across 12 tours on 2026-07-30 by
        // exactly this. A missing payload is a data gap to HEAL, never a
        // statement that the tour has no children: fetch the master row live
        // (one request), persist it as the payload so the next recompute is
        // free, and only if even Airtable does not have the row let the
        // caller's no-master path defer.
        const rows = await fetcher.fetchMasterById(parentRecId);
        const rec = rows?.[0] || null;
        if (rec) {
          const f = rec.fields || {};
          raw = {
            recId: parentRecId,
            tourId: num(f.Tour_ID),
            name: t(f['שם']) || t(f.Name) || '',
            date: t(f['ת.סיור']) ? String(t(f['ת.סיור'])).slice(0, 10) : (t(f.DATE) ? String(t(f.DATE)).slice(0, 10) : null),
            startTime: t(f['שעת התחלה']),
            endTime: t(f['שעת סיום']),
            status: t(f['סטטוס']) || '',
            fields: f,
          };
          await (db || prisma).legacyRecord.update({
            where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: parentRecId } },
            data: { payload: raw },
          });
        }
      }
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

      // Each table's own link field — payroll's is `סיורים`. Hardcoding `שם סיור`
      // for both made every payroll fetch a 422.
      const [coordRaw, payrollRaw] = await Promise.all([
        fetcher.fetchTable(CHILD_TABLES.coordination, PARENT_LINK_FIELDS.coordination, parentRecId),
        fetcher.fetchTable(CHILD_TABLES.payroll, PARENT_LINK_FIELDS.payroll, parentRecId),
      ]);

      // The SAME mappers the importer uses. These rows feed planTourImport, so a
      // field name that differs by one character here produces an empty child set
      // and a recompute that looks like mass deletion at the source. masterRecId is
      // forced to the parent we fetched for: these rows were selected BY that link,
      // and a lookup column can echo a different record id.
      const coordRows = coordRaw.map((r) => ({ ...normalizeCoordRow(r), masterRecId: parentRecId }));
      const payrollRows = payrollRaw.map((r) => ({ ...normalizePayrollRow(r, parentRecId), masterRecId: parentRecId }));

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
    async personRefByEmail(db, payrollRows, coordRows = []) {
      // BOTH sources of guide emails. This map was built from payroll rows alone,
      // but planTourImport resolves ASSIGNMENT guides from the coordination rows'
      // guideEmail — so every coordination guide came back personRefId-less and
      // could never match the existing assignment it was supposed to represent.
      const emails = [...new Set([
        ...payrollRows.map((p) => p.guideEmail),
        ...coordRows.map((c) => c.guideEmail),
      ].filter(Boolean).map((e) => String(e).toLowerCase()))];
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
        // THE shared vocabulary, not a local copy — this list also decides
        // whether a booking may be auto-cancelled (protectRemoval), so a second
        // hand-maintained copy could silently disagree about what "holds a seat"
        // means and start releasing live bookings again.
        where: { tourEventId, status: { in: CAPACITY_STATUSES } },
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
     * money.
     *
     * Payroll never reaches this function at all: the adapter's protectRemoval
     * routes a vanished payroll row into a CONFLICT, so it is neither deleted
     * nor silently retained. If one ever arrives here it is a bug, and it throws
     * rather than quietly doing the wrong thing.
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
          //
          // `cancelledAt` is NOT optional. A cancelled booking without a
          // timestamp is an impossible state: it is indistinguishable from a
          // genuine cancellation while carrying none of its meaning, and it is
          // what made the 2026-07-31 incident take an hour to diagnose instead
          // of a minute. A DB CHECK constraint now enforces this too.
          //
          // Reaching here at all means the booking owns NO capacity-holding
          // registrations — protectRemoval routes those to a conflict — so
          // there are no seats to release.
          await client.booking.update({
            where: { id: r.id },
            data: { status: 'cancelled', cancelledAt: new Date() },
          });
        } else if (r.kind === 'assignment') {
          await client.tourAssignment.delete({ where: { id: r.id } });
        } else if (r.kind === 'payroll') {
          const e = new Error('payroll_removal_must_be_a_conflict: protectRemoval should have routed this to a conflict, never to applyDiff');
          e.code = 'PAYROLL_REMOVAL_LEAKED';
          throw e;
        }
      }
    },

    _phoneNormalizer: normalizePhoneIntl,
  };
}
