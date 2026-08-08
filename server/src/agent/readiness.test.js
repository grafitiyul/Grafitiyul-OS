// Readiness must EXPLAIN itself, and must never overstate the evidence.
//
// The failure mode being prevented: a screen that says "98%" over four cases,
// or says "not ready" without saying what is missing. Both destroy the
// operator's ability to make the promotion decision themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessFor, READINESS_RULE } from './readiness.js';
import { capabilityDef } from './capabilities/registry.js';

const counts = (o = {}) => ({
  observed: 0, shadow: 0, open: 0, unchanged: 0, edited: 0, rejected: 0, bypassed: 0, ...o,
});
const meetingPoint = capabilityDef('meeting_point');   // maxMode auto
const refund = capabilityDef('refund_request');        // maxMode shadow

test('no evidence at all says so, and says what would produce evidence', () => {
  const r = readinessFor(meetingPoint, counts(), 'shadow');
  assert.equal(r.state, 'no_evidence');
  assert.equal(r.ready, false);
  assert.ok(r.reasonHe.length > 10);
});

test('shadow records without decisions explain that a DECISION is what is missing', () => {
  const r = readinessFor(meetingPoint, counts({ shadow: 12 }), 'shadow');
  assert.equal(r.state, 'no_evidence');
  assert.match(r.reasonHe, /12/);
  assert.match(r.reasonHe, /תאשר או תדחה/);
});

test('a disabled capability explains that nothing is being collected', () => {
  const r = readinessFor(meetingPoint, counts(), 'disabled');
  assert.equal(r.state, 'not_observing');
  assert.match(r.reasonHe, /צל/);
});

test('partial evidence reports the real numerator and denominator', () => {
  const r = readinessFor(meetingPoint, counts({ unchanged: 8, edited: 2, rejected: 1 }), 'shadow');
  assert.equal(r.state, 'gathering');
  assert.equal(r.handled, 11);
  assert.match(r.reasonHe, /11/);
  assert.match(r.reasonHe, new RegExp(String(READINESS_RULE.minSamples)));
  assert.equal(r.ready, false);
});

test('enough samples but poor quality says WHICH bar failed', () => {
  const r = readinessFor(meetingPoint, counts({ unchanged: 15, edited: 15, rejected: 5 }), 'shadow');
  assert.equal(r.state, 'not_good_enough');
  assert.equal(r.ready, false);
  assert.match(r.reasonHe, /15/);
});

test('a genuinely good record reads as ready — and only as advice', () => {
  const r = readinessFor(meetingPoint, counts({ unchanged: 38, edited: 2 }), 'shadow');
  assert.equal(r.state, 'ready');
  assert.equal(r.ready, true);
  assert.equal(r.nextMode, 'approval', 'the suggestion is the NEXT step, not the top');
  assert.match(r.reasonHe, /ההחלטה שלך/);
});

test('the suggested next mode never exceeds the code ceiling', () => {
  // refund_request caps at shadow, so from shadow there is nowhere to go.
  const r = readinessFor(refund, counts({ unchanged: 100 }), 'shadow');
  assert.equal(r.nextMode, null);
  assert.equal(r.state, 'at_ceiling');
  assert.equal(r.ready, false, 'a capped capability is never advertised as promotable');
});

test('at the ceiling, the reason repeats WHY the ceiling exists', () => {
  const r = readinessFor(refund, counts(), 'shadow');
  assert.match(r.reasonHe, /החזר|בלתי הפיכה|רישום/);
});

test('rates always travel with their denominator', () => {
  const none = readinessFor(meetingPoint, counts(), 'shadow');
  assert.equal(none.unchangedRate, null, 'no denominator ⇒ no rate, never 0%');
  assert.equal(none.denominator, 0);

  const some = readinessFor(meetingPoint, counts({ unchanged: 3, edited: 1 }), 'shadow');
  assert.equal(some.denominator, 4);
  assert.equal(some.unchangedRate, 0.75);
});

test('one intermediate step at a time — approval is proposed before auto', () => {
  const r = readinessFor(meetingPoint, counts({ unchanged: 40 }), 'approval');
  assert.equal(r.nextMode, 'auto');
});
