// The Deal Merge ORCHESTRATION contract, exercised end-to-end against an
// in-memory store that runs the REAL sequencing (tourFromDeal, registrations,
// the classification rule, the collection math).
//
// Read alongside:
//   mergeResolve.test.js        — the POLICY (pure, no DB)
//   mergeLineage.test.js        — retirement, lineage, the tombstone
//   dealMerge.prismaShape.test  — the FIELD NAMES, against the generated DMMF
// None of the four is sufficient alone (the fake-db blind spot), and none
// replaces production verification on throwaway deals.
//
// Matrix cases covered here: 1-3, 9, 10, 13-15, 19, 22, 23, 24, 25.

import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMerge, mergeDeals, operationalSituation, MergeError } from './dealMerge.js';
import { makeMergeStore } from './mergeTestStore.js';

const OP = 'op-11111111-2222-3333-4444-555555555555';

// ── fixtures ────────────────────────────────────────────────────────────────

function twoPlainDeals(over = {}) {
  return makeMergeStore({
    deals: {
      a: { orderNo: 27001, title: 'דיל א', valueMinor: 120000n, participants: 10, ...(over.a || {}) },
      b: { orderNo: 27002, title: 'דיל ב', valueMinor: 0n, participants: null, ...(over.b || {}) },
    },
    dealContacts: over.dealContacts ?? [
      { id: 'dcA', dealId: 'a', contactId: 'c1', isPrimary: true, roles: [] },
      { id: 'dcB', dealId: 'b', contactId: 'c2', isPrimary: true, roles: [] },
    ],
    ...over.store,
  });
}

const decisions = (d = {}) => ({ survivorDealId: 'a', ...d });

// BigInt money does not survive JSON.stringify — the snapshot helper the
// "writes nothing" test relies on has to say so explicitly.
const snapshot = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));

// ── 1. OPEN + OPEN, one empty deal ──────────────────────────────────────────

test('a merge of two OPEN deals, one empty, needs no decisions at all', async () => {
  const db = twoPlainDeals();
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.equal(p.canMerge, true, 'nothing genuinely conflicts, so nothing is asked');
  assert.deepEqual(p.blockers, []);
  assert.equal(p.commercial.situation, 'survivor_only');
  assert.equal(p.participants.resolution, 'survivor_only');
});

test('the merge links the other deal\'s contacts and retires it', async () => {
  const db = twoPlainDeals();
  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });

  assert.equal(res.survivorDealId, 'a');
  assert.equal(res.retiredDealId, 'b');
  assert.equal(res.outcome.contactsLinked, 1);

  const links = db._s.dealContacts.filter((c) => c.dealId === 'a');
  assert.equal(links.length, 2, 'the union landed on the survivor');
  assert.equal(links.filter((l) => l.isPrimary).length, 1, 'exactly one primary');
  assert.equal(links.find((l) => l.contactId === 'c1').isPrimary, true, 'the survivor\'s primary kept it');

  assert.equal(db._s.deals.b.mergedIntoDealId, 'a');
  assert.ok(db._s.deals.b.mergedAt, 'retired, with a timestamp');
  assert.ok(db._s.deals.b.orderNo, 'the order number is untouched and never reused');
  assert.equal(db._s.merges.length, 1, 'one audit record');
});

test('the retired deal\'s own DealContact rows are left where they are', async () => {
  const db = twoPlainDeals();
  await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.ok(
    db._s.dealContacts.some((c) => c.dealId === 'b'),
    'the record of who was on THAT deal is history, not something to move',
  );
});

// ── 2. same contact on both deals ───────────────────────────────────────────

test('the same contact on both deals is deduped, never linked twice', async () => {
  const db = twoPlainDeals({
    dealContacts: [
      { id: 'dcA', dealId: 'a', contactId: 'c1', isPrimary: true, roles: ['payer'] },
      { id: 'dcB', dealId: 'b', contactId: 'c1', isPrimary: true, roles: ['coordinator'], receiveConfirmations: true },
    ],
  });
  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(res.outcome.contactsLinked, 0);
  const links = db._s.dealContacts.filter((c) => c.dealId === 'a');
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].roles.sort(), ['coordinator', 'payer']);
  assert.equal(links[0].receiveConfirmations, true, 'a routing flag either deal set survives');
});

