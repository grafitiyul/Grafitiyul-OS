import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversionMode,
  convertDealActivityType,
  hasOperationalState,
  ConversionError,
} from './activityConversion.js';
import { parkDealTourDeliveries } from '../communication/reconcileDealTour.js';
import { makeConversionStore, WON_FIELDS, CAP } from './conversionTestStore.js';

// The conversion contract, exercised end-to-end against an in-memory store that
// runs the REAL orchestration (tourFromDeal, registrations, the classification
// rule). The fake is deliberately faithful on the two things the whole design
// rests on: the one-active-booking partial unique, and the fact that seats live
// on TicketRegistration rather than on Booking.
//
// Read alongside activityConversion.prismaShape.test.js — a green fake proves
// the LOGIC, the DMMF walk proves the FIELD NAMES, and production verification
// on throwaway deals proves the whole thing. None of the three is sufficient
// alone (the fake-db blind spot).

// ── fixtures ────────────────────────────────────────────────────────────────


function groupDealStore() {
  return makeConversionStore({
    deals: { d1: { id: 'd1', orderNo: 27001, activityType: 'group', ...WON_FIELDS } },
    tours: {
      slot1: {
        id: 'slot1', kind: 'group_slot', status: 'scheduled',
        date: '2026-09-10', startTime: '10:00', capacity: 20,
        productVariantId: 'v1', locationId: 'l1', tourLanguage: 'he',
      },
    },
    bookings: [{ id: 'bk1', dealId: 'd1', tourEventId: 'slot1', seats: 4, status: 'active' }],
    registrations: [
      { id: 'reg1', dealId: 'd1', bookingId: 'bk1', tourEventId: 'slot1', quantity: 4, status: 'active', source: 'deal' },
    ],
  });
}

function privateDealStore() {
  return makeConversionStore({
    deals: { d1: { id: 'd1', orderNo: 27002, activityType: 'private', ...WON_FIELDS } },
    tours: {
      t1: {
        id: 't1', kind: 'private', status: 'scheduled',
        date: '2026-09-10', startTime: '10:00',
        productId: 'p1', productVariantId: 'v1', locationId: 'l1', tourLanguage: 'he',
      },
      slot1: {
        id: 'slot1', kind: 'group_slot', status: 'scheduled',
        date: '2026-11-02', startTime: '11:00', capacity: 20,
        productVariantId: 'v1', locationId: 'l1', tourLanguage: 'he',
      },
    },
    bookings: [{ id: 'bk1', dealId: 'd1', tourEventId: 't1', seats: 4, status: 'active' }],
    registrations: [
      { id: 'reg1', dealId: 'd1', bookingId: 'bk1', tourEventId: 't1', quantity: 4, status: 'active', source: 'deal' },
    ],
  });
}

const run = (db, over = {}) =>
  convertDealActivityType(
    { dealId: 'd1', targetActivityType: 'private', opId: `op-${Math.random()}`, ...over },
    { db },
  );

const liveSeatsOn = (db, tourId) =>
  db._s.registrations
    .filter((r) => r.tourEventId === tourId && CAP.includes(r.status))
    .reduce((n, r) => n + r.quantity, 0);

const activeBookings = (db) => db._s.bookings.filter((b) => b.status === 'active');
const conversionEntry = (db) =>
  db._s.timeline.find((t) => t.data?.event === 'activity_type_converted' && t.subjectType === 'deal') || null;

// ── the matrix (spec §16) ───────────────────────────────────────────────────

test('the matrix resolves a mode for every ordered pair, both directions', () => {
  assert.equal(conversionMode('private', 'business'), 'update_kind');
  assert.equal(conversionMode('business', 'private'), 'update_kind');
  assert.equal(conversionMode('private', 'group'), 'join_slot');
  assert.equal(conversionMode('business', 'group'), 'join_slot');
  assert.equal(conversionMode('group', 'private'), 'replace_tour');
  assert.equal(conversionMode('group', 'business'), 'replace_tour');
});

