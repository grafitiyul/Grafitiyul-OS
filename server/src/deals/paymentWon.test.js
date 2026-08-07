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
    quoteVersion: init.quoteVersion || {},
    quoteLines: init.quoteLines || [],
    icountDocs: init.icountDocs || [],
    bookings: [],
    timeline: [],
    evidence: [],
    seq: 0,
  };
  const id = (p) => `${p}${++s.seq}`;
  const CAP = ['active', 'held', 'confirmed'];
  const client = {
    _s: s,
    $transaction: async (fn) => fn(client),
    deal: {
      findUnique: async ({ where }) => s.deals[where.id] || null,
      // Merge lineage: the collection resolver asks which deals were retired
      // INTO this one so the money picture is complete. No merges in this
      // fixture, so the honest answer is an empty list.
      findMany: async () => [],
      update: async ({ where, data }) => Object.assign(s.deals[where.id], data),
      // The canonical transition's atomic race guard: status must still differ.
      updateMany: async ({ where, data }) => {
        const d = s.deals[where.id];
        if (!d) return { count: 0 };
        if (where.status?.not !== undefined && d.status === where.status.not) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      },
    },
    // Final-stage resolution (wonTransition core): highest sortOrder active stage.
    dealStage: {
      findFirst: async () => ({ id: 'stage_final', key: 'closing', label: 'סגירה' }),
      findMany: async () => [],
    },
    // buildWonQuoteRef: no primary offer in these fixtures → wonQuoteRef null.
    quoteOffer: { findFirst: async () => null },
    quoteDocument: { findFirst: async () => null },
    $executeRaw: async () => 0,
    // Register-without-payment zeroes the working version's line prices + total.
    quoteVersion: { findFirst: async ({ where }) => s.quoteVersion?.[where.dealId] || null },
    quoteLine: {
      findMany: async () => [], // no group_ticket lines → offering falls back to deal variant
      updateMany: async ({ data }) => {
        for (const l of s.quoteLines || []) l.unitPriceMinor = data.unitPriceMinor;
        return { count: (s.quoteLines || []).length };
      },
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
    // Manual-payment registration: the issued document (atomic flow) + the
    // canonical collection-evidence write path (external_approved).
    icountDocument: {
      findFirst: async ({ where }) =>
        (s.icountDocs || []).find(
          (d) => d.id === where.id && d.dealId === where.dealId && d.status === where.status,
        ) || null,
      findMany: async () => [],
    },
    dealCollectionEvidence: {
      create: async ({ data }) => {
        const r = { id: id('ev'), status: 'active', ...data };
        s.evidence.push(r);
        return r;
      },
      findMany: async ({ where }) =>
        s.evidence.filter(
          (e) =>
            (where.dealId?.in ? where.dealId.in.includes(e.dealId) : e.dealId === where.dealId) &&
            (!where.status || e.status === where.status),
        ),
    },
    dealFile: { findFirst: async () => null },
    openTourTemplateProduct: { findMany: async () => [], findFirst: async () => null },
    productVariant: { findMany: async () => [] },
    tourEventActivityComponent: { findMany: async () => [], deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    timelineEntry: {
      create: async ({ data }) => {
        const row = { id: `tl${s.timeline.length + 1}`, ...data };
        s.timeline.push(row);
        return row;
      },
      findFirst: async ({ where }) => {
        const wantEvent = where?.data?.equals;
        return (
          [...s.timeline].reverse().find(
            (t) =>
              t.subjectId === where.subjectId &&
              (where.kind ? t.kind === where.kind : true) &&
              (where.isPinned !== undefined ? !!t.isPinned === where.isPinned : true) &&
              (wantEvent ? t.data?.event === wantEvent : true),
          ) || null
        );
      },
      update: async ({ where, data }) => {
        const row = s.timeline.find((t) => t.id === where.id);
        if (row) Object.assign(row, data);
        return row || {};
      },
    },
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
  // The canonical transition owns the WHOLE lifecycle write: final pipeline
  // stage + wonAt, identically to the manual WON (was: IPN-won → wonAt null).
  assert.equal(c._s.deals.d1.dealStageId, 'stage_final');
  assert.ok(c._s.deals.d1.wonAt instanceof Date);
  assert.equal(c._s.registrations.length, 1); // no duplicate
  assert.equal(c._s.registrations[0].status, 'confirmed');
  // Idempotent: a second call is a no-op.
  const again = await settleDealWonFromPayment(c, { dealId: 'd1' });
  assert.equal(again.alreadyWon, true);
  assert.equal(c._s.bookings.length, 1); // still one booking
});

test('a payment on a deal with INCOMPLETE tour planning still WONs — without creating a broken tour', async () => {
  // A Cardcom-style payment: no activityType, no planning fields, no hold.
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: null, participants: null, orderNo: 27003 } },
  });
  const res = await settleDealWonFromPayment(c, { dealId: 'd1', paymentAmountMinor: 150000n });
  assert.equal(res.wonNow, true);
  assert.equal(res.tourCreated, false);
  assert.equal(c._s.deals.d1.status, 'won');
  assert.equal(c._s.deals.d1.dealStageId, 'stage_final');
  assert.equal(c._s.bookings.length, 0, 'no undated/broken tour is created');
  // The gap is flagged visibly for the office instead.
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'won_without_tour'));
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