// ── 4/5/6. commercial ───────────────────────────────────────────────────────

function withBuilders(aLines, bLines, aValue = 120000n, bValue = 90000n) {
  return makeMergeStore({
    deals: {
      a: { orderNo: 27001, title: 'א', valueMinor: aValue, participants: 10 },
      b: { orderNo: 27002, title: 'ב', valueMinor: bValue, participants: 10 },
    },
    dealContacts: [{ id: 'dcA', dealId: 'a', contactId: 'c1', isPrimary: true, roles: [] }],
    quoteVersions: [
      { id: 'vA', dealId: 'a', isWorking: true, vatMode: 'included', dealDiscountPercent: null, dealDiscountFixedMinor: null, offerId: 'oA' },
      { id: 'vB', dealId: 'b', isWorking: true, vatMode: 'included', dealDiscountPercent: null, dealDiscountFixedMinor: null, offerId: 'oB' },
    ],
    quoteOffers: [{ id: 'oA', dealId: 'a', isPrimary: true }, { id: 'oB', dealId: 'b', isPrimary: true }],
    quoteLines: [...aLines, ...bLines],
  });
}

const ql = (over) => ({
  id: 'l', quoteVersionId: 'vA', kind: 'product', label: 'סיור', quantity: 1,
  unitPriceMinor: 120000, active: true, overridden: false, sourceKind: 'price_rule',
  sourceCardGroupId: 'card1', ticketTypeId: null, productVariantId: 'v1', addonId: null,
  discountPercent: null, discountFixedMinor: null, vatMode: 'inherit', vatRate: null,
  note: '', pinnedCardGroupId: null, sortOrder: 0, ...over,
});

test('both deals commercially meaningful BLOCKS until the operator chooses', async () => {
  const db = withBuilders([ql({ id: 'la' })], [ql({ id: 'lb', quoteVersionId: 'vB', unitPriceMinor: 90000, sourceCardGroupId: 'card2' })]);
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.equal(p.canMerge, false);
  assert.ok(p.blockers.some((b) => b.code === 'commercial_choice_required'));
  assert.equal(p.commercial.mergedTotalMinor, 120000, 'the survivor\'s total stands until a choice is made');
});

test('a blocked merge writes NOTHING (matrix 23)', async () => {
  const db = withBuilders([ql({ id: 'la' })], [ql({ id: 'lb', quoteVersionId: 'vB', sourceCardGroupId: 'card2' })]);
  const before = snapshot({ deals: db._s.deals, lines: db._s.quoteLines, contacts: db._s.dealContacts });
  await assert.rejects(
    () => mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db }),
    (e) => e instanceof MergeError && e.code === 'merge_blocked',
  );
  const after = snapshot({ deals: db._s.deals, lines: db._s.quoteLines, contacts: db._s.dealContacts });
  assert.equal(after, before, 'both deals are byte-identical after a refused merge');
  assert.equal(db._s.merges.length, 0);
});

test('choosing the other deal\'s builder moves its lines and total', async () => {
  const db = withBuilders(
    [ql({ id: 'la' })],
    [ql({ id: 'lb', quoteVersionId: 'vB', unitPriceMinor: 90000, sourceCardGroupId: 'card2' })],
  );
  const res = await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ commercial: 'other' }), opId: OP },
    { db },
  );
  assert.equal(res.mergedTotalMinor, 90000);
  assert.equal(Number(db._s.deals.a.valueMinor), 90000);
  const lines = db._s.quoteLines.filter((l) => l.quoteVersionId === 'vA');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unitPriceMinor, 90000);
  assert.equal(lines[0].kind, 'manual', 'a product line from the other deal is frozen, never re-priced');
});

test('combining lines never double-counts a duplicate by default', async () => {
  // Both deals carry the SAME card+ticket line. The default selection drops the
  // duplicate, so the merged total is one line, not two.
  const db = withBuilders(
    [ql({ id: 'la' })],
    [ql({ id: 'lb', quoteVersionId: 'vB' })],
  );
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions({ commercial: 'combine' }) });
  assert.equal(p.commercial.mergedTotalMinor, 120000, 'the duplicate is not added on top');
  const res = await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ commercial: 'combine' }), opId: OP },
    { db },
  );
  assert.equal(res.outcome.linesWritten, 1);
});