test('same-type conversion is REFUSED (spec §17.7)', () => {
  for (const t of ['group', 'private', 'business']) {
    assert.throws(() => conversionMode(t, t), (e) => e.code === 'same_activity_type');
  }
});

// ── 1 + 2: group → private / business ───────────────────────────────────────

test('group → private: seats released exactly once, one active booking, own tour', async () => {
  const db = groupDealStore();
  const out = await run(db);

  assert.equal(out.mode, 'replace_tour');
  assert.equal(db._s.deals.d1.activityType, 'private');
  // §17.9 — the group slot's seats are released, once.
  assert.equal(liveSeatsOn(db, 'slot1'), 0, 'old group seats released');
  // §17.10 — allocated on the new tour, once.
  assert.equal(liveSeatsOn(db, out.newTourEventId), 4, 'new seats allocated exactly once');
  // §17 — exactly ONE active booking survives (the partial unique would have
  // thrown had the service created before cancelling).
  assert.equal(activeBookings(db).length, 1);
  assert.equal(activeBookings(db)[0].tourEventId, out.newTourEventId);
  // The group slot itself lives on — other customers are on it.
  assert.equal(db._s.tours.slot1.status, 'scheduled', 'the group slot is never cancelled');
  // §17.12 — the new tour is the deal's own, created once.
  assert.equal(db._s.tours[out.newTourEventId].kind, 'private');
});

test('group → business: identical structure, business kind', async () => {
  const db = groupDealStore();
  const out = await run(db, { targetActivityType: 'business' });
  assert.equal(db._s.deals.d1.activityType, 'business');
  assert.equal(db._s.tours[out.newTourEventId].kind, 'business');
  assert.equal(liveSeatsOn(db, 'slot1'), 0);
  assert.equal(activeBookings(db).length, 1);
});

// ── 3 + 4: private / business → group ───────────────────────────────────────

test('private → group: the private tour is released and the slot consumed', async () => {
  const db = privateDealStore();
  const out = await run(db, { targetActivityType: 'group', tourEventId: 'slot1' });

  assert.equal(out.mode, 'join_slot');
  assert.equal(db._s.deals.d1.activityType, 'group');
  assert.equal(out.newTourEventId, 'slot1');
  // §17.11 — the emptied private tour auto-cancels.
  assert.equal(db._s.tours.t1.status, 'cancelled');
  assert.equal(liveSeatsOn(db, 't1'), 0);
  assert.equal(liveSeatsOn(db, 'slot1'), 4);
  assert.equal(activeBookings(db).length, 1);
  // §10 — the released tour's operational state is preserved for a conversion
  // back, exactly the way reopen-with-remove preserves it.
  assert.ok(db._s.plans.d1, 'the tour state was copied onto the deal plan');
});

test('business → group: same path (business is not a special case)', async () => {
  const db = privateDealStore();
  db._s.deals.d1.activityType = 'business';
  db._s.tours.t1.kind = 'business';
  const out = await run(db, { targetActivityType: 'group', tourEventId: 'slot1' });
  assert.equal(out.newTourEventId, 'slot1');
  assert.equal(db._s.tours.t1.status, 'cancelled');
  assert.equal(liveSeatsOn(db, 'slot1'), 4);
});

