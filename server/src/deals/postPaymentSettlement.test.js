import test from 'node:test';
import assert from 'node:assert/strict';
import { settleDealWonFromPayment } from './paymentWon.js';
import { resolveActivityType, settledPaymentStateFor } from './resolveActivityType.js';
import { syncDealRegistration, stampSettledRegistration } from '../tours/registrations.js';

// The rule under test: TAKING PAYMENT IS NEVER BLOCKED, and nothing the system
// decided on the operator's behalf is left unrecorded.
//
// Production #27105: a private deal was priced, paid ₪1,200 by card, and closed
// WON — with `activityType` the single unfilled field. The tour gate refused
// over it, so a paying customer existed commercially and not operationally.
// These tests pin the replacement behaviour end to end.

function makeStore(init = {}) {
  const s = {
    deals: init.deals || {},
    tours: init.tours || {},
    registrations: init.registrations ? [...init.registrations] : [],
    bookings: init.bookings ? [...init.bookings] : [],
    timeline: [],
    reviews: [],
    seq: 0,
  };
  const id = (p) => `${p}${++s.seq}`;
  const CAP = ['active', 'held', 'confirmed'];
  // Faithful enough to the real semantics to be worth trusting: `NOT` is the
  // idempotency guard on the money stamp, so the fake must honour it.
  const matchesNot = (row, not) =>
    not
      ? Object.entries(not).every(([k, v]) => {
          if (v && typeof v === 'object' && 'not' in v) return v.not === null ? row[k] != null : row[k] !== v.not;
          return row[k] === v;
        })
      : false;
  const client = {
    _s: s,
    $transaction: async (fn) => fn(client),
    deal: {
      findUnique: async ({ where }) => s.deals[where.id] || null,
      update: async ({ where, data }) => Object.assign(s.deals[where.id], data),
      updateMany: async ({ where, data }) => {
        const d = s.deals[where.id];
        if (!d) return { count: 0 };
        if (where.status?.not !== undefined && d.status === where.status.not) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      },
    },
    dealStage: { findFirst: async () => ({ id: 'stage_final', key: 'closing', label: 'סגירה' }) },
    quoteOffer: { findFirst: async () => null },
    quoteDocument: { findFirst: async () => null },
    quoteLine: { findMany: async () => [] },
    tourEvent: {
      findUnique: async ({ where }) => s.tours[where.id] || null,
      create: async ({ data }) => {
        const t = { id: id('tour'), ...data };
        s.tours[t.id] = t;
        return t;
      },
      update: async ({ where, data }) => Object.assign(s.tours[where.id], data),
      updateMany: async () => ({ count: 1 }),
    },
    dealTourPlan: { findUnique: async () => null },
    booking: {
      findFirst: async ({ where }) =>
        s.bookings.find(
          (b) => b.dealId === where.dealId && (where.status ? b.status === where.status : true),
        ) || null,
      create: async ({ data }) => {
        const b = { id: id('bk'), ...data };
        s.bookings.push(b);
        return b;
      },
      count: async () => 0,
      groupBy: async () => [],
    },
    ticketRegistration: {
      findFirst: async ({ where }) => {
        const rows = s.registrations.filter((r) => {
          if (where.bookingId !== undefined && r.bookingId !== where.bookingId) return false;
          if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
          if (where.tourEventId !== undefined && r.tourEventId !== where.tourEventId) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          if (typeof where.status === 'string' && r.status !== where.status) return false;
          return true;
        });
        return rows[rows.length - 1] || null;
      },
      findMany: async ({ where }) =>
        s.registrations.filter((r) =>
          where.bookingId !== undefined
            ? r.bookingId === where.bookingId
            : r.tourEventId === where.tourEventId && CAP.includes(r.status),
        ),
      groupBy: async () => [],
      aggregate: async () => ({ _sum: { quantity: 0 } }),
      create: async ({ data }) => {
        const r = { id: id('reg'), confirmedAt: null, paymentStatus: null, ...data };
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
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          if (where.id?.in && !where.id.in.includes(r.id)) continue;
          if (matchesNot(r, where.NOT)) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },
    tourEventActivityComponent: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    tourAssignment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    productVariant: { findMany: async () => [], findUnique: async () => null },
    productVariantActivityComponent: { findMany: async () => [] },
    openTourTemplateProduct: { findMany: async () => [], findFirst: async () => null },
    timelineEntry: {
      create: async ({ data }) => {
        const row = { id: id('tl'), ...data };
        s.timeline.push(row);
        return row;
      },
      findFirst: async () => null,
      update: async () => ({}),
    },
    reviewItem: {
      create: async ({ data }) => {
        if (s.reviews.some((r) => r.dedupeKey === data.dedupeKey)) {
          const e = new Error('unique');
          e.code = 'P2002';
          throw e;
        }
        const r = { id: id('rv'), status: 'open', ...data };
        s.reviews.push(r);
        return r;
      },
      findUnique: async ({ where }) => s.reviews.find((r) => r.dedupeKey === where.dedupeKey) || null,
      updateMany: async ({ where, data }) => {
        const r = s.reviews.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
  };
  return client;
}

const tl = (c, event) => c._s.timeline.find((t) => t.data?.event === event) || null;

// ── the resolver contract ────────────────────────────────────────────────────

test('resolver: an explicit activityType is never overridden or re-decided', () => {
  const r = resolveActivityType({ activityType: 'business', organizationId: null });
  assert.equal(r.activityType, 'business');
  assert.equal(r.assumed, false, 'an operator choice is not an assumption');
});

test('resolver: missing type with no group context and no org → private', () => {
  const r = resolveActivityType({ activityType: null, organizationId: null });
  assert.deepEqual(
    { t: r.activityType, a: r.assumed, why: r.reason },
    { t: 'private', a: true, why: 'default_private' },
  );
});

test('resolver: a linked organization means business — the canonical rule, applied late', () => {
  const r = resolveActivityType({ activityType: null, organizationId: 'org1' });
  assert.equal(r.activityType, 'business');
  assert.equal(r.reason, 'organization_linked');
});

test('resolver: GROUP is only ever taken from a real selected slot, never guessed', () => {
  // No slot: a deal that would "look" like a group booking still resolves private.
  assert.equal(resolveActivityType({ activityType: null }, {}).activityType, 'private');
  // With a real group slot the group meaning is explicit evidence, not a guess.
  const g = resolveActivityType({ activityType: null }, { groupSlotSelected: true });
  assert.equal(g.activityType, 'group');
  assert.equal(g.reason, 'group_slot_selected');
});

test('settledPaymentStateFor only trusts causes that PROVE money moved', () => {
  assert.deepEqual(settledPaymentStateFor({ wonActor: { cause: 'icount_payment' } }), { paymentStatus: 'paid' });
  assert.deepEqual(settledPaymentStateFor({ wonActor: { cause: 'woo_order' } }), { paymentStatus: 'paid' });
  assert.deepEqual(settledPaymentStateFor({ wonActor: { cause: 'no_payment' } }), { paymentStatus: 'waived' });
  // An operator's manual WON is NOT evidence of payment — stamp nothing.
  assert.equal(settledPaymentStateFor({ wonActor: { cause: 'manual' } }), null);
  assert.equal(settledPaymentStateFor({ wonActor: { cause: 'historical_correction' } }), null);
  assert.equal(settledPaymentStateFor({}), null);
});

// ── Scenario A — operator/phone payment on a deal with no activityType ───────

test('A: payment on a deal with NO activityType still creates the tour (the #27105 fix)', async () => {
  const c = makeStore({
    deals: {
      d1: {
        id: 'd1', orderNo: 27105, status: 'open', activityType: null, organizationId: null,
        productId: 'p1', productVariantId: 'v1', locationId: 'loc1',
        tourDate: '2026-09-07', tourTime: '20:00', participants: 2, tourLanguage: 'he',
      },
    },
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1' });

  assert.equal(res.wonNow, true);
  assert.equal(res.tourCreated, true, 'the sale was not blocked by the unchosen type');
  const tour = Object.values(c._s.tours)[0];
  assert.ok(tour, 'a TourEvent exists');
  assert.equal(tour.kind, 'private');
  assert.equal(tour.date, '2026-09-07');
  assert.equal(tour.startTime, '20:00');
  // The fallback is PERSISTED — one truth, and readable by pricing/reports/CC.
  assert.equal(c._s.deals.d1.activityType, 'private');
  assert.ok(c._s.deals.d1.activityTypeAssumedAt instanceof Date, 'the assumption is stamped, not hidden');
  // …and recorded where a human will read it.
  const assumedEvent = tl(c, 'activity_type_assumed');
  assert.ok(assumedEvent, 'the timeline says the type was completed automatically');
  assert.equal(assumedEvent.data.reason, 'default_private');
  // The money reached the seat line.
  const reg = c._s.registrations[0];
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.paymentStatus, 'paid');
  assert.ok(reg.confirmedAt, 'confirmedAt is stamped');
  // And exactly one card asks the operator to confirm what we assumed.
  assert.equal(c._s.reviews.length, 1);
  assert.equal(c._s.reviews[0].kind, 'post_payment_completion');
  assert.deepEqual(c._s.reviews[0].data.assumed.map((a) => a.field), ['activityType']);
});

test('A: a deal that already has its type is settled with NO assumption and NO card', async () => {
  const c = makeStore({
    deals: {
      d1: {
        id: 'd1', orderNo: 27106, status: 'open', activityType: 'private', organizationId: null,
        productId: 'p1', productVariantId: 'v1', locationId: 'loc1',
        tourDate: '2026-09-07', tourTime: '20:00', participants: 2, tourLanguage: 'he',
      },
    },
  });
  await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(c._s.deals.d1.activityTypeAssumedAt, undefined, 'nothing was assumed');
  assert.equal(tl(c, 'activity_type_assumed'), null);
  assert.equal(c._s.reviews.length, 0, 'a complete deal raises no review noise');
});

test('A: an org-linked deal falls back to BUSINESS, never private', async () => {
  const c = makeStore({
    deals: {
      d1: {
        id: 'd1', orderNo: 27107, status: 'open', activityType: null, organizationId: 'org1',
        productId: 'p1', productVariantId: 'v1', locationId: 'loc1',
        tourDate: '2026-09-07', tourTime: '20:00', participants: 12, tourLanguage: 'he',
      },
    },
  });
  await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(c._s.deals.d1.activityType, 'business');
  assert.equal(Object.values(c._s.tours)[0].kind, 'business');
});

// ── Scenario D — a group deal is never guessed into existence ────────────────

test('D: group deal with no slot stays honest — WON, no tour, no private fallback', async () => {
  const c = makeStore({
    deals: {
      d1: {
        id: 'd1', orderNo: 27069, status: 'open', activityType: 'group', organizationId: null,
        participants: 10,
      },
    },
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1' });

  assert.equal(res.wonNow, true, 'the money is real — WON stands');
  assert.equal(c._s.deals.d1.status, 'won');
  assert.equal(res.tourCreated, false);
  assert.equal(Object.keys(c._s.tours).length, 0, 'no tour was invented');
  assert.equal(c._s.deals.d1.activityType, 'group', 'group was NOT overwritten with private');
  assert.equal(res.needsSlot, true);
  assert.ok(tl(c, 'won_without_tour'), 'the gap is stated on the timeline');
  // The operator is told what is outstanding.
  assert.equal(c._s.reviews.length, 1);
  assert.equal(c._s.reviews[0].data.needsSlot, true);
});

test('D: a deal missing REAL planning data is not rescued by the fallback', async () => {
  // activityType resolves to private, but there is still no date/product — the
  // fallback fixes the classification, never the absence of a plan.
  const c = makeStore({
    deals: { d1: { id: 'd1', orderNo: 27070, status: 'open', activityType: null, participants: 3 } },
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(res.wonNow, true);
  assert.equal(res.tourCreated, false);
  assert.equal(Object.keys(c._s.tours).length, 0);
  const missing = res.missing.map((m) => m.field);
  assert.ok(missing.includes('tourDate'), 'the genuinely missing fields are reported');
  assert.ok(!missing.includes('activityType'), 'the resolved type is no longer "missing"');
});

// ── Scenario E — a later tour update must not erode the settlement ───────────

test('E: a confirmed PAID registration survives a later tour sync (no downgrade)', async () => {
  const c = makeStore({
    tours: { t1: { id: 't1', kind: 'private', status: 'scheduled' } },
    registrations: [{
      id: 'r1', dealId: 'd1', tourEventId: 't1', bookingId: 'bk1', source: 'deal',
      status: 'confirmed', paymentStatus: 'paid', confirmedAt: new Date('2026-08-06'),
      quantity: 2, productVariantId: 'v1',
    }],
  });
  // The kind of sync "עדכון סיור" runs after a date change.
  await syncDealRegistration(
    c,
    { id: 'bk1', dealId: 'd1', seats: 2, status: 'active' },
    { id: 't1', kind: 'private' },
    { productVariantId: 'v1' },
  );
  const r = c._s.registrations[0];
  assert.equal(r.status, 'confirmed', 'confirmed is never downgraded to legacy active');
  assert.equal(r.paymentStatus, 'paid', 'the money state survives');
  assert.ok(r.confirmedAt, 'confirmedAt survives');
  assert.equal(c._s.registrations.length, 1, 'no duplicate seat line');
});

test('E: a cancelled booking still collapses its registration (no over-preservation)', async () => {
  const c = makeStore({
    tours: { t1: { id: 't1', kind: 'private', status: 'scheduled' } },
    registrations: [{
      id: 'r1', dealId: 'd1', tourEventId: 't1', bookingId: 'bk1', source: 'deal',
      status: 'confirmed', paymentStatus: 'paid', quantity: 2, productVariantId: 'v1',
    }],
  });
  await syncDealRegistration(
    c,
    { id: 'bk1', dealId: 'd1', seats: 2, status: 'cancelled' },
    { id: 't1', kind: 'private' },
  );
  assert.equal(c._s.registrations[0].status, 'cancelled', 'a dead booking still releases the seat');
});

// ── the shared money stamp ───────────────────────────────────────────────────

test('stampSettledRegistration is idempotent — a retry never rewrites confirmedAt', async () => {
  const first = new Date('2026-08-06T14:38:59Z');
  const c = makeStore({
    registrations: [{
      id: 'r1', dealId: 'd1', tourEventId: 't1', status: 'confirmed',
      paymentStatus: 'paid', confirmedAt: first, quantity: 2,
    }],
  });
  const n = await stampSettledRegistration(c, { dealId: 'd1', tourEventId: 't1', paymentStatus: 'paid' });
  assert.equal(n, 0, 'an already-settled row is left alone');
  assert.equal(c._s.registrations[0].confirmedAt, first);
});

test('stampSettledRegistration upgrades a legacy active row (the recovery repair)', async () => {
  const c = makeStore({
    registrations: [{
      id: 'r1', dealId: 'd1', tourEventId: 't1', status: 'active',
      paymentStatus: null, confirmedAt: null, quantity: 2,
    }],
  });
  const n = await stampSettledRegistration(c, { dealId: 'd1', tourEventId: 't1', paymentStatus: 'paid' });
  assert.equal(n, 1);
  const r = c._s.registrations[0];
  assert.equal(r.status, 'confirmed');
  assert.equal(r.paymentStatus, 'paid');
  assert.ok(r.confirmedAt);
});

test('stampSettledRegistration refuses to invent a payment with no evidence', async () => {
  const c = makeStore({
    registrations: [{ id: 'r1', dealId: 'd1', tourEventId: 't1', status: 'active', quantity: 2 }],
  });
  assert.equal(await stampSettledRegistration(c, { dealId: 'd1', tourEventId: 't1', paymentStatus: null }), 0);
  assert.equal(c._s.registrations[0].status, 'active', 'untouched without proven payment');
});