test('combining explicitly-selected distinct lines sums them', async () => {
  const db = withBuilders(
    [ql({ id: 'la' })],
    [ql({ id: 'lb', quoteVersionId: 'vB', unitPriceMinor: 90000, sourceCardGroupId: 'card2' })],
  );
  const res = await mergeDeals(
    {
      dealAId: 'a', dealBId: 'b',
      decisions: decisions({ commercial: 'combine', commercialLineIds: ['la', 'lb'] }),
      opId: OP,
    },
    { db },
  );
  assert.equal(res.mergedTotalMinor, 210000, 'two genuinely different lines');
  assert.equal(res.outcome.linesWritten, 2);
  assert.equal(res.outcome.productLinesDemoted, 1);
});

test('a survivor\'s no-payment waiver still reduces the merged total', async () => {
  // The waiver stays on the survivor and the Builder stays commercial, so
  // valueMinor must remain gross − waived. Without this the merge would
  // silently bill a customer who was explicitly registered without payment.
  const db = withBuilders(
    [ql({ id: 'la', sourceKind: 'group_ticket', sourceCardGroupId: 'card1', ticketTypeId: 'tt1', quantity: 2, unitPriceMinor: 10000 })],
    [ql({ id: 'lb', quoteVersionId: 'vB', sourceKind: 'group_ticket', sourceCardGroupId: 'card2', ticketTypeId: 'tt2', quantity: 1, unitPriceMinor: 30000 })],
  );
  db._s.deals.a.noPaymentWaiver = {
    reason: 'אורח המשרד',
    lines: [{ cardGroupId: 'card1', ticketTypeId: 'tt1', quantityWaived: 1 }],
  };
  const res = await mergeDeals(
    {
      dealAId: 'a', dealBId: 'b',
      decisions: decisions({ commercial: 'combine', commercialLineIds: ['la', 'lb'] }),
      opId: OP,
    },
    { db },
  );
  // gross 2×100 + 1×300 = 500; one waived ticket at 100 → payable 400.
  assert.equal(res.mergedTotalMinor, 40000);
  assert.equal(Number(db._s.deals.a.valueMinor), 40000);
});

test('a survivor with no builder at all acquires one', async () => {
  const db = makeMergeStore({
    deals: {
      a: { orderNo: 27001, title: 'א', valueMinor: 0n },
      b: { orderNo: 27002, title: 'ב', valueMinor: 90000n },
    },
    quoteVersions: [{ id: 'vB', dealId: 'b', isWorking: true, vatMode: 'included', offerId: 'oB' }],
    quoteOffers: [{ id: 'oB', dealId: 'b', isPrimary: true }],
    quoteLines: [ql({ id: 'lb', quoteVersionId: 'vB', unitPriceMinor: 90000 })],
  });
  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(res.mergedTotalMinor, 90000);
  const created = db._s.quoteVersions.find((v) => v.dealId === 'a');
  assert.ok(created, 'a working version was created for the survivor');
  assert.equal(db._s.quoteLines.filter((l) => l.quoteVersionId === created.id).length, 1);
});

// ── 7/8. participants ───────────────────────────────────────────────────────

test('conflicting participant counts block until answered', async () => {
  const db = twoPlainDeals({ b: { participants: 6 } });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.ok(p.blockers.some((x) => x.code === 'participants_choice_required'));
});

test('a combined participant count is written to the deal', async () => {
  const db = twoPlainDeals({ b: { participants: 6 } });
  await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'combined' }), opId: OP },
    { db },
  );
  assert.equal(db._s.deals.a.participants, 16);
});

// ── 9/10/24. operational ────────────────────────────────────────────────────

