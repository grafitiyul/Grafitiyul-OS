import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDealRegistration } from './registrations.js';
import { isLiveBooking } from './registrationStatus.js';
import { guideTourDetailDto } from './guidePortal/dto.js';
import { findDuplicateBookingRegistrations } from '../maintenance/repairDuplicateBookingRegistrations.js';

// A Booking is ONE seat line. Every registration hanging off it converges with
// it — whatever created the row. The `source: 'deal'` lookup that used to guard
// this let legacy-import twins survive a cancellation, so a participant who had
// cancelled kept a seat and kept a card in the Guide Portal.

function fakeTx(registrations) {
  const rows = registrations.map((r) => ({ createdAt: new Date(), source: 'deal', quantity: 0, ...r }));
  const log = { created: [], updated: [], releasedIds: [] };
  return {
    rows,
    log,
    ticketRegistration: {
      findMany: async ({ where }) =>
        rows.filter((r) => (where.bookingId ? r.bookingId === where.bookingId : true)),
      findFirst: async () => null,
      create: async ({ data }) => {
        const r = { id: `new_${rows.length}`, ...data };
        rows.push(r);
        log.created.push(r);
        return r;
      },
      update: async ({ where, data }) => {
        const r = rows.find((x) => x.id === where.id);
        Object.assign(r, data);
        log.updated.push({ id: where.id, ...data });
        return r;
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((r) => where.id.in.includes(r.id));
        for (const r of hit) Object.assign(r, data);
        log.releasedIds.push(...hit.map((r) => r.id));
        return { count: hit.length };
      },
    },
  };
}

const TOUR = { id: 'tour1', kind: 'private', productVariantId: 'v1' };
const live = (r) => ['active', 'held', 'confirmed'].includes(r.status);