test('registerWithoutPayment stores the reason canonically + WONs the deal + zeroes the total', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27012, valueMinor: 120000n } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
    quoteVersion: { d1: { id: 'qv1' } },
    quoteLines: [{ id: 'l1', unitPriceMinor: 30000n, quantity: 4, productVariantId: 'v_plain', ticketTypeId: 't_a' }],
  });
  await registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: 'אישור מנהל — לקוח VIP' });
  assert.equal(c._s.deals.d1.status, 'won');
  // Waiver model: payable total ₪0, prices UNTOUCHED (builder stays commercial),
  // and a canonical waiver snapshot recorded on the deal.
  assert.equal(Number(c._s.deals.d1.valueMinor), 0);
  assert.equal(Number(c._s.quoteLines[0].unitPriceMinor), 30000); // price PRESERVED (not zeroed)
  assert.equal(c._s.quoteLines[0].quantity, 4); // quantity preserved
  assert.ok(c._s.deals.d1.noPaymentWaiver, 'a canonical waiver is recorded');
  const reg = c._s.registrations.find((r) => r.dealId === 'd1');
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.paymentStatus, 'waived'); // not a fabricated payment
  assert.equal(reg.noPaymentReason, 'אישור מנהל — לקוח VIP');
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'no_payment_won'));
  // A PINNED note surfaces the reason near the top (PART 7).
  const pinned = c._s.timeline.filter((t) => t.data?.event === 'no_payment_note');
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].isPinned, true);
  assert.match(pinned[0].body, /רישום ללא תשלום/);
});

test('registerWithoutPayment (free) writes NO payment evidence and issues NO document', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27020, valueMinor: 90000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
  });
  await registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: 'שובר' });
  assert.equal(c._s.deals.d1.status, 'won');
  assert.equal(c._s.evidence.length, 0, 'free registration never fabricates money records');
});

// ── manual payment (paid outside GOS) ────────────────────────────────────────
import { registerWithManualPayment } from './registrationCompletion.js';

test('manual payment (record): the issued DOCUMENT is the money record — no evidence row, WON once, price retained', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27021, valueMinor: 90000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
    icountDocs: [{ id: 'doc1', dealId: 'd1', status: 'issued', docnum: '38600', doctype: 'invrec', amountMinor: 90000n }],
  });
  const res = await registerWithManualPayment(c, {
    dealId: 'd1', tourEventId: 'slot1', mode: 'record', method: 'bit', icountDocumentId: 'doc1',
  });
  assert.equal(res.wonNow, true);
  assert.equal(c._s.deals.d1.status, 'won');
  // The commercial total is NEVER zeroed and no waiver is recorded.
  assert.equal(Number(c._s.deals.d1.valueMinor), 90000);
  assert.equal(c._s.deals.d1.noPaymentWaiver ?? null, null);
  // The invrec is the canonical money record — an evidence row too would
  // DOUBLE-COUNT the same money in collection.
  assert.equal(c._s.evidence.length, 0, 'no manual_payment evidence next to the invrec');
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'manual_payment_won' && t.data?.docnum === '38600'));
  // One registration, confirmed, honest paymentStatus.
  const regs = c._s.registrations.filter((r) => r.dealId === 'd1');
  assert.equal(regs.length, 1);
  assert.equal(regs[0].status, 'confirmed');
  assert.equal(regs[0].paymentStatus, 'paid');
});