function withTours({ aBooked, bBooked, sameTour = false, capacity = 20 }) {
  const tours = {
    t1: { id: 't1', kind: 'group_slot', status: 'scheduled', date: '2026-09-10', startTime: '10:00', capacity, productVariantId: 'v1' },
    t2: { id: 't2', kind: 'group_slot', status: 'scheduled', date: '2026-10-01', startTime: '10:00', capacity, productVariantId: 'v1' },
  };
  const bookings = [];
  const registrations = [];
  if (aBooked) {
    bookings.push({ id: 'bkA', dealId: 'a', tourEventId: 't1', seats: 10, status: 'active' });
    registrations.push({ id: 'regA', dealId: 'a', bookingId: 'bkA', tourEventId: 't1', quantity: 10, status: 'active', source: 'deal' });
  }
  if (bBooked) {
    const tid = sameTour ? 't1' : 't2';
    bookings.push({ id: 'bkB', dealId: 'b', tourEventId: tid, seats: 6, status: 'active' });
    registrations.push({ id: 'regB', dealId: 'b', bookingId: 'bkB', tourEventId: tid, quantity: 6, status: 'active', source: 'deal' });
  }
  return makeMergeStore({
    deals: {
      a: { orderNo: 27001, title: 'א', valueMinor: 120000n, participants: 10, status: 'won', activityType: 'group' },
      b: { orderNo: 27002, title: 'ב', valueMinor: 0n, participants: 6, status: 'won', activityType: 'group' },
    },
    dealContacts: [{ id: 'dcA', dealId: 'a', contactId: 'c1', isPrimary: true, roles: [] }],
    tours, bookings, registrations,
  });
}

test('only the RETIRED deal is live: its booking and seats move over intact', async () => {
  const db = withTours({ aBooked: false, bBooked: true });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'other' }) });
  assert.equal(p.operational.situation, 'other_only');
  assert.equal(p.operational.needsChoice, false, 'nothing to decide — there is one operational truth');

  const res = await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'other' }), opId: OP },
    { db },
  );
  assert.equal(res.outcome.bookingReparented, 'bkB');
  const bk = db._s.bookings.find((x) => x.id === 'bkB');
  assert.equal(bk.dealId, 'a', 'the SAME booking now belongs to the survivor');
  assert.equal(bk.status, 'active', 'it never stopped being active — the seat was never at risk');
  assert.equal(bk.tourEventId, 't2', 'the same tour');
  const reg = db._s.registrations.find((r) => r.id === 'regB');
  assert.equal(reg.dealId, 'a');
  assert.equal(reg.status, 'active');
  assert.equal(db._s.bookings.filter((x) => x.status === 'active').length, 1, 'exactly one live booking (matrix 24)');
});

test('only the SURVIVOR is live: its tour is untouched', async () => {
  const db = withTours({ aBooked: true, bBooked: false });
  const res = await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'survivor' }), opId: OP },
    { db },
  );
  assert.equal(res.outcome.bookingReparented, null);
  assert.equal(res.outcome.bookingCancelled, null);
  const bk = db._s.bookings.find((x) => x.id === 'bkA');
  assert.equal(bk.status, 'active');
  assert.equal(bk.seats, 10);
});

test('BOTH deals live on DIFFERENT tours: an explicit decision is required (matrix 10)', async () => {
  const db = withTours({ aBooked: true, bBooked: true });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'survivor' }) });
  assert.equal(p.operational.situation, 'both_live_different_tours');
  assert.equal(p.operational.needsChoice, true);
  assert.deepEqual(p.operational.options, ['keep_survivor_tour', 'adopt_other_tour']);
  assert.ok(p.blockers.some((b) => b.code === 'operational_choice_required'));
  assert.ok(p.operational.survivorTour && p.operational.otherTour, 'both tours are shown, never hidden');
});

test('keeping the survivor\'s tour releases the other deal\'s seats — and only those', async () => {
  const db = withTours({ aBooked: true, bBooked: true });
  await mergeDeals(
    {
      dealAId: 'a', dealBId: 'b',
      decisions: decisions({ participants: 'survivor', operational: 'keep_survivor_tour' }),
      opId: OP,
    },
    { db },
  );
  assert.equal(db._s.bookings.find((x) => x.id === 'bkA').status, 'active');
  assert.equal(db._s.bookings.find((x) => x.id === 'bkB').status, 'cancelled');
  assert.equal(db._s.registrations.find((r) => r.id === 'regB').status, 'cancelled', 'seats released');
  assert.equal(db._s.bookings.filter((x) => x.status === 'active').length, 1);
});