test('a legacy twin on the booking is ADOPTED, not duplicated', async () => {
  // The exact production shape: one migration row, no deal row.
  const tx = fakeTx([
    { id: 'mig1', bookingId: 'b1', dealId: 'd1', source: 'migration', status: 'confirmed', quantity: 15 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 22, status: 'active' }, TOUR);

  assert.equal(tx.log.created.length, 0, 'must not create a second seat line');
  assert.equal(tx.rows.filter(live).length, 1);
  const row = tx.rows.find((r) => r.id === 'mig1');
  assert.equal(row.quantity, 22, 'the adopted row takes the booking seats');
  assert.equal(row.source, 'migration', 'source is preserved — the audit trail stays honest');
});

test('cancelling the booking releases EVERY registration on it, not just the deal row', async () => {
  const tx = fakeTx([
    { id: 'deal1', bookingId: 'b1', dealId: 'd1', source: 'deal', status: 'active', quantity: 22 },
    { id: 'mig1', bookingId: 'b1', dealId: 'd1', source: 'migration', status: 'confirmed', quantity: 15 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 22, status: 'cancelled' }, TOUR);

  assert.equal(tx.rows.filter(live).length, 0, 'no seat survives a cancelled booking');
  for (const r of tx.rows) {
    assert.equal(r.status, 'cancelled');
    assert.ok(r.cancelledAt, 'a released row is always stamped');
  }
});

test('an ORPHANED booking releases its seats too', async () => {
  const tx = fakeTx([
    { id: 'deal1', bookingId: 'b1', dealId: 'd1', source: 'deal', status: 'active', quantity: 6 },
    { id: 'mig1', bookingId: 'b1', dealId: 'd1', source: 'migration', status: 'confirmed', quantity: 6 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 6, status: 'orphaned' }, TOUR);
  assert.equal(tx.rows.filter(live).length, 0);
});

test('an active booking keeps exactly one live line — the twin is released', async () => {
  const tx = fakeTx([
    { id: 'deal1', bookingId: 'b1', dealId: 'd1', source: 'deal', status: 'active', quantity: 22 },
    { id: 'mig1', bookingId: 'b1', dealId: 'd1', source: 'migration', status: 'confirmed', quantity: 15 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 22, status: 'active' }, TOUR);

  const liveRows = tx.rows.filter(live);
  assert.equal(liveRows.length, 1);
  assert.equal(liveRows[0].id, 'deal1');
  assert.equal(liveRows[0].quantity, 22, 'seats are counted once, not 22+15');
  assert.deepEqual(tx.log.releasedIds, ['mig1']);
});

test('already-released twins are left alone (idempotent)', async () => {
  const tx = fakeTx([
    { id: 'deal1', bookingId: 'b1', dealId: 'd1', source: 'deal', status: 'active', quantity: 4 },
    { id: 'mig1', bookingId: 'b1', dealId: 'd1', source: 'migration', status: 'cancelled', quantity: 4 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 4, status: 'active' }, TOUR);
  assert.deepEqual(tx.log.releasedIds, [], 'a second run writes nothing');
});

test('registrations on OTHER bookings are never touched', async () => {
  const tx = fakeTx([
    { id: 'deal1', bookingId: 'b1', dealId: 'd1', source: 'deal', status: 'active', quantity: 4 },
    { id: 'other', bookingId: 'b2', dealId: 'd2', source: 'deal', status: 'active', quantity: 9 },
  ]);
  await syncDealRegistration(tx, { id: 'b1', dealId: 'd1', seats: 4, status: 'cancelled' }, TOUR);
  assert.equal(tx.rows.find((r) => r.id === 'other').status, 'active');
});

// ── the roster surfaces ──────────────────────────────────────────────────────

test('isLiveBooking: only active is a participant — orphaned is as dead as cancelled', () => {
  assert.ok(isLiveBooking('active'));
  assert.ok(!isLiveBooking('cancelled'));
  assert.ok(!isLiveBooking('orphaned'));
});

test('guide portal roster excludes cancelled AND orphaned bookings', () => {
  const deal = (orderNo) => ({ orderNo, title: 't', contacts: [], organization: null });
  const dto = guideTourDetailDto({
    tour: {
      id: 'tour1',
      bookings: [
        { id: 'b1', status: 'active', seats: 2, deal: deal(1) },
        { id: 'b2', status: 'cancelled', seats: 2, deal: deal(2) },
        { id: 'b3', status: 'orphaned', seats: 2, deal: deal(3) },
      ],
    },
    assignment: { role: 'guide' },
    occupancy: { activeSeats: 2 },
    permissions: {},
  });
  assert.deepEqual(dto.participants.map((p) => p.orderNo), [1]);
});

// ── the repair's signature ───────────────────────────────────────────────────

function repairClient(bookings) {
  return { booking: { findMany: async () => bookings } };
}

test('repair targets only bookings with exactly one deal row among several live rows', async () => {
  const found = await findDuplicateBookingRegistrations(
    repairClient([
      // the production shape → repaired
      {
        id: 'b1', status: 'active', seats: 22, dealId: 'd1', tourEventId: 't1',
        deal: { orderNo: 26130, status: 'won' },
        tourEvent: { date: '2026-08-06', startTime: '17:00', status: 'scheduled' },
        ticketRegistrations: [
          { id: 'r1', status: 'active', source: 'deal', quantity: 22, createdAt: new Date() },
          { id: 'r2', status: 'confirmed', source: 'migration', quantity: 15, createdAt: new Date() },
        ],
      },
      // legacy per-participant import (no deal row) → NOT touched
      {
        id: 'b2', status: 'active', seats: 8, dealId: 'd2', tourEventId: 't2',
        deal: { orderNo: 19583, status: 'won' },
        tourEvent: { date: '2024-04-26', startTime: '11:00', status: 'completed' },
        ticketRegistrations: [
          { id: 'r3', status: 'confirmed', source: 'migration', quantity: 4, createdAt: new Date() },
          { id: 'r4', status: 'confirmed', source: 'migration', quantity: 4, createdAt: new Date() },
        ],
      },
      // healthy single line → NOT touched
      {
        id: 'b3', status: 'active', seats: 3, dealId: 'd3', tourEventId: 't3',
        deal: { orderNo: 1, status: 'won' },
        tourEvent: { date: '2026-09-01', startTime: '10:00', status: 'scheduled' },
        ticketRegistrations: [
          { id: 'r5', status: 'active', source: 'deal', quantity: 3, createdAt: new Date() },
          { id: 'r6', status: 'cancelled', source: 'migration', quantity: 3, createdAt: new Date() },
        ],
      },
    ]),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].bookingId, 'b1');
  assert.equal(found[0].keep.id, 'r1');
  assert.deepEqual(found[0].release.map((r) => r.id), ['r2']);
  assert.equal(found[0].phantomSeats, 15);
});
