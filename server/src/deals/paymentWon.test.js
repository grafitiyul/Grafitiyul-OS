import test from 'node:test';
import assert from 'node:assert/strict';
import { settleDealWonFromPayment } from './paymentWon.js';
import { syncDealRegistration } from '../tours/registrations.js';
import { createTourForWonDeal } from '../tours/tourFromDeal.js';

// Canonical payment→WON + held/expired adoption + capacity double-count fix.
// A compact in-memory store models just the prisma surface these paths touch.

function makeStore(init = {}) {
  const s = {
    deals: init.deals || {},
    tours: init.tours || {},
    registrations: init.registrations ? [...init.registrations] : [],
    bookings: [],
    timeline: [],
    seq: 0,
  };
  const id = (p) => `${p}${++s.seq}`;
  const CAP = ['active', 'held', 'confirmed'];
  const client = {
    _s: s,
    $transaction: async (fn) => fn(client),
    deal: {
      findUnique: async ({ where }) => s.deals[where.id] || null,
      update: async ({ where, data }) => Object.assign(s.deals[where.id], data),
    },
    tourEvent: {
      findUnique: async ({ where }) => s.tours[where.id] || null,
      update: async ({ where, data }) => Object.assign(s.tours[where.id], data),
      updateMany: async () => ({ count: 1 }),
    },
    booking: {
      findFirst: async ({ where }) =>
        s.bookings.find((b) => b.dealId === where.dealId && (where.status ? b.status === where.status : true)) || null,
      create: async ({ data }) => {
        const b = { id: id('bk'), ...data };
        s.bookings.push(b);
        return b;
      },
      groupBy: async () => [],
    },
    ticketRegistration: {
      findFirst: async ({ where, orderBy }) => {
        let rows = s.registrations.filter((r) => {
          if (where.bookingId !== undefined && r.bookingId !== where.bookingId) return false;
          if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
          if (where.source !== undefined && r.source !== where.source) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          if (typeof where.status === 'string' && r.status !== where.status) return false;
          return true;
        });
        if (orderBy) rows = rows.slice().reverse();
        return rows[0] || null;
      },
      findMany: async ({ where }) =>
        s.registrations.filter((r) => r.tourEventId === where.tourEventId && CAP.includes(r.status) && r.productVariantId != null),
      groupBy: async ({ where }) => {
        const seats = s.registrations
          .filter((r) => where.tourEventId.in.includes(r.tourEventId) && CAP.includes(r.status))
          .reduce((n, r) => n + (r.quantity || 0), 0);
        return seats ? [{ tourEventId: where.tourEventId.in[0], _sum: { quantity: seats } }] : [];
      },
      aggregate: async ({ where }) => {
        const seats = s.registrations
          .filter((r) => r.dealId === where.dealId && r.tourEventId === where.tourEventId && r.status === where.status)
          .reduce((n, r) => n + (r.quantity || 0), 0);
        return { _sum: { quantity: seats } };
      },
      create: async ({ data }) => {
        const r = { id: id('reg'), ...data };
        s.registrations.push(r);
        return r;
      },
      update: async ({ where, data }) => {
        const r = s.registrations.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of s.registrations) {
          if (where.dealId !== undefined && r.dealId !== where.dealId) continue;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) continue;
          if (typeof where.status === 'string' && r.status !== where.status) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },
    openTourTemplateProduct: { findMany: async () => [], findFirst: async () => null },
    productVariant: { findMany: async () => [] },
    tourEventActivityComponent: { findMany: async () => [], deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    timelineEntry: { create: async ({ data }) => { s.timeline.push(data); return {}; } },
  };
  return client;
}

test('syncDealRegistration ADOPTS a held reservation → confirmed in place, no duplicate', async () => {
  const c = makeStore({
    tours: { slot1: { id: 'slot1', kind: 'group_slot' } },
    registrations: [{ id: 'held1', dealId: 'd1', tourEventId: 'slot1', status: 'held', quantity: 5, productVariantId: 'v_ws', bookingId: null }],
  });
  await syncDealRegistration(c, { id: 'bk1', dealId: 'd1', seats: 5, status: 'active' }, { id: 'slot1', kind: 'group_slot' });
  const regs = c._s.registrations;
  assert.equal(regs.length, 1, 'no duplicate registration created');
  assert.equal(regs[0].status, 'confirmed');
  assert.equal(regs[0].bookingId, 'bk1');
  assert.equal(regs[0].expiresAt, null);
});

test('syncDealRegistration re-confirms an EXPIRED reservation (late payment) in place', async () => {
  const c = makeStore({
    tours: { slot1: { id: 'slot1', kind: 'group_slot' } },
    registrations: [{ id: 'exp1', dealId: 'd1', tourEventId: 'slot1', status: 'expired', quantity: 5, productVariantId: 'v_ws', bookingId: null }],
  });
  await syncDealRegistration(c, { id: 'bk1', dealId: 'd1', seats: 5, status: 'active' }, { id: 'slot1', kind: 'group_slot' });
  assert.equal(c._s.registrations.length, 1);
  assert.equal(c._s.registrations[0].status, 'confirmed');
});

test('capacity check does NOT double-count the deal own held seats', async () => {
  // Slot capacity 10, the deal already holds 8 (in occupancy). Confirming adds 0.
  const c = makeStore({
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 10, productVariantId: 'v', productId: 'p' } },
    registrations: [{ id: 'held1', dealId: 'd1', tourEventId: 'slot1', status: 'held', quantity: 8, productVariantId: 'v_plain', bookingId: null }],
  });
  const deal = { id: 'd1', orderNo: 27001, activityType: 'group', participants: 8, productVariantId: 'v_plain' };
  // Without the fix this throws tour_full (8 held + 8 requested = 16 > 10).
  const { booking } = await createTourForWonDeal(c, deal, { targetTourEventId: 'slot1', origin: null });
  assert.ok(booking);
  assert.equal(c._s.registrations.length, 1); // held adopted, not duplicated
  assert.equal(c._s.registrations[0].status, 'confirmed');
});