test('manual payment (record): ATOMIC — no document, no WON, nothing written', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 2, orderNo: 27025, valueMinor: 50000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20 } },
  });
  // The doc flow was cancelled/failed → the registration call never carries a
  // document id, and the server refuses BEFORE any state change.
  await assert.rejects(
    () => registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'record', method: 'bit' }),
    (e) => e.code === 'document_required',
  );
  // A foreign/unissued document id is refused the same way.
  await assert.rejects(
    () => registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'record', icountDocumentId: 'nope' }),
    (e) => e.code === 'document_required',
  );
  assert.equal(c._s.deals.d1.status, 'open', 'no WON');
  assert.equal(c._s.evidence.length, 0, 'no payment');
  assert.equal(c._s.registrations.length, 0, 'no partial state');
});

test('manual payment: duplicate click → ONE WON transition, no extra writes', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 2, productVariantId: 'v_plain', orderNo: 27022, valueMinor: 50000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
    icountDocs: [{ id: 'doc1', dealId: 'd1', status: 'issued', docnum: '38601', doctype: 'invrec', amountMinor: 50000n }],
  });
  const first = await registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'record', method: 'cash', icountDocumentId: 'doc1' });
  const second = await registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'record', method: 'cash', icountDocumentId: 'doc1' });
  assert.equal(first.wonNow, true);
  assert.equal(second.alreadyWon, true);
  assert.equal(c._s.timeline.filter((t) => t.data?.event === 'manual_payment_won').length, 1);
  assert.equal(c._s.registrations.filter((r) => r.dealId === 'd1').length, 1);
});

test('external approved (no payment details): real price retained, NO fabricated payment, attested settlement + event', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27023, valueMinor: 120000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
  });
  const res = await registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'external_approved', method: 'cc' });
  assert.equal(res.wonNow, true);
  assert.equal(Number(c._s.deals.d1.valueMinor), 120000, 'commercial amount preserved');
  assert.equal(c._s.deals.d1.noPaymentWaiver ?? null, null, 'never labeled free');
  // No manual_payment row — the canonical 'settlement' decision record instead.
  assert.equal(c._s.evidence.filter((e) => e.kind === 'manual_payment').length, 0);
  const settle = c._s.evidence.filter((e) => e.kind === 'settlement');
  assert.equal(settle.length, 1);
  assert.equal(Number(settle[0].amountMinor), 120000); // the balance at decision time — a real number, not a flag
  // Future staff can see WHY the deal is WON with no recorded payment.
  assert.ok(c._s.timeline.some((t) => t.data?.event === 'external_payment_won'));
});

test('manual payment validation: an unknown mode is refused', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 2, orderNo: 27024, valueMinor: 10000n, currency: 'ILS' } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20 } },
  });
  await assert.rejects(
    () => registerWithManualPayment(c, { dealId: 'd1', tourEventId: 'slot1', mode: 'free' }),
    (e) => e.code === 'invalid_manual_mode',
  );
  assert.equal(c._s.deals.d1.status, 'open'); // nothing settled
  assert.equal(c._s.evidence.length, 0);
});

test('registerWithoutPayment repeated does NOT duplicate the pinned note', async () => {
  const c = makeStore({
    deals: { d1: { id: 'd1', status: 'open', activityType: 'group', participants: 4, productVariantId: 'v_plain', orderNo: 27013 } },
    tours: { slot1: { id: 'slot1', kind: 'group_slot', status: 'scheduled', capacity: 20, productVariantId: 'v', productId: 'p' } },
  });
  await registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: 'סיבה א' });
  await registerWithoutPayment(c, { dealId: 'd1', tourEventId: 'slot1', reason: 'סיבה ב' });
  const pinned = c._s.timeline.filter((t) => t.data?.event === 'no_payment_note');
  assert.equal(pinned.length, 1); // updated in place, never duplicated
  assert.match(pinned[0].body, /סיבה ב/); // reflects the latest reason
});
