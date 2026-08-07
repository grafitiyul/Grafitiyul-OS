// The ONE activity resolver (shared/dealActivity.mjs).
//
// These tests exist because the rule they describe used to live in seven
// hand-written copies, and six of them read it as an OVERRIDE rather than a
// default. The behaviour that matters most is the third test: a company that
// deliberately booked a private tour must not be answered "business", because
// that answer picks the wrong confirmation email template.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TO_TOUR_KIND,
  TOUR_KIND_TO_ACTIVITY,
  effectiveActivityType,
  hasDeliberateOrgActivityMix,
} from '../../../shared/dealActivity.mjs';

test('an explicit activity type is authoritative', () => {
  assert.equal(effectiveActivityType({ activityType: 'group' }), 'group');
  assert.equal(effectiveActivityType({ activityType: 'private' }), 'private');
  assert.equal(effectiveActivityType({ activityType: 'business' }), 'business');
});

test('an unclassified deal with a linked organization is business', () => {
  assert.equal(effectiveActivityType({ activityType: null, organizationId: 'org1' }), 'business');
});

test('an explicit non-business type OUTRANKS a linked organization', () => {
  // The whole point: a company booking a private family experience, and a
  // company buying two seats on an open tour, are both expressible.
  assert.equal(effectiveActivityType({ activityType: 'private', organizationId: 'org1' }), 'private');
  assert.equal(effectiveActivityType({ activityType: 'group', organizationId: 'org1' }), 'group');
});

test('nothing known → null, never a guessed private', () => {
  // Null-preserving on purpose: template matching and message conditions must
  // be able to tell "unknown" from "private". Committing to a value is the
  // WRITE-side resolver's job (deals/resolveActivityType.js), not this one's.
  assert.equal(effectiveActivityType({}), null);
  assert.equal(effectiveActivityType(null), null);
  assert.equal(effectiveActivityType(undefined), null);
});

test('empty-string activity type is treated as unset', () => {
  assert.equal(effectiveActivityType({ activityType: '', organizationId: 'org1' }), 'business');
  assert.equal(effectiveActivityType({ activityType: '' }), null);
});

test('activity ⇄ tour kind mapping round-trips for every activity type', () => {
  for (const t of ACTIVITY_TYPES) {
    assert.equal(TOUR_KIND_TO_ACTIVITY[ACTIVITY_TO_TOUR_KIND[t]], t, `round-trip failed for ${t}`);
  }
  assert.equal(ACTIVITY_TO_TOUR_KIND.group, 'group_slot');
});

test('the deliberate org/activity mix is detected only when a type was chosen', () => {
  assert.equal(hasDeliberateOrgActivityMix({ organizationId: 'o', activityType: 'private' }), true);
  assert.equal(hasDeliberateOrgActivityMix({ organizationId: 'o', activityType: 'group' }), true);
  // business + org is the ordinary case, not a mix.
  assert.equal(hasDeliberateOrgActivityMix({ organizationId: 'o', activityType: 'business' }), false);
  // Unclassified + org is a DEFAULT, not a deliberate choice — nothing to explain.
  assert.equal(hasDeliberateOrgActivityMix({ organizationId: 'o', activityType: null }), false);
  assert.equal(hasDeliberateOrgActivityMix({ activityType: 'private' }), false);
});