test('private → group with NO slot chosen is refused — a slot is never guessed', async () => {
  const db = privateDealStore();
  await assert.rejects(
    run(db, { targetActivityType: 'group' }),
    (e) => e instanceof ConversionError && e.code === 'tour_slot_required',
  );
  // §17.24 — a refusal leaves the original state untouched.
  assert.equal(db._s.deals.d1.activityType, 'private');
  assert.equal(db._s.tours.t1.status, 'scheduled');
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

// ── 5 + 6: private ⇄ business — the SMALLEST correct mutation ───────────────

test('private → business keeps the SAME TourEvent and booking (spec §17.25)', async () => {
  const db = privateDealStore();
  const out = await run(db, { targetActivityType: 'business' });

  assert.equal(out.mode, 'update_kind');
  assert.equal(out.newTourEventId, 't1', 'the same tour row — gallery/payroll/calendar identity survives');
  assert.equal(db._s.tours.t1.kind, 'business');
  assert.equal(db._s.tours.t1.status, 'scheduled', 'never cancelled');
  assert.equal(db._s.bookings.length, 1, 'no second booking row');
  assert.equal(db._s.bookings[0].id, 'bk1', 'the SAME booking');
  assert.equal(liveSeatsOn(db, 't1'), 4, 'seats untouched');
  assert.equal(out.seatsReleased, false);
  // The calendar summary is derived from kind, so the mirror is re-pended.
  assert.equal(db._s.tours.t1.gcalSyncStatus, 'pending');
});

test('business → private is the same in-place update, in reverse', async () => {
  const db = privateDealStore();
  db._s.deals.d1.activityType = 'business';
  db._s.tours.t1.kind = 'business';
  const out = await run(db, { targetActivityType: 'private' });
  assert.equal(out.newTourEventId, 't1');
  assert.equal(db._s.tours.t1.kind, 'private');
  assert.equal(db._s.bookings.length, 1);
});

// ── capacity (spec §17.8) ───────────────────────────────────────────────────

test('insufficient slot capacity blocks BEFORE any write', async () => {
  const db = privateDealStore();
  db._s.tours.slot1.capacity = 2; // the deal needs 4
  await assert.rejects(
    run(db, { targetActivityType: 'group', tourEventId: 'slot1' }),
    (e) => e.code === 'tour_full',
  );
  // Byte-identical: nothing released, nothing cancelled, nothing reclassified.
  assert.equal(db._s.deals.d1.activityType, 'private');
  assert.equal(db._s.tours.t1.status, 'scheduled');
  assert.equal(liveSeatsOn(db, 't1'), 4);
  assert.equal(liveSeatsOn(db, 'slot1'), 0);
  assert.equal(activeBookings(db).length, 1);
});

test('the operator may still deliberately overbook — the EXISTING rule, reused', async () => {
  const db = privateDealStore();
  db._s.tours.slot1.capacity = 2;
  const out = await run(db, { targetActivityType: 'group', tourEventId: 'slot1', allowOverbook: true });
  assert.equal(out.newTourEventId, 'slot1');
  assert.equal(liveSeatsOn(db, 'slot1'), 4);
});

test('a cancelled slot is refused before any write', async () => {
  const db = privateDealStore();
  db._s.tours.slot1.status = 'cancelled';
  await assert.rejects(
    run(db, { targetActivityType: 'group', tourEventId: 'slot1' }),
    (e) => e.code === 'tour_slot_not_scheduled',
  );
  assert.equal(db._s.deals.d1.activityType, 'private');
});

test('a non-slot target is refused before any write', async () => {
  const db = privateDealStore();
  await assert.rejects(
    run(db, { targetActivityType: 'group', tourEventId: 't1' }),
    (e) => e.code === 'tour_slot_invalid',
  );
  assert.equal(db._s.deals.d1.activityType, 'private');
});

// ── money (spec §17.13) ─────────────────────────────────────────────────────

test('conversion touches NO money: value, currency and evidence are untouched', async () => {
  const db = groupDealStore();
  const before = { ...db._s.deals.d1 };
  await run(db);
  assert.equal(db._s.deals.d1.valueMinor, before.valueMinor, 'the agreed amount is not rewritten');
  assert.equal(db._s.deals.d1.currency, before.currency);
  // The service never reaches for an accounting table at all — the strongest
  // possible statement of §8, and the reason payment survives for free.
  assert.equal(db.icountDocument, undefined);
  assert.equal(db.dealCollectionEvidence, undefined);
});

// ── organization (decision D1) ──────────────────────────────────────────────

test('an org-linked deal converting away from business DEMANDS an explicit choice', async () => {
  const db = groupDealStore();
  db._s.deals.d1.activityType = 'business';
  db._s.deals.d1.organizationId = 'org1';
  db._s.orgs.org1 = { id: 'org1', organizationTypeId: 'ot1' };
  await assert.rejects(
    run(db, { targetActivityType: 'private' }),
    (e) => e.code === 'organization_choice_required',
  );
  assert.equal(db._s.deals.d1.activityType, 'business', 'nothing decided for the operator');
});

test('"keep" preserves the organization on a now-private deal', async () => {
  const db = groupDealStore();
  db._s.deals.d1.activityType = 'business';
  db._s.deals.d1.organizationId = 'org1';
  db._s.orgs.org1 = { id: 'org1', organizationTypeId: 'ot1' };
  await run(db, { targetActivityType: 'private', organizationChoice: 'keep' });
  assert.equal(db._s.deals.d1.activityType, 'private');
  assert.equal(db._s.deals.d1.organizationId, 'org1', 'the organization stays linked');
});

test('"remove" unlinks the organization AND its unit — never silently', async () => {
  const db = groupDealStore();
  db._s.deals.d1.activityType = 'business';
  db._s.deals.d1.organizationId = 'org1';
  db._s.deals.d1.organizationUnitId = 'unit1';
  db._s.orgs.org1 = { id: 'org1', organizationTypeId: 'ot1' };
  await run(db, { targetActivityType: 'private', organizationChoice: 'remove' });
  assert.equal(db._s.deals.d1.organizationId, null);
  assert.equal(db._s.deals.d1.organizationUnitId, null, 'a unit cannot outlive its organization');
});

// ── idempotency (spec §17.19) ───────────────────────────────────────────────

test('replaying the SAME opId is a no-op — no duplicate tour, booking or seats', async () => {
  const db = groupDealStore();
  const opId = 'op-fixed';
  const first = await run(db, { opId });
  const toursAfterFirst = Object.keys(db._s.tours).length;
  const bookingsAfterFirst = db._s.bookings.length;
  const regsAfterFirst = db._s.registrations.length;

  const second = await run(db, { opId });
  assert.equal(second.alreadyDone, true);
  assert.equal(Object.keys(db._s.tours).length, toursAfterFirst, 'no second tour');
  assert.equal(db._s.bookings.length, bookingsAfterFirst, 'no second booking');
  assert.equal(db._s.registrations.length, regsAfterFirst, 'no second registration');
  assert.equal(liveSeatsOn(db, first.newTourEventId), 4, 'seats not double-counted');
});

test('an opId already used by ANOTHER deal is refused, not silently reused', async () => {
  const db = groupDealStore();
  await run(db, { opId: 'op-shared' });
  db._s.deals.d2 = { id: 'd2', orderNo: 27099, activityType: 'group', ...WON_FIELDS };
  await assert.rejects(
    convertDealActivityType({ dealId: 'd2', targetActivityType: 'private', opId: 'op-shared' }, { db }),
    (e) => e.code === 'conversion_op_id_conflict',
  );
});

test('a missing opId is refused — idempotency is not optional', async () => {
  const db = groupDealStore();
  await assert.rejects(
    convertDealActivityType({ dealId: 'd1', targetActivityType: 'private' }, { db }),
    (e) => e.code === 'conversion_op_id_required',
  );
});

// ── audit (spec §14 / §17) ──────────────────────────────────────────────────

test('ONE readable conversion event carries the whole story', async () => {
  const db = groupDealStore();
  const out = await run(db);
  const entry = conversionEntry(db);

  assert.ok(entry, 'a dedicated timeline entry exists — not a generic field-change line');
  assert.match(entry.body, /סוג הפעילות שונה/);
  const d = entry.data;
  assert.equal(d.from, 'group');
  assert.equal(d.to, 'private');
  assert.equal(d.mode, 'replace_tour');
  assert.equal(d.opId, out.opId);
  assert.equal(d.before.tourEventId, 'slot1');
  assert.equal(d.after.tourEventId, out.newTourEventId);
  assert.equal(d.seatsReleased, true);
  assert.equal(d.seatsAllocated, true);
  assert.equal(typeof d.pendingMessagesReconciled, 'number');
  // The tour side gets its own entry so the change is findable from the tour too.
  assert.ok(
    db._s.timeline.some((t) => t.subjectType === 'tour_event' && t.data?.event === 'activity_type_converted'),
  );
});

test('converting retires a pending system ASSUMPTION about the classification', async () => {
  const db = groupDealStore();
  db._s.deals.d1.activityTypeAssumedAt = new Date();
  await run(db);
  assert.equal(db._s.deals.d1.activityTypeAssumedAt, null, 'the operator has now answered');
});

// ── stale communications (spec §11 / §17.17) ────────────────────────────────

test('pending deliveries are re-pointed and parked; SENT history is untouched', async () => {
  const db = groupDealStore();
  db._s.deliveries = [
    { id: 'dl1', dealId: 'd1', tourEventId: 'slot1', status: 'scheduled', intendedAt: new Date() },
    { id: 'dl2', dealId: 'd1', tourEventId: 'slot1', status: 'waiting_window', intendedAt: new Date() },
    { id: 'dl3', dealId: 'd1', tourEventId: 'slot1', status: 'sent', intendedAt: new Date() },
  ];
  const out = await run(db);

  assert.deepEqual(out.deliveryIds.sort(), ['dl1', 'dl2']);
  for (const id of ['dl1', 'dl2']) {
    const row = db._s.deliveries.find((d) => d.id === id);
    assert.equal(row.tourEventId, out.newTourEventId, 'no longer points at the old tour');
    assert.equal(row.status, 'waiting_dependency', 'parked — cannot send with stale state');
    assert.ok(row.nextRetryAt > new Date(), 'held for the grace period');
  }
  const sent = db._s.deliveries.find((d) => d.id === 'dl3');
  assert.equal(sent.tourEventId, 'slot1', 'what GOS already told the customer is history');
  assert.equal(sent.status, 'sent');
});

test('parking is idempotent — a second pass finds nothing on the old tour', async () => {
  const db = groupDealStore();
  db._s.deliveries = [{ id: 'dl1', dealId: 'd1', tourEventId: 'slot1', status: 'scheduled' }];
  const first = await parkDealTourDeliveries(db, {
    dealId: 'd1', fromTourEventId: 'slot1', toTourEventId: 'tourX',
  });
  const second = await parkDealTourDeliveries(db, {
    dealId: 'd1', fromTourEventId: 'slot1', toTourEventId: 'tourX',
  });
  assert.deepEqual(first, ['dl1']);
  assert.deepEqual(second, [], 'nothing left to move');
});

// ── the guard predicate the deals router relies on ──────────────────────────

test('operational state = an active booking OR a capacity-holding registration', async () => {
  const db = groupDealStore();
  assert.equal(await hasOperationalState(db, 'd1'), true);

  const bare = makeConversionStore({ deals: { d1: { id: 'd1', activityType: 'private', status: 'open' } } });
  assert.equal(await hasOperationalState(bare, 'd1'), false, 'a plain edit stays available');

  // A cancelled booking is history, not operational state (the same distinction
  // the deal delete guard draws).
  const historic = makeConversionStore({
    deals: { d1: { id: 'd1', activityType: 'private', status: 'open' } },
    bookings: [{ id: 'bk9', dealId: 'd1', tourEventId: 't9', status: 'cancelled' }],
    registrations: [{ id: 'r9', dealId: 'd1', tourEventId: 't9', quantity: 4, status: 'cancelled' }],
  });
  assert.equal(await hasOperationalState(historic, 'd1'), false);
});

// ── an OPEN, unbooked deal converts as a pure classification change ─────────

test('an OPEN deal with no booking never grows a tour from a conversion', async () => {
  const db = makeConversionStore({
    deals: { d1: { id: 'd1', orderNo: 27050, activityType: 'private', status: 'open', participants: 4 } },
  });
  await run(db, { targetActivityType: 'group' });
  assert.equal(db._s.deals.d1.activityType, 'group');
  assert.equal(Object.keys(db._s.tours).length, 0, 'only the WON transition may create a tour');
  assert.equal(db._s.bookings.length, 0);
});