test('adopting the other deal\'s tour cancels the survivor\'s first (the partial unique)', async () => {
  // If the order were wrong, Booking_one_active_per_deal_key would throw — the
  // fake enforces it on UPDATE precisely so this proves the ordering.
  const db = withTours({ aBooked: true, bBooked: true });
  const res = await mergeDeals(
    {
      dealAId: 'a', dealBId: 'b',
      decisions: decisions({ participants: 'other', operational: 'adopt_other_tour' }),
      opId: OP,
    },
    { db },
  );
  assert.equal(res.outcome.bookingCancelled, 'bkA');
  assert.equal(res.outcome.bookingReparented, 'bkB');
  assert.equal(db._s.bookings.find((x) => x.id === 'bkA').status, 'cancelled');
  const moved = db._s.bookings.find((x) => x.id === 'bkB');
  assert.equal(moved.dealId, 'a');
  assert.equal(moved.status, 'active');
  assert.equal(db._s.bookings.filter((x) => x.status === 'active').length, 1);
});

test('both live on the SAME tour: seats can be merged onto one booking', async () => {
  const db = withTours({ aBooked: true, bBooked: true, sameTour: true });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'combined' }) });
  assert.equal(p.operational.situation, 'both_live_same_tour');
  assert.deepEqual(p.operational.options, ['merge_seats', 'keep_survivor_tour']);

  await mergeDeals(
    {
      dealAId: 'a', dealBId: 'b',
      decisions: decisions({ participants: 'combined', operational: 'merge_seats' }),
      opId: OP,
    },
    { db },
  );
  assert.equal(db._s.bookings.find((x) => x.id === 'bkB').status, 'cancelled');
  const kept = db._s.bookings.find((x) => x.id === 'bkA');
  assert.equal(kept.status, 'active');
  assert.equal(kept.seats, 16, 'the combined count');
  assert.equal(db._s.registrations.find((r) => r.id === 'regA').quantity, 16, 'the seat SSOT followed');
  assert.equal(db._s.bookings.filter((x) => x.status === 'active').length, 1);
});

test('merging seats past capacity is refused unless the operator overbooks', async () => {
  const db = withTours({ aBooked: true, bBooked: true, sameTour: true, capacity: 12 });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions({ participants: 'combined', operational: 'merge_seats' }) });
  assert.ok(p.blockers.some((b) => b.code === 'tour_full'));
  const ok = await previewMerge(db, {
    dealAId: 'a', dealBId: 'b',
    decisions: decisions({ participants: 'combined', operational: 'merge_seats', allowOverbook: true }),
  });
  assert.equal(ok.canMerge, true, 'the EXISTING overbook rule, never a new policy');
});

test('operationalSituation is pure and agrees with the preview', () => {
  const none = operationalSituation({ booking: null }, { booking: null });
  assert.equal(none.mode, 'none');
  assert.equal(operationalSituation({ booking: { id: 'x' }, tourEvent: { id: 't1' } }, { booking: null }).mode, 'keep_survivor');
  assert.equal(operationalSituation({ booking: null }, { booking: { id: 'y' }, tourEvent: { id: 't2' } }).mode, 'adopt_other');
});

// ── 11/12. status ───────────────────────────────────────────────────────────

test('WON + OPEN merges to WON and fires the transition exactly once', async () => {
  const db = twoPlainDeals({ a: { status: 'open' }, b: { status: 'won' } });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.equal(p.status.value, 'won');
  assert.equal(p.status.triggersWonTransition, true);

  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(db._s.deals.a.status, 'won');
  assert.ok(res.wonTransition, 'the effects emitter is handed a real transition');
  assert.ok(db._s.deals.a.wonAt, 'stamped by the canonical writer');
});

test('WON + WON does NOT re-fire the WON lifecycle', async () => {
  const db = twoPlainDeals({ a: { status: 'won', wonAt: new Date('2026-02-01') }, b: { status: 'won' } });
  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(res.wonTransition, null, 'no duplicate effects for a deal that was already WON');
  assert.deepEqual(db._s.deals.a.wonAt, new Date('2026-02-01'), 'the original close date is untouched');
});

// ── 13/14/15/25. money ──────────────────────────────────────────────────────

function withMoney({ aPaid, bPaid, aValue = 120000n }) {
  const documents = [];
  if (aPaid) documents.push({ id: 'docA', dealId: 'a', doctype: 'receipt', docnum: '1001', status: 'issued', amountMinor: aPaid, paidMinor: aPaid, currency: 'ILS', issuedAt: new Date('2026-03-01') });
  if (bPaid) documents.push({ id: 'docB', dealId: 'b', doctype: 'receipt', docnum: '1002', status: 'issued', amountMinor: bPaid, paidMinor: bPaid, currency: 'ILS', issuedAt: new Date('2026-03-02') });
  return makeMergeStore({
    deals: {
      a: { orderNo: 27001, title: 'א', valueMinor: aValue, participants: 10 },
      b: { orderNo: 27002, title: 'ב', valueMinor: 0n },
    },
    dealContacts: [{ id: 'dcA', dealId: 'a', contactId: 'c1', isPrimary: true, roles: [] }],
    documents,
  });
}

