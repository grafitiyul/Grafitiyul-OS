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
  isActivityTourCompatible,
  activityTourCompatibility,
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

// ── Deal ⇄ Tour compatibility: the ONE resolver the בקרה detector asks ───────

test('every compatible pair is compatible', () => {
  assert.equal(isActivityTourCompatible('group', 'group_slot'), true);
  assert.equal(isActivityTourCompatible('private', 'private'), true);
  assert.equal(isActivityTourCompatible('business', 'business'), true);
});

test('every incompatible pair is caught, in both directions', () => {
  for (const [a, k] of [
    ['group', 'private'], ['group', 'business'],
    ['private', 'group_slot'], ['business', 'group_slot'],
    ['private', 'business'], ['business', 'private'],
  ]) {
    assert.equal(isActivityTourCompatible(a, k), false, `${a} on ${k} should be incompatible`);
  }
});

test('unknown sides are never asserted about — no false cards', () => {
  // A deal with no classification is the assumption card's business, and an
  // unmapped future activity type must not produce a critical alert.
  assert.equal(isActivityTourCompatible(null, 'private'), true);
  assert.equal(isActivityTourCompatible('private', null), true);
  assert.equal(isActivityTourCompatible('workshop_series', 'private'), true);
});

test('a compatible pair carries no correction targets', () => {
  const v = activityTourCompatibility('group', 'group_slot');
  assert.deepEqual(v, {
    compatible: true, severity: null, structural: false, dealTarget: null, tourTarget: null,
  });
});

test('a group mismatch is CRITICAL and STRUCTURAL — real seats must move', () => {
  const v = activityTourCompatibility('private', 'group_slot');
  assert.equal(v.compatible, false);
  assert.equal(v.severity, 'critical');
  assert.equal(v.structural, true);
  // "the tour is right, fix the deal" → the deal becomes group.
  assert.equal(v.dealTarget, 'group');
  // "the deal is right, fix the tour" → convert the deal's operational side to private.
  assert.equal(v.tourTarget, 'private');
});

test('private ↔ business is a WARNING and NOT structural — a relabel', () => {
  const v = activityTourCompatibility('business', 'private');
  assert.equal(v.severity, 'warning');
  assert.equal(v.structural, false, 'nothing operational differs, so nothing has to move');
  assert.equal(v.dealTarget, 'private');
  assert.equal(v.tourTarget, 'business');
});

test('the two correction targets are always DIFFERENT and always actionable', () => {
  // The card offers both directions; if they ever collapsed to the same value
  // one of the two buttons would be a no-op that refuses with same_activity_type.
  for (const [a, k] of [
    ['group', 'private'], ['private', 'group_slot'], ['business', 'group_slot'],
    ['group', 'business'], ['private', 'business'], ['business', 'private'],
  ]) {
    const v = activityTourCompatibility(a, k);
    assert.ok(v.dealTarget, `${a}/${k} has a deal-side target`);
    assert.ok(v.tourTarget, `${a}/${k} has a tour-side target`);
    assert.notEqual(v.dealTarget, v.tourTarget, `${a}/${k} targets must differ`);
    assert.equal(v.tourTarget, a, 'the tour-side fix aims at what the DEAL says');
    assert.equal(v.dealTarget, TOUR_KIND_TO_ACTIVITY[k], 'the deal-side fix aims at what the TOUR is');
  }
});
