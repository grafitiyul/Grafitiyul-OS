import test from 'node:test';
import assert from 'node:assert/strict';
import { wonGate, pendingTourUpdate, GROUP_LOCKED_FIELDS } from './tourFromDeal.js';

// The WON gate contract: no drafts — missing fields refuse WON; a group deal
// whose deal-side fields are complete still needs a target slot.

const FULL_PRIVATE = {
  activityType: 'private',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: '2026-08-01',
  tourTime: '17:00',
  participants: 20,
  tourLanguage: 'he',
};

test('wonGate: complete private deal passes with no slot needed', () => {
  const g = wonGate(FULL_PRIVATE, undefined);
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, false);
});

test('wonGate: missing activityType is itself a missing field', () => {
  const g = wonGate({ ...FULL_PRIVATE, activityType: null }, undefined);
  assert.deepEqual(g.missing.map((m) => m.field), ['activityType']);
});

test('wonGate: complete group deal without a slot demands one', () => {
  const g = wonGate({ activityType: 'group', participants: 12 }, undefined);
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, true);
});

test('wonGate: group deal with a slot chosen passes', () => {
  const g = wonGate({ activityType: 'group', participants: 12 }, 'tour123');
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, false);
});

test('wonGate: incomplete group deal reports fields BEFORE demanding a slot', () => {
  const g = wonGate({ activityType: 'group', participants: null }, undefined);
  assert.deepEqual(g.missing.map((m) => m.field), ['participants']);
  assert.equal(g.needsSlot, false);
});

test('group locked fields cover exactly the slot-owned planning fields', () => {
  assert.deepEqual(
    [...GROUP_LOCKED_FIELDS].sort(),
    ['locationId', 'productId', 'productVariantId', 'tourDate', 'tourLanguage', 'tourTime'].sort(),
  );
});

// ── pendingTourUpdate — the DERIVED deal-vs-tour diff (Pending Tour Update) ──

const APPLIED_TOUR = {
  kind: 'private',
  status: 'scheduled',
  date: '2026-08-01',
  startTime: '17:00',
  tourLanguage: 'he',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
};
const APPLIED_BOOKING = { status: 'active', seats: 20, tourEvent: APPLIED_TOUR };

test('pending: deal in sync with its tour → empty diff', () => {
  assert.deepEqual(pendingTourUpdate(FULL_PRIVATE, APPLIED_BOOKING), []);
});

test('pending: every changed tour-affecting field is reported with its Hebrew label', () => {
  const deal = {
    ...FULL_PRIVATE,
    tourDate: '2026-08-02',
    tourTime: '18:30',
    productVariantId: 'v2',
    participants: 25,
  };
  const diff = pendingTourUpdate(deal, APPLIED_BOOKING);
  assert.deepEqual(
    diff.map((d) => d.field).sort(),
    ['participants', 'productVariantId', 'tourDate', 'tourTime'].sort(),
  );
  for (const d of diff) assert.equal(typeof d.labelHe, 'string');
});

test('pending: a CLEARED deal date pends as a POSTPONE (date+time removal)', () => {
  const deal = { ...FULL_PRIVATE, tourDate: null, tourTime: '' };
  const diff = pendingTourUpdate(deal, APPLIED_BOOKING);
  assert.deepEqual(diff.map((d) => d.field).sort(), ['tourDate', 'tourTime']);
  const date = diff.find((d) => d.field === 'tourDate');
  assert.equal(date.dealValue, null);
  assert.equal(date.tourValue, '2026-08-01');
});

test('pending: a cleared deal TIME alone never syncs, so never pends', () => {
  const deal = { ...FULL_PRIVATE, tourTime: null };
  assert.deepEqual(pendingTourUpdate(deal, APPLIED_BOOKING), []);
});

const POSTPONED_TOUR = { ...APPLIED_TOUR, status: 'postponed', date: null, startTime: null };
const POSTPONED_BOOKING = { ...APPLIED_BOOKING, tourEvent: POSTPONED_TOUR };

test('pending: postponed tour + deal date AND time → pends as a RESCHEDULE', () => {
  const deal = { ...FULL_PRIVATE, tourDate: '2026-09-01', tourTime: '10:00' };
  const diff = pendingTourUpdate(deal, POSTPONED_BOOKING);
  assert.deepEqual(diff.map((d) => d.field).sort(), ['tourDate', 'tourTime']);
});

test('pending: postponed tour — a date WITHOUT a time never pends (scheduling needs both)', () => {
  assert.deepEqual(
    pendingTourUpdate({ ...FULL_PRIVATE, tourDate: '2026-09-01', tourTime: null }, POSTPONED_BOOKING),
    [],
  );
  // and a fully-cleared deal on a postponed tour is already in sync.
  assert.deepEqual(
    pendingTourUpdate({ ...FULL_PRIVATE, tourDate: null, tourTime: null }, POSTPONED_BOOKING),
    [],
  );
});

test('pending: postponed tour — non-date fields (language/variant) still pend', () => {
  const deal = { ...FULL_PRIVATE, tourDate: null, tourTime: null, tourLanguage: 'en' };
  const diff = pendingTourUpdate(deal, POSTPONED_BOOKING);
  assert.deepEqual(diff.map((d) => d.field), ['tourLanguage']);
});

test('pending: group slots never pend (slot-owned planning, fields locked on the deal)', () => {
  const booking = {
    ...APPLIED_BOOKING,
    tourEvent: { ...APPLIED_TOUR, kind: 'group_slot', date: '2026-09-09' },
  };
  assert.deepEqual(pendingTourUpdate(FULL_PRIVATE, booking), []);
});

test('pending: cancelled/completed tours and non-active bookings never pend', () => {
  const changed = { ...FULL_PRIVATE, tourDate: '2026-08-02' };
  for (const status of ['cancelled', 'completed']) {
    assert.deepEqual(
      pendingTourUpdate(changed, { ...APPLIED_BOOKING, tourEvent: { ...APPLIED_TOUR, status } }),
      [],
    );
  }
  assert.deepEqual(pendingTourUpdate(changed, { ...APPLIED_BOOKING, status: 'orphaned' }), []);
  assert.deepEqual(pendingTourUpdate(changed, null), []);
});