test('both deals carrying money: the combined picture is shown, nothing is moved', async () => {
  const db = withMoney({ aPaid: 50000, bPaid: 40000 });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.equal(p.money.survivor.paidMinor, 50000);
  assert.equal(p.money.other.paidMinor, 40000);
  assert.equal(p.money.combinedPaidMinor, 90000);
  assert.equal(p.money.mergedTotalMinor, 120000);
  assert.equal(p.money.mergedBalanceMinor, 30000);
});

test('issued documents are NEVER moved or deleted by a merge (matrix 14, 25)', async () => {
  const db = withMoney({ aPaid: 50000, bPaid: 40000 });
  const before = JSON.stringify(db._s.documents);
  await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(JSON.stringify(db._s.documents), before, 'every accounting row is byte-identical');
  assert.equal(db._s.documents.find((d) => d.id === 'docB').dealId, 'b', 'still attributable to its original order');
});

test('an overpaying merge is reported as a warning, never as a refund', async () => {
  const db = withMoney({ aPaid: 80000, bPaid: 60000, aValue: 100000n });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.equal(p.money.overpaidMinor, 40000);
  assert.ok(p.warnings.some((w) => w.code === 'merge_overpayment'));
  assert.equal(p.canMerge, true, 'an overpayment is a decision to make, not a reason to refuse');
});

test('mismatched currencies BLOCK — shekels are never added to dollars', async () => {
  const db = withMoney({ aPaid: 50000, bPaid: 0 });
  db._s.deals.b.currency = 'USD';
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.ok(p.blockers.some((b) => b.code === 'currency_mismatch'));
});

// ── 19. tasks ───────────────────────────────────────────────────────────────

test('an auto-task the survivor already has open is closed as a duplicate, not moved', async () => {
  // Production QA finding: every merged survivor ended up with TWO identical
  // "שיחה ראשונית" tasks, because moving was the blanket default. autoTasks
  // guarantees one per deal; a merge must not break that.
  const db = twoPlainDeals({
    store: {
      tasks: [
        { id: 'own', dealId: 'a', title: 'שיחה ראשונית', taskTypeId: 'tt_first_call', status: 'open', dueDate: new Date('2026-09-01') },
        { id: 'dup', dealId: 'b', title: 'שיחה ראשונית', taskTypeId: 'tt_first_call', status: 'open', dueDate: new Date('2026-09-02') },
        { id: 'real', dealId: 'b', title: 'להחזיר טלפון', taskTypeId: 'tt_call', status: 'open', dueDate: new Date('2026-09-03') },
      ],
    },
  });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  const byId = new Map(p.tasks.suggestions.map((s) => [s.id, s]));
  assert.equal(byId.get('dup').suggested, 'close_duplicate');
  assert.equal(byId.get('real').suggested, 'move');

  const res = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(res.outcome.tasksClosed, 1, 'the duplicate auto-task was closed');
  assert.equal(res.outcome.tasksMoved, 1, 'the real work moved');
  const open = db._s.tasks.filter((t) => t.dealId === 'a' && t.status === 'open');
  assert.equal(open.filter((t) => t.title === 'שיחה ראשונית').length, 1,
    'exactly ONE initial-call task survives — autoTasks\' own invariant holds');
  assert.equal(db._s.tasks.find((t) => t.id === 'dup').status, 'cancelled');
});

