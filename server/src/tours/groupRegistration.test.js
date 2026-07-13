import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDealRegistration } from './registrations.js';
import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { createTourForWonDeal } from './tourFromDeal.js';

// Group Deal → canonical TicketRegistration integration. Fake tx clients model
// only the surface each function touches. These pin the Part-B contract: the
// registration carries the DEAL's chosen sellable variant (workshop vs plain),
// is idempotent per booking, and capacity guards overbooking.

// ── syncDealRegistration ─────────────────────────────────────────────────────

function regTx({ existingReg = null } = {}) {
  const state = { created: [], updated: [] };
  return {
    state,
    ticketRegistration: {
      findFirst: async () => existingReg,
      findMany: async () => [], // recompute: no active regs → no-op
      create: async ({ data }) => {
        const row = { id: 'reg1', ...data };
        state.created.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        state.updated.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    // recompute reads (kept inert: no template, no active regs → returns null)
    tourEvent: {
      findUnique: async () => ({
        id: 'slot1',
        kind: 'group_slot',
        status: 'scheduled',
        productManualOverride: false,
        openTourTemplateId: null,
        productId: null,
        productVariantId: 'base',
      }),
      update: async () => ({}),
    },
    openTourTemplateProduct: { findFirst: async () => null },
    productVariant: { findMany: async () => [] },
    tourEventActivityComponent: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
}

const SLOT = { id: 'slot1', kind: 'group_slot', productVariantId: 'base' };

test('group registration carries the DEAL variant (not slot base) + stable identity', async () => {
  const tx = regTx();
  await syncDealRegistration(
    tx,
    { id: 'bk1', dealId: 'deal1', seats: 5, status: 'active' },
    SLOT,
    { productVariantId: 'workshop' }, // the ticket the customer bought
  );
  assert.equal(tx.state.created.length, 1);
  const reg = tx.state.created[0];
  assert.equal(reg.productVariantId, 'workshop'); // NOT 'base'
  assert.equal(reg.source, 'deal');
  assert.equal(reg.quantity, 5);
  assert.equal(reg.tourEventId, 'slot1');
  assert.equal(reg.externalOrderId, 'deal1'); // stable source ref = Deal id
  assert.equal(reg.externalLineId, 'bk1'); // stable line = Booking id
});

test('re-syncing the same booking UPDATES in place — no duplicate seat rows', async () => {
  const tx = regTx({ existingReg: { id: 'reg1', productVariantId: 'workshop', cancelledAt: null } });
  await syncDealRegistration(
    tx,
    { id: 'bk1', dealId: 'deal1', seats: 8, status: 'active' }, // headcount changed
    SLOT,
    { productVariantId: 'workshop' },
  );
  assert.equal(tx.state.created.length, 0, 'must not create a second registration');
  assert.equal(tx.state.updated.length, 1);
  assert.equal(tx.state.updated[0].data.quantity, 8); // occupancy follows the deal
});

test('cancelling the booking cancels the registration (seat released)', async () => {
  const tx = regTx({ existingReg: { id: 'reg1', productVariantId: 'workshop', cancelledAt: null } });
  await syncDealRegistration(tx, { id: 'bk1', dealId: 'deal1', seats: 5, status: 'cancelled' }, SLOT);
  assert.equal(tx.state.updated[0].data.status, 'cancelled');
  assert.ok(tx.state.updated[0].data.cancelledAt instanceof Date);
});

test('omitting the variant preserves the existing registration variant', async () => {
  const tx = regTx({ existingReg: { id: 'reg1', productVariantId: 'workshop', cancelledAt: null } });
  await syncDealRegistration(tx, { id: 'bk1', dealId: 'deal1', seats: 5, status: 'cancelled' }, SLOT);
  assert.equal(tx.state.updated[0].data.productVariantId, 'workshop'); // not nulled
});

// ── workshop derivation end-to-end (registration → recompute) ────────────────

test('a workshop registration flips the slot operational product to workshop', async () => {
  const updates = [];
  const client = {
    tourEvent: {
      findUnique: async () => ({
        id: 'slot1',
        kind: 'group_slot',
        status: 'scheduled',
        productManualOverride: false,
        openTourTemplateId: 'tpl1',
        productId: 'p',
        productVariantId: 'base', // currently plain
      }),
      update: async ({ data }) => {
        updates.push(data);
        return {};
      },
    },
    // one active registration bought the workshop variant
    ticketRegistration: {
      findMany: async () => [{ productVariantId: 'workshop' }],
    },
    openTourTemplateProduct: { findFirst: async () => null },
    productVariant: {
      findMany: async () => [
        {
          id: 'workshop',
          productId: 'p',
          durationHours: 3.5,
          activityComponents: [{ activityComponentId: 'c_tour' }, { activityComponentId: 'c_workshop' }],
        },
      ],
    },
    tourEventActivityComponent: {
      findMany: async () => [{ id: 'te1', activityComponentId: 'c_tour' }],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  const result = await recomputeTourOperationalProduct(client, 'slot1');
  assert.equal(result.displayVariantId, 'workshop');
  assert.ok(updates.length >= 1);
  assert.equal(updates[0].productVariantId, 'workshop'); // slot now reads as workshop
});

// ── capacity guard (createTourForWonDeal group join) ─────────────────────────

function joinTx({ capacity, currentSeats }) {
  const state = { bookings: [], registrations: [] };
  return {
    state,
    booking: {
      findFirst: async () => null, // no existing active booking (activeBookingFor)
      groupBy: async () => [], // booking counts — irrelevant to capacity
      create: async ({ data }) => {
        const row = { id: 'bk1', ...data };
        state.bookings.push(row);
        return row;
      },
    },
    tourEvent: {
      findUnique: async () => ({
        id: 'slot1',
        kind: 'group_slot',
        status: 'scheduled',
        capacity,
        productId: 'p',
        productVariantId: 'base',
      }),
      update: async () => ({}),
    },
    // occupancyFor: active registration seats currently on the slot
    ticketRegistration: {
      groupBy: async () => [{ tourEventId: 'slot1', _sum: { quantity: currentSeats } }],
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }) => {
        const row = { id: 'reg1', ...data };
        state.registrations.push(row);
        return row;
      },
      update: async () => ({}),
    },
    openTourTemplateProduct: { findFirst: async () => null },
    productVariant: { findMany: async () => [] },
    tourEventActivityComponent: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    timelineEntry: { create: async () => ({}) },
  };
}

const GROUP_DEAL = { id: 'deal1', orderNo: 27001, activityType: 'group', participants: 5, productVariantId: 'workshop' };

test('capacity guard prevents overbooking a group slot', async () => {
  const tx = joinTx({ capacity: 10, currentSeats: 8 }); // 8 + 5 = 13 > 10
  await assert.rejects(
    () => createTourForWonDeal(tx, GROUP_DEAL, { targetTourEventId: 'slot1', origin: null }),
    (e) => e.code === 'tour_full' && e.details.capacity === 10 && e.details.activeSeats === 8,
  );
  assert.equal(tx.state.bookings.length, 0, 'no booking created when it would overbook');
});

test('allowOverbook lets the operator deliberately exceed capacity', async () => {
  const tx = joinTx({ capacity: 10, currentSeats: 8 });
  const { booking } = await createTourForWonDeal(tx, GROUP_DEAL, {
    targetTourEventId: 'slot1',
    origin: null,
    allowOverbook: true,
  });
  assert.ok(booking);
  assert.equal(tx.state.bookings.length, 1);
  // The registration still carries the deal's chosen (workshop) variant.
  assert.equal(tx.state.registrations[0].productVariantId, 'workshop');
});

test('a join within capacity succeeds', async () => {
  const tx = joinTx({ capacity: 10, currentSeats: 3 }); // 3 + 5 = 8 <= 10
  const { booking } = await createTourForWonDeal(tx, GROUP_DEAL, { targetTourEventId: 'slot1', origin: null });
  assert.ok(booking);
  assert.equal(tx.state.registrations[0].productVariantId, 'workshop');
});
