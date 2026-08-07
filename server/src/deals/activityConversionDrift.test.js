import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDealActivityType } from './activityConversion.js';
import { isActivityTourCompatible } from '../../../shared/dealActivity.mjs';
import { makeConversionStore, WON_FIELDS, CAP } from './conversionTestStore.js';

// ── בקרה DRIFT RECOVERY — both correction directions ────────────────────────
//
// The detector (control/detectors/activityMismatch.js) never decides which side
// is right: "the customer really is on the open tour, the label is wrong" and
// "the label is right, they were put on the wrong tour" are both real, and only
// a person knows which happened. So the card offers both corrections, and BOTH
// route through this one service with a different target. The mode falls out of
// where the deal already sits — no caller picks it.

const liveSeatsOn = (db, tourId) =>
  db._s.registrations
    .filter((r) => r.tourEventId === tourId && CAP.includes(r.status))
    .reduce((n, r) => n + r.quantity, 0);

const activeBookings = (db) => db._s.bookings.filter((b) => b.status === 'active');

const run = (db, over = {}) =>
  convertDealActivityType(
    { dealId: 'd1', opId: `op-${Math.random()}`, ...over },
    { db },
  );

// A deal whose classification disagrees with the tour it is booked on — the
// exact state the detector raises a card for. `slot1` is a real, unrelated open
// slot, available whenever a correction genuinely needs one chosen.
function driftedStore({ dealType, tourKind }) {
  return makeConversionStore({
    deals: { d1: { id: 'd1', orderNo: 27077, activityType: dealType, ...WON_FIELDS } },
    tours: {
      t1: {
        id: 't1', kind: tourKind, status: 'scheduled',
        date: '2026-09-10', startTime: '10:00',
        capacity: tourKind === 'group_slot' ? 20 : null,
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

// ── B. "the TOUR is right — fix the deal" ───────────────────────────────────
// The deal is already booked on a tour of the target kind, so only its own
// label is wrong. Cancelling and re-creating the booking on the SAME tour would
// release and re-consume real capacity, churn Woo and the calendar and
// re-point live scheduled messages — all to correct a string.

test('deal-side fix: group deal on a private tour → private, ZERO seat churn', async () => {
  const db = driftedStore({ dealType: 'group', tourKind: 'private' });
  const out = await run(db, { targetActivityType: 'private' });

  assert.equal(out.mode, 'align_classification');
  assert.equal(db._s.deals.d1.activityType, 'private');
  assert.equal(out.newTourEventId, 't1', 'the SAME tour');
  assert.equal(db._s.bookings.length, 1, 'no second booking row');
  assert.equal(db._s.bookings[0].id, 'bk1', 'the SAME booking');
  assert.equal(db._s.bookings[0].status, 'active', 'never cancelled');
  assert.equal(liveSeatsOn(db, 't1'), 4, 'seats untouched');
  assert.equal(out.seatsReleased, false);
  assert.equal(out.seatsAllocated, false);
});

test('deal-side fix: private deal on a group slot → group, and NO slot need be chosen', async () => {
  // The deal is already on a slot — demanding one would be asking the operator
  // to re-answer a question the data already answers.
  const db = driftedStore({ dealType: 'private', tourKind: 'group_slot' });
  const out = await run(db, { targetActivityType: 'group' });

  assert.equal(out.mode, 'align_classification');
  assert.equal(db._s.deals.d1.activityType, 'group');
  assert.equal(out.newTourEventId, 't1');
  assert.equal(db._s.bookings[0].id, 'bk1');
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

test('deal-side fix: business deal on a group slot → group, ZERO churn', async () => {
  const db = driftedStore({ dealType: 'business', tourKind: 'group_slot' });
  const out = await run(db, { targetActivityType: 'group' });
  assert.equal(out.mode, 'align_classification');
  assert.equal(db._s.deals.d1.activityType, 'group');
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

// ── A. "the DEAL is right — fix the tour" ───────────────────────────────────

test('tour-side fix: a dedicated tour is NEVER renamed into an open-tour slot', async () => {
  // Renaming would invent shared stock, a capacity and a Woo variation out of
  // nothing. The only honest operation is moving the deal onto a real slot, so
  // the service refuses until one is chosen.
  const db = driftedStore({ dealType: 'group', tourKind: 'private' });
  await assert.rejects(
    run(db, { targetActivityType: 'group' }),
    (e) => e.code === 'tour_slot_required',
  );
  assert.equal(db._s.tours.t1.kind, 'private', 'not renamed');
  assert.equal(db._s.tours.t1.status, 'scheduled', 'not cancelled');
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

test('tour-side fix: with a slot chosen it performs the real operational conversion', async () => {
  const db = driftedStore({ dealType: 'group', tourKind: 'private' });
  const out = await run(db, { targetActivityType: 'group', tourEventId: 'slot1' });

  assert.equal(out.mode, 'join_slot');
  assert.equal(db._s.tours.t1.status, 'cancelled', 'the dedicated tour was released');
  assert.equal(liveSeatsOn(db, 't1'), 0, 'its seats released');
  assert.equal(liveSeatsOn(db, 'slot1'), 4, 'seats consumed on the real slot');
  assert.equal(activeBookings(db).length, 1);
  assert.equal(activeBookings(db)[0].tourEventId, 'slot1');
});

test('tour-side fix: a private deal leaves the group slot for its own tour', async () => {
  const db = driftedStore({ dealType: 'private', tourKind: 'group_slot' });
  const out = await run(db, { targetActivityType: 'private' });

  assert.equal(out.mode, 'replace_tour');
  assert.equal(liveSeatsOn(db, 't1'), 0, 'slot seats released');
  assert.equal(db._s.tours.t1.status, 'scheduled', 'the SLOT itself lives on');
  assert.equal(liveSeatsOn(db, out.newTourEventId), 4);
  assert.equal(db._s.tours[out.newTourEventId].kind, 'private');
});

test('tour-side fix: private ↔ business relabels the SAME tour in place', async () => {
  const db = driftedStore({ dealType: 'business', tourKind: 'private' });
  const out = await run(db, { targetActivityType: 'business' });

  assert.equal(out.mode, 'update_kind');
  assert.equal(out.newTourEventId, 't1');
  assert.equal(db._s.tours.t1.kind, 'business');
  assert.equal(db._s.bookings[0].id, 'bk1');
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

// ── the card must be able to close itself ───────────────────────────────────

test('EITHER correction leaves the pair COMPATIBLE, so the card auto-resolves', async () => {
  const a = driftedStore({ dealType: 'group', tourKind: 'private' });
  await run(a, { targetActivityType: 'private' });
  assert.equal(
    isActivityTourCompatible(a._s.deals.d1.activityType, a._s.tours.t1.kind),
    true,
    'deal-side correction resolves the drift',
  );

  const b = driftedStore({ dealType: 'group', tourKind: 'private' });
  const outB = await run(b, { targetActivityType: 'group', tourEventId: 'slot1' });
  assert.equal(
    isActivityTourCompatible(b._s.deals.d1.activityType, b._s.tours[outB.newTourEventId].kind),
    true,
    'tour-side correction resolves the drift',
  );
});

// ── safety ──────────────────────────────────────────────────────────────────

test('a failed correction leaves the drifted state byte-identical', async () => {
  const db = driftedStore({ dealType: 'group', tourKind: 'private' });
  db._s.tours.slot1.capacity = 1; // cannot fit the deal's 4
  await assert.rejects(
    run(db, { targetActivityType: 'group', tourEventId: 'slot1' }),
    (e) => e.code === 'tour_full',
  );
  assert.equal(db._s.deals.d1.activityType, 'group');
  assert.equal(db._s.tours.t1.status, 'scheduled');
  assert.equal(liveSeatsOn(db, 't1'), 4);
  assert.equal(liveSeatsOn(db, 'slot1'), 0);
  assert.equal(activeBookings(db).length, 1);
});

test('repeating a correction with the same opId is idempotent', async () => {
  const db = driftedStore({ dealType: 'group', tourKind: 'private' });
  const opId = 'op-drift-fixed';
  await run(db, { targetActivityType: 'private', opId });
  const bookings = db._s.bookings.length;
  const regs = db._s.registrations.length;

  const second = await run(db, { targetActivityType: 'private', opId });
  assert.equal(second.alreadyDone, true);
  assert.equal(db._s.bookings.length, bookings);
  assert.equal(db._s.registrations.length, regs);
  assert.equal(liveSeatsOn(db, 't1'), 4);
});

test('a COMPATIBLE pair is refused — there is nothing to correct', async () => {
  const db = driftedStore({ dealType: 'private', tourKind: 'private' });
  await assert.rejects(
    run(db, { targetActivityType: 'private' }),
    (e) => e.code === 'same_activity_type',
  );
});
