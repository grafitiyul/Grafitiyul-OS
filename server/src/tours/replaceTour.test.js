import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceTourEvent, registeredSeatCount } from './replaceTour.js';

// Canonical registered-tour replacement over an in-memory prisma fake. Verifies
// the invariant: one replacement, registrations + bookings moved (no dup), deals
// realigned, original cancelled + linked + readable, idempotent retry, and a
// single canonical impact issue.

function makeDb({ original, regs = [], bookings = [], deals = {} } = {}) {
  const tours = { [original.id]: { ...original } };
  const reg = regs.map((r) => ({ ...r }));
  const bk = bookings.map((b) => ({ ...b }));
  const dl = Object.fromEntries(Object.entries(deals).map(([k, v]) => [k, { id: k, ...v }]));
  const issues = [];
  const reqs = [];
  let seq = 0;
  const nid = (p) => `${p}${++seq}`;

  const db = {
    _tours: tours, _reg: reg, _bk: bk, _deals: dl, _issues: issues,
    $transaction: async (fn) => fn(db),
    timelineEntry: { create: async () => ({}) },
    tourAssignment: {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
    tourEvent: {
      findUnique: async ({ where }) => tours[where.id] || null,
      create: async ({ data }) => {
        const row = { id: nid('tour'), ...data };
        tours[row.id] = row;
        return row;
      },
      update: async ({ where, data }) => {
        Object.assign(tours[where.id], data);
        return tours[where.id];
      },
    },
    ticketRegistration: {
      aggregate: async ({ where }) => {
        const m = reg.filter((r) => r.tourEventId === where.tourEventId && where.status.in.includes(r.status));
        return { _sum: { quantity: m.reduce((n, r) => n + (r.quantity || 1), 0) }, _count: { _all: m.length } };
      },
      updateMany: async ({ where, data }) => {
        let c = 0;
        for (const r of reg) if (r.tourEventId === where.tourEventId && where.status.in.includes(r.status)) { Object.assign(r, data); c += 1; }
        return { count: c };
      },
      findMany: async ({ where }) => reg.filter((r) => r.tourEventId === where.tourEventId && (!where.status || where.status.in.includes(r.status))),
    },
    booking: {
      findMany: async ({ where }) => bk.filter((b) => b.tourEventId === where.tourEventId && b.status === where.status),
      updateMany: async ({ where, data }) => {
        let c = 0;
        for (const b of bk) if (b.tourEventId === where.tourEventId && b.status === where.status) { Object.assign(b, data); c += 1; }
        return { count: c };
      },
    },
    deal: {
      findUnique: async ({ where }) => dl[where.id] || null,
      update: async ({ where, data }) => { Object.assign(dl[where.id], data); return dl[where.id]; },
    },
    operationalIssue: {
      findFirst: async ({ where }) => issues.find((i) => i.dedupeKey === where.dedupeKey && ['open', 'acknowledged'].includes(i.status)) || null,
      findUnique: async ({ where }) => issues.find((i) => i.id === where.id) || null,
      create: async ({ data }) => { const row = { id: nid('iss'), status: 'open', ...data }; issues.push(row); return row; },
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
  return db;
}

const ORIGINAL = { id: 'T0', kind: 'group_slot', status: 'scheduled', date: '2026-07-17', startTime: '11:30', tourLanguage: 'he', capacity: 30, productId: 'p1', productVariantId: 'v1', locationId: 'loc1', meetingPoint: 'כיכר', openTourTemplateId: 'tpl1', replacedByTourEventId: null };

test('registeredSeatCount sums seat-holding registrations', async () => {
  const db = makeDb({ original: ORIGINAL, regs: [{ id: 'r1', tourEventId: 'T0', status: 'active', quantity: 2 }, { id: 'r2', tourEventId: 'T0', status: 'held', quantity: 1 }, { id: 'r3', tourEventId: 'T0', status: 'cancelled', quantity: 5 }] });
  assert.deepEqual(await registeredSeatCount(db, 'T0'), { seats: 3, count: 2 });
});

test('replacement: one new tour, regs+bookings moved, deals realigned, original cancelled+linked, impact created', async () => {
  const db = makeDb({
    original: ORIGINAL,
    regs: [{ id: 'r1', tourEventId: 'T0', status: 'active', quantity: 2, dealId: 'd1', customerName: 'דנה', customerEmail: 'a@x.com' }],
    bookings: [{ id: 'b1', tourEventId: 'T0', status: 'active', dealId: 'd1' }],
    deals: { d1: { tourDate: '2026-07-17', tourTime: '11:30', locationId: 'loc1' } },
  });
  const res = await replaceTourEvent(db, { originalId: 'T0', patch: { startTime: '10:45' } });
  const rep = res.replacement;
  // Exactly one new tour, scheduled, at the new time, copying the rest.
  assert.equal(rep.status, 'scheduled');
  assert.equal(rep.startTime, '10:45');
  assert.equal(rep.date, '2026-07-17');
  assert.equal(rep.productId, 'p1');
  // Registration + booking moved (no duplication).
  assert.equal(db._reg[0].tourEventId, rep.id);
  assert.equal(db._bk[0].tourEventId, rep.id);
  assert.equal(db._reg.length, 1);
  // Deal snapshot realigned to the replacement.
  assert.equal(db._deals.d1.tourTime, '10:45');
  // Original cancelled, readable, linked.
  assert.equal(db._tours.T0.status, 'cancelled');
  assert.equal(db._tours.T0.replacedByTourEventId, rep.id);
  // ONE canonical impact issue, on the replacement, tour_moved.
  assert.equal(db._issues.length, 1);
  assert.equal(db._issues[0].data.impactType, 'tour_moved');
  assert.equal(db._issues[0].data.tourEventId, rep.id);
});

test('idempotent: re-running replace returns the existing replacement, no second tour', async () => {
  const db = makeDb({
    original: ORIGINAL,
    regs: [{ id: 'r1', tourEventId: 'T0', status: 'active', quantity: 2, dealId: 'd1' }],
    bookings: [{ id: 'b1', tourEventId: 'T0', status: 'active', dealId: 'd1' }],
    deals: { d1: { tourDate: '2026-07-17', tourTime: '11:30', locationId: 'loc1' } },
  });
  const first = await replaceTourEvent(db, { originalId: 'T0', patch: { startTime: '10:45' } });
  const toursAfterFirst = Object.keys(db._tours).length;
  const second = await replaceTourEvent(db, { originalId: 'T0', patch: { startTime: '10:45' } });
  assert.equal(second.reused, true);
  assert.equal(second.replacement.id, first.replacement.id);
  assert.equal(Object.keys(db._tours).length, toursAfterFirst); // no new tour
});

test('refuses a non-group-slot (deal-owned) tour', async () => {
  const db = makeDb({ original: { ...ORIGINAL, kind: 'private' } });
  await assert.rejects(() => replaceTourEvent(db, { originalId: 'T0', patch: { startTime: '10:45' } }), (e) => e.code === 'not_a_group_slot');
});
