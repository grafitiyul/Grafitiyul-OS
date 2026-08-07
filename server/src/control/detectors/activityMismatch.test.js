import test from 'node:test';
import assert from 'node:assert/strict';
import { activityMismatch } from './activityMismatch.js';

// The predicate that would have caught the original hole: a WON group deal
// flipped to 'private' while its Booking stayed active on the group slot.

test('matching deal/tour pairs are never a mismatch', () => {
  assert.equal(activityMismatch({ activityType: 'group' }, { kind: 'group_slot' }), false);
  assert.equal(activityMismatch({ activityType: 'private' }, { kind: 'private' }), false);
  assert.equal(activityMismatch({ activityType: 'business' }, { kind: 'business' }), false);
});

test('THE hole: a group deal flipped to private while sitting on a group slot', () => {
  assert.equal(activityMismatch({ activityType: 'private' }, { kind: 'group_slot' }), true);
  assert.equal(activityMismatch({ activityType: 'business' }, { kind: 'group_slot' }), true);
});

test('the reverse hole: a group deal still on its dedicated tour', () => {
  assert.equal(activityMismatch({ activityType: 'group' }, { kind: 'private' }), true);
  assert.equal(activityMismatch({ activityType: 'group' }, { kind: 'business' }), true);
});

test('private ⇄ business IS a mismatch when the tour kind was not updated', () => {
  // The conversion service updates kind in place, so this state should never
  // arise through it — which is exactly why it is worth detecting if it does.
  assert.equal(activityMismatch({ activityType: 'private' }, { kind: 'business' }), true);
  assert.equal(activityMismatch({ activityType: 'business' }, { kind: 'private' }), true);
});

test('an UNCLASSIFIED deal is not a mismatch — that is the assumption card\'s job', () => {
  // Two cards for one problem is the thing §15 forbids. A deal with no
  // activityType is handled by resolveActivityType + the post-payment
  // completion card, not here.
  assert.equal(activityMismatch({ activityType: null }, { kind: 'group_slot' }), false);
  assert.equal(activityMismatch({ activityType: '' }, { kind: 'private' }), false);
});

test('an unknown activity type is not asserted about', () => {
  // A future type that has not been mapped yet must not produce a false
  // critical card; the mapping table (shared/dealActivity.mjs) is the gate.
  assert.equal(activityMismatch({ activityType: 'workshop_series' }, { kind: 'private' }), false);
});

test('a tour with no kind is not asserted about', () => {
  assert.equal(activityMismatch({ activityType: 'private' }, {}), false);
  assert.equal(activityMismatch({ activityType: 'private' }, null), false);
});
