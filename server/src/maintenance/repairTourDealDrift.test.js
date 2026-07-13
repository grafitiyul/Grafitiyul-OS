import test from 'node:test';
import assert from 'node:assert/strict';
import { repairTourDealDrift } from './repairTourDealDrift.js';

// The one-time QA drift repair: aligns drifted Deal snapshots to the TourEvent,
// marks it dirty, backfills the impact — and is idempotent on repeat.

function makeDb({ tour, deals = {}, regs = [] }) {
  const tours = { [tour.id]: { ...tour } };
  const dl = Object.fromEntries(Object.entries(deals).map(([k, v]) => [k, { id: k, ...v }]));
  const issues = [];
  const reqs = [];
  let seq = 0;
  const nid = (p) => `${p}${++seq}`;
  return {
    _tours: tours, _deals: dl, _issues: issues,
    tourEvent: {
      findMany: async () => Object.values(tours).filter((t) => t.date === tour.date),
      update: async ({ where, data }) => { Object.assign(tours[where.id], data); return tours[where.id]; },
    },
    booking: { findMany: async () => Object.keys(dl).map((dealId) => ({ dealId })) },
    deal: {
      findUnique: async ({ where }) => dl[where.id] || null,
      update: async ({ where, data }) => { Object.assign(dl[where.id], data); return dl[where.id]; },
    },
    ticketRegistration: { findMany: async () => regs },
    tourAssignment: { count: async () => 0 },
    operationalIssue: {
      findFirst: async ({ where }) => issues.find((i) => i.dedupeKey === where.dedupeKey && ['open', 'acknowledged'].includes(i.status)) || null,
      findUnique: async ({ where }) => issues.find((i) => i.id === where.id) || null,
      create: async ({ data }) => { const r = { id: nid('iss'), status: 'open', ...data }; issues.push(r); return r; },
      update: async ({ where, data }) => { const i = issues.find((x) => x.id === where.id); Object.assign(i, data); return i; },
    },
    issueRequirement: {
      upsert: async ({ where, create }) => {
        const k = where.issueId_revision_kind;
        let r = reqs.find((x) => x.issueId === k.issueId && x.revision === k.revision && x.kind === k.kind);
        if (!r) { r = { id: nid('req'), state: 'pending', ...create }; reqs.push(r); }
        return r;
      },
    },
  };
}

const TOUR = { id: 'T1', kind: 'group_slot', status: 'scheduled', date: '2026-07-17', startTime: '10:45', tourLanguage: 'he', locationId: 'loc1' };

test('aligns a drifted deal to the tour, marks dirty, backfills impact — idempotent', async () => {
  const db = makeDb({
    tour: TOUR,
    deals: { d1: { tourDate: '2026-07-17', tourTime: '11:30', locationId: 'loc1' } }, // drifted
    regs: [{ id: 'r1', status: 'active', quantity: 2, customerName: 'x', customerEmail: 'x@x.com' }],
  });
  const first = await repairTourDealDrift(db, { dates: ['2026-07-17'], log: { log() {} } });
  assert.equal(first.deals.length, 1);
  assert.equal(db._deals.d1.tourTime, '10:45'); // aligned to the tour
  assert.equal(db._tours.T1.wooSyncStatus, 'pending'); // Woo marked dirty
  assert.equal(first.impacts.length, 1); // impact backfilled

  // Idempotent: second run finds no drift, changes nothing, no dup issue.
  const second = await repairTourDealDrift(db, { dates: ['2026-07-17'], log: { log() {} } });
  assert.equal(second.deals.length, 0);
  assert.equal(db._issues.length, 1);
});

test('a non-drifted deal is left untouched', async () => {
  const db = makeDb({ tour: TOUR, deals: { d1: { tourDate: '2026-07-17', tourTime: '10:45', locationId: 'loc1' } } });
  const r = await repairTourDealDrift(db, { dates: ['2026-07-17'], log: { log() {} } });
  assert.equal(r.deals.length, 0);
  assert.equal(r.toursDirty.length, 0);
});
