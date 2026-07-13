import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTourForWonDeal } from './tourFromDeal.js';

// Lifecycle regression (the 2026-07 twin bug): re-WON after reopen/LOST must
// REACTIVATE the deal's auto-cancelled TourEvent — same row id, no cancelled
// twin — and create a new row only when no reactivatable prior tour exists.
// Stub transaction, no DB (same idiom as the guide-portal access tests).

const DEAL = {
  id: 'deal1',
  orderNo: 27001,
  activityType: 'business',
  productId: 'prod1',
  productVariantId: 'var1',
  locationId: 'loc1',
  tourDate: '2026-08-01',
  tourTime: '13:00',
  participants: 20,
  tourLanguage: 'he',
};

function stubTx({ priorCancelledBooking = null } = {}) {
  const calls = { tourEventCreate: [], tourEventUpdate: [], bookingCreate: [], deletedComponents: 0, deletedAssignments: 0 };
  const tx = {
    calls,
    booking: {
      findFirst: async ({ where }) => {
        if (where.status === 'active') return null; // no current booking
        return priorCancelledBooking;
      },
      create: async ({ data }) => {
        calls.bookingCreate.push(data);
        return { id: 'bookingNew', ...data };
      },
      count: async () => 0,
    },
    dealTourPlan: { findUnique: async () => null }, // no plan → seed from variant
    tourEvent: {
      create: async ({ data }) => {
        calls.tourEventCreate.push(data);
        return { id: 'tourNew', ...data };
      },
      update: async ({ where, data }) => {
        calls.tourEventUpdate.push({ where, data });
        return { id: where.id, ...data };
      },
      findUnique: async () => null,
    },
    tourEventActivityComponent: {
      deleteMany: async () => {
        calls.deletedComponents += 1;
        return { count: 0 };
      },
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    tourAssignment: {
      deleteMany: async () => {
        calls.deletedAssignments += 1;
        return { count: 0 };
      },
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    productVariantActivityComponent: { findMany: async () => [] }, // variant seed source
    ticketRegistration: {
      findFirst: async () => null, // no existing 'deal' registration
      findMany: async () => [], // no active registrations → derivation is a no-op
      create: async ({ data }) => {
        calls.ticketRegistrationCreate = calls.ticketRegistrationCreate || [];
        calls.ticketRegistrationCreate.push(data);
        return { id: 'regNew', ...data };
      },
      update: async () => ({}),
    },
    openTourTemplateProduct: { findFirst: async () => null },
    productVariant: { findMany: async () => [] },
    timelineEntry: { create: async () => ({}) },
  };
  return tx;
}

const PRIOR = {
  id: 'bookingOld',
  status: 'cancelled',
  dealId: 'deal1',
  tourEventId: 'tourOld',
  tourEvent: { id: 'tourOld', kind: 'business', status: 'cancelled' },
};

test('re-WON with an auto-cancelled prior tour REACTIVATES it — same id, no new row', async () => {
  const tx = stubTx({ priorCancelledBooking: PRIOR });
  const { tourEvent, booking } = await createTourForWonDeal(tx, DEAL, { targetTourEventId: null, origin: null });

  assert.equal(tx.calls.tourEventCreate.length, 0, 'must NOT create a twin TourEvent');
  assert.equal(tx.calls.tourEventUpdate.length, 1);
  assert.equal(tx.calls.tourEventUpdate[0].where.id, 'tourOld');
  assert.equal(tourEvent.id, 'tourOld');

  const data = tx.calls.tourEventUpdate[0].data;
  assert.equal(data.status, 'scheduled');
  assert.equal(data.date, '2026-08-01');
  assert.equal(data.cancelledAt, null);
  assert.equal(data.completedAt, null);

  // Children converge to the plan/variant: replace-all, then reseed.
  assert.equal(tx.calls.deletedComponents, 1);
  assert.equal(tx.calls.deletedAssignments, 1);

  // History append-only: a NEW active booking, the cancelled one untouched.
  assert.equal(tx.calls.bookingCreate.length, 1);
  assert.equal(booking.status, 'active');
  assert.equal(booking.tourEventId, 'tourOld');
});

test('first WON (no prior cancelled tour) still CREATES a new TourEvent', async () => {
  const tx = stubTx({ priorCancelledBooking: null });
  const { tourEvent } = await createTourForWonDeal(tx, DEAL, { targetTourEventId: null, origin: null });
  assert.equal(tx.calls.tourEventCreate.length, 1);
  assert.equal(tx.calls.tourEventUpdate.length, 0);
  assert.equal(tourEvent.id, 'tourNew');
  assert.equal(tx.calls.tourEventCreate[0].status, 'scheduled');
});

test('the reactivation candidate query excludes superseded twins and group slots', async () => {
  // Pin the WHERE shape — the guard that a marked historical twin (or a slot)
  // can never be resurrected by a re-WON.
  let capturedWhere = null;
  const tx = stubTx({ priorCancelledBooking: null });
  const orig = tx.booking.findFirst;
  tx.booking.findFirst = async (args) => {
    if (args.where.status === 'cancelled') capturedWhere = args.where;
    return orig(args);
  };
  await createTourForWonDeal(tx, DEAL, { targetTourEventId: null, origin: null });
  assert.ok(capturedWhere, 'reactivation candidate lookup must run');
  assert.deepEqual(capturedWhere.tourEvent, {
    kind: { in: ['private', 'business'] },
    status: 'cancelled',
    supersededByTourEventId: null,
  });
});

test('group deals never enter the reactivation path (slot join unchanged)', async () => {
  const tx = stubTx({ priorCancelledBooking: PRIOR });
  tx.tourEvent.findUnique = async () => ({
    id: 'slot1',
    kind: 'group_slot',
    status: 'scheduled',
    date: '2026-08-02',
    startTime: '17:00',
    tourLanguage: 'he',
    locationId: 'loc1',
    productId: 'prod1',
    productVariantId: 'var1',
  });
  const { tourEvent, dealSync } = await createTourForWonDeal(
    tx,
    { ...DEAL, activityType: 'group' },
    { targetTourEventId: 'slot1', origin: null },
  );
  assert.equal(tourEvent.id, 'slot1');
  assert.equal(tx.calls.tourEventCreate.length, 0);
  assert.equal(tx.calls.tourEventUpdate.length, 0);
  assert.ok(dealSync); // slot stays authoritative
});
