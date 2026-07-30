// Airtable child-table adapter — parent_recompute mode.
//
// Coordination rows, participant rows and guide/payroll rows all describe parts
// of ONE tour. None of them is 1:1 with a GOS row: several coordination rows for
// the same deal collapse into a single Booking with summed seats, guides are a
// SET reconciled by identity, and a change can add or remove rows rather than
// alter a field. So a change to any of them is applied by recomputing the tour's
// whole derived set — the generic parent_recompute shape.
//
// THE DERIVATION IS NOT REIMPLEMENTED HERE.
//
// planTourImport() already turns (masterTour, coordRows, payrollRows) into
// bookings, registrations, guide assignments and payroll, including deal
// resolution by legacy id, merge-by-deal, seat summing and PersonRef resolution.
// That logic is owner-approved and battle-tested against 2,473 real tours.
// Writing a second version for the mirror would guarantee the two drift, and the
// drift would be silent. This adapter calls it with a ONE-tour population and
// reads the derived payload back out.

import { planTourImport } from '../../migration/import/tourImport.js';
import { MODE } from '../modes.js';

/** Airtable table id → the child kind it carries. */
export const CHILD_TABLES = Object.freeze({
  coordination: 'tbl1JaGS5oKRIkJ9z',
  participants: 'tbll83BjS4kLMRNuh',
  payroll: 'tbli0eBDJ6CgCj4iJ',
});

const first = (v) => (Array.isArray(v) ? v[0] : v);
const str = (v) => {
  const x = first(v);
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
};

/**
 * Every child row links to its master tour by an Airtable link field. The field
 * NAME differs per table, which is why the parent link is resolved by the
 * adapter (domain knowledge) and not by the engine.
 */
export const PARENT_LINK_FIELDS = Object.freeze({
  coordination: 'שם סיור',
  participants: 'שם סיור',
  payroll: 'שם סיור',
});

export function parentRecIdOf(payload, childKind) {
  const f = payload?.fields || {};
  const field = PARENT_LINK_FIELDS[childKind];
  return str(f[field]) || null;
}

/**
 * The child adapter.
 *
 * `deps` supplies everything that must come from live GOS state rather than
 * from this module — the tour fetcher, the crosswalks, and the child fetcher
 * that reads a parent's CURRENT children. Injected so the adapter is testable
 * without Airtable or a database, and so the fetcher can be a coalescing,
 * budget-aware one.
 */
export function tourChildrenAdapter({ childKind, deps = {} }) {
  return {
    mode: MODE.PARENT_RECOMPUTE,
    parentSourceType: 'tour',
    childKind,
    conflictFieldLabel: 'מקומות בהזמנה',

    /** Child event → the master tour, resolved through the tour crosswalk. */
    async resolveParent(db, event) {
      const recId = parentRecIdOf(event.rawPayload, childKind);
      if (!recId) return null;
      const link = await db.legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: recId } },
        select: { entityId: true, entityType: true, payload: true },
      });
      if (!link?.entityId) return null;
      return { sourceId: recId, entityId: link.entityId, entityType: 'tourEvent', masterPayload: link.payload };
    },

    /**
     * The DESIRED set, derived by the shared importer.
     *
     * planTourImport is called with a single-tour population. It is a pure
     * planner — it computes payloads and never writes — so using it here is
     * reuse, not a side effect.
     */
    async derive(db, parent) {
      const { masterTour, coordRows, payrollRows } = await deps.loadTourChildren(db, parent.sourceId);
      if (!masterTour) return [];

      const plan = planTourImport({
        masterTours: [masterTour],
        coordRows,
        payrollRows,
        dealXwalk: await deps.dealXwalk(db, coordRows),
        dealMetaByLegacyId: await deps.dealMeta(db, coordRows),
        personRefByEmail: await deps.personRefByEmail(db, payrollRows),
        // Deliberately EMPTY: the "already imported" short-circuit exists to stop
        // Wave 1 re-importing. Here we WANT the derivation for a tour that is
        // already imported, so it must not be filtered out.
        existingTourXwalk: new Map(),
        today: deps.today ? deps.today() : new Date(),
      });

      const payload = (plan.payloads || [])[0];
      if (!payload) return [];

      // Flatten the derived payload into one comparable set. Each member carries
      // its kind so identity and equality stay unambiguous across kinds.
      const set = [];
      for (const b of payload.bookings || []) {
        set.push({ kind: 'booking', dealId: b.gosDealId, seats: b.seats, registrations: b.registrations || [] });
      }
      for (const g of payload.guides || []) {
        set.push({ kind: 'assignment', personRefId: g.personRefId || null, externalPersonId: g.externalPersonId || null, role: g.role || null });
      }
      for (const p of payload.payroll || []) {
        set.push({ kind: 'payroll', externalPersonId: p.externalPersonId || null, displayName: p.displayName || null, amountMinor: p.totalPreVatMinor ?? null });
      }
      return set;
    },

    /** The CURRENT set, read from GOS in the same shape. */
    async loadCurrent(db, parent) {
      return deps.loadCurrentSet(db, parent.entityId);
    },

    // Identity is domain knowledge: a booking is identified by its deal, an
    // assignment by the person, payroll by the person.
    keyOf(m) {
      if (m.kind === 'booking') return `booking:${m.dealId}`;
      if (m.kind === 'assignment') return `assignment:${m.personRefId || m.externalPersonId}`;
      return `payroll:${m.externalPersonId || m.displayName}`;
    },

    sameOf(a, b) {
      if (a.kind !== b.kind) return false;
      if (a.kind === 'booking') return Number(a.seats ?? 0) === Number(b.seats ?? 0);
      if (a.kind === 'assignment') return (a.role ?? null) === (b.role ?? null);
      return Number(a.amountMinor ?? 0) === Number(b.amountMinor ?? 0);
    },

    /**
     * THE protection rule.
     *
     * A recompute must never destroy local truth. Airtable saying "20 seats"
     * cannot silently overwrite a booking whose 22 seats include registrations
     * GOS created itself, and it must never drop below what is already
     * registered — that would orphan a paying customer's seat.
     */
    protect(current, desired) {
      if (desired.kind !== 'booking') return desired;
      const registered = (current.registrations || []).reduce((n, r) => n + Number(r ?? 0), 0);
      if (Number(desired.seats ?? 0) < registered) return 'conflict';
      return desired;
    },

    describeParent: (parent) => ({ label: parent.sourceId }),

    /** Apply the diff. The ONLY writer, and it writes nothing else. */
    async applyDiff(db, parent, diff) {
      return deps.applyDiff(db, parent, diff);
    },
  };
}

/** Child kind ← Airtable table id, for the poller. */
export function childKindForTable(tableId) {
  for (const [kind, id] of Object.entries(CHILD_TABLES)) if (id === tableId) return kind;
  return null;
}