test('settleDealWonFromPayment: WON exactly once + adopts held reg (idempotent)', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 5, productVariantId: 'v_plain', orderNo: 27001 } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
    registrations: [{ id: 'held1', dealId: 'd1', tourEventId: 'slot1', status: 'held', quantity: 5, productVariantId: 'v_plain', bookingId: null }],
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(res.wonNow, true);
  assert.equal(c._s.deals.d1.status, 'won');
  assert.equal(c._s.registrations.length, 1); // no duplicate
  assert.equal(c._s.registrations[0].status, 'confirmed');
  // Idempotent: a second call is a no-op.
  const again = await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(again.alreadyWon, true);
  assert.equal(c._s.bookings.length, 1); // still one booking
});

test('settleDealWonFromPayment: LATE payment on an expired hold is accepted (overbook)', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 5, productVariantId: 'v_plain', orderNo: 27002 } },
    // Slot already full (capacity 3, 3 confirmed) — the expired hold is being re-confirmed over capacity.
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 3, productVariantId: 'v', productId: 'p' } },
    registrations: [
      { id: 'other', dealId: 'd2', tourEventId: 'slot1', status: 'confirmed', quantity: 3, productVariantId: 'v_plain', bookingId: 'bkx' },
      { id: 'exp1', dealId: 'd1', tourEventId: 'slot1', status: 'expired', quantity: 5, productVariantId: 'v_plain', bookingId: null },
    ],
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(res.wonNow, true);
  assert.equal(res.lateExpired, true);
  assert.equal(res.overbook, true); // accepted despite exceeding capacity
  assert.equal(c._s.deals.d1.status, 'won');
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'late_payment_won'));
});

// ── registration completion service ──────────────────────────────────────────
import { holdRegistrationForDeal, registerWithoutPayment } from './registrationCompletion.js';

test('holdRegistrationForDeal is idempotent — repeated calls extend the SAME hold', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27010 } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20 } },
  });
  await holdRegistrationForDeal(c, { dealId: 'd1', tourEventId: 'slot1', productVariantId: 'v_plain', quantity: 4, value: 3, unit: 'hours' });
  await holdRegistrationForDeal(c, { dealId: 'd1', tourEventId: 'slot1', productVariantId: 'v_plain', quantity: 6, value: 2, unit: 'days' });
  const holds = c._s.registrations.filter((r) => r.dealId === 'd1');
  assert.equal(holds.length, 1, 'no duplicate hold');
  assert.equal(holds[0].status, 'held');
  assert.equal(holds[0].quantity, 6); // extended/updated in place
  assert.equal(c._s.deals.d1.status, 'open'); // Deal stays OPEN
});

test('registerWithoutPayment requires a reason', async () => {
  const c = makeStore({ deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, orderNo: 27011 } }, tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20 } } });
  await assert.rejects(
    () => registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: '  ' }),
    (e) => e.code === 'no_payment_reason_required',
  );
  assert.equal(c._s.deals.d1.status, 'open'); // not WON
});

test('registerWithoutPayment stores the reason canonically + WONs the deal', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27012 } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
  });
  await registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: 'אישור מנהל — לקוח VIP' });
  assert.equal(c._s.deals.d1.status, 'won');
  const reg = c._s.registrations.find((r) => r.dealId === 'd1');
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.paymentStatus, 'waived'); // not a fabricated payment
  assert.equal(reg.noPaymentReason, 'אישור מנהל — לקוח VIP');
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'no_payment_won'));
});