test('open tasks move by default, are never duplicated, and can be closed', async () => {
  const db = twoPlainDeals({
    store: {
      tasks: [
        { id: 't1', dealId: 'b', title: 'להתקשר', status: 'open', dueDate: new Date('2026-09-01') },
        { id: 't2', dealId: 'b', title: 'כפילות', status: 'open', dueDate: new Date('2026-09-02') },
        { id: 't3', dealId: 'b', title: 'הסטוריה', status: 'completed', dueDate: new Date('2026-08-01') },
      ],
    },
  });
  const res = await mergeDeals(
    { dealAId: 'a', dealBId: 'b', decisions: decisions({ tasks: { t2: 'close_duplicate' } }), opId: OP },
    { db },
  );
  assert.equal(res.outcome.tasksMoved, 1);
  assert.equal(res.outcome.tasksClosed, 1);
  assert.equal(db._s.tasks.find((t) => t.id === 't1').dealId, 'a', 'moved, not copied');
  assert.equal(db._s.tasks.find((t) => t.id === 't2').status, 'cancelled');
  assert.equal(db._s.tasks.find((t) => t.id === 't3').dealId, 'b', 'completed tasks stay as history');
  assert.equal(db._s.tasks.length, 3, 'nothing was duplicated');
});

// ── 22. idempotency ─────────────────────────────────────────────────────────

test('the SAME opId twice produces one merge and one outcome (matrix 22)', async () => {
  const db = twoPlainDeals();
  const first = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  const second = await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  assert.equal(first.alreadyDone, false);
  assert.equal(second.alreadyDone, true, 'the DB answered "already done", not the application');
  assert.equal(second.survivorDealId, first.survivorDealId);
  assert.equal(db._s.merges.length, 1);
  assert.equal(db._s.dealContacts.filter((c) => c.dealId === 'a').length, 2, 'contacts were not linked twice');
});

test('a deal already retired can never be merged again', async () => {
  const db = twoPlainDeals();
  await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.ok(p.blockers.some((x) => x.code === 'other_already_retired'));
});

test('a merge into a RETIRED survivor is refused', async () => {
  const db = twoPlainDeals();
  await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  const p = await previewMerge(db, { dealAId: 'b', dealBId: 'a', decisions: { survivorDealId: 'b' } });
  assert.ok(p.blockers.some((x) => x.code === 'survivor_already_retired'));
});

// ── argument validation ─────────────────────────────────────────────────────

test('a deal can never be merged with itself', async () => {
  const db = twoPlainDeals();
  await assert.rejects(
    () => previewMerge(db, { dealAId: 'a', dealBId: 'a' }),
    (e) => e.code === 'same_deal',
  );
});

test('the survivor must be one of the two deals', async () => {
  const db = twoPlainDeals();
  await assert.rejects(
    () => previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: { survivorDealId: 'zzz' } }),
    (e) => e.code === 'invalid_survivor',
  );
});

test('a merge without an opId is refused before any read', async () => {
  const db = twoPlainDeals();
  await assert.rejects(
    () => mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: null }, { db }),
    (e) => e.code === 'merge_op_id_required',
  );
});

// ── audit ───────────────────────────────────────────────────────────────────

test('the merge writes ONE audit record and one timeline event on each side', async () => {
  const db = twoPlainDeals();
  await mergeDeals({ dealAId: 'a', dealBId: 'b', decisions: decisions(), opId: OP }, { db });
  const merge = db._s.merges[0];
  assert.equal(merge.survivorOrderNo, 27001);
  assert.equal(merge.retiredOrderNo, 27002);
  assert.equal(merge.opId, OP);
  assert.ok(merge.decisions, 'the operator\'s choices are frozen');
  assert.ok(merge.outcome, 'and what actually happened');

  const survivorEvent = db._s.timeline.find((t) => t.subjectId === 'a' && t.data?.event === 'deal_merge_survivor');
  const retiredEvent = db._s.timeline.find((t) => t.subjectId === 'b' && t.data?.event === 'deal_merge_retired');
  assert.ok(survivorEvent, 'findable in the survivor\'s history');
  assert.ok(retiredEvent, 'and in the retired deal\'s');
  assert.match(retiredEvent.body, /27001/);
});

test('the plan describes what will happen, in Hebrew, before it happens', async () => {
  const db = twoPlainDeals();
  const p = await previewMerge(db, { dealAId: 'a', dealBId: 'b', decisions: decisions() });
  assert.ok(p.plan.length >= 5);
  assert.ok(p.plan.some((s) => s.includes('27002') && s.includes('27001')));
  assert.ok(p.plan.some((s) => s.includes('חשבונאיים')), 'the money promise is stated explicitly');
  assert.ok(p.plan.some((s) => s.includes('כרונולוגי')), 'and the history promise');
});
