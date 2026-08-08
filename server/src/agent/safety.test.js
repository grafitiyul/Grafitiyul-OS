// The safety panel must never be able to lie.
//
// It is the one place an operator looks to answer "can this thing message my
// customers right now". If it can print a reassuring line that configuration
// contradicts, it is worse than showing nothing at all. These tests fix that
// property in place: every claim is derived, and flipping the configuration
// flips the claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { safetySummary } from './safety.js';
import { listCapabilities } from './capabilities/registry.js';

const matrixWith = (overrides = {}) =>
  listCapabilities().map((c) => ({
    key: c.key, labelHe: c.labelHe, maxMode: c.maxMode,
    mode: overrides[c.key] || 'shadow',
  }));

const factOf = (s, key) => s.facts.find((f) => f.key === key);

test('with the agent off, nothing claims to be happening', () => {
  const s = safetySummary({ enabled: false }, matrixWith());
  assert.equal(s.headline.tone, 'off');
  assert.equal(factOf(s, 'analyses').yes, false);
  assert.equal(s.canAutoSend, false);
});

test('shadow everywhere: it analyses, but offers nothing and sends nothing', () => {
  const s = safetySummary({ enabled: true }, matrixWith());
  assert.equal(s.headline.tone, 'shadow');
  assert.equal(factOf(s, 'analyses').yes, true);
  assert.equal(factOf(s, 'shows_for_approval').yes, false);
  assert.equal(factOf(s, 'auto_send').yes, false);
  assert.equal(s.canAutoSend, false);
});

test('one capability at approval changes the headline and the claim', () => {
  const s = safetySummary({ enabled: true }, matrixWith({ meeting_point: 'approval' }));
  assert.equal(s.headline.tone, 'approval');
  assert.equal(factOf(s, 'shows_for_approval').yes, true);
  assert.match(factOf(s, 'shows_for_approval').detailHe, /נקודת מפגש/);
  // Still cannot send by itself.
  assert.equal(s.canAutoSend, false);
});

test('the auto-send claim tracks the V1 code switch, not the configuration alone', () => {
  // A capability set to auto is NOT sufficient: autoSendPermitted() is false in
  // V1, and the panel must say what is TRUE, not what is configured.
  const s = safetySummary({ enabled: true }, matrixWith({ meeting_point: 'auto' }));
  assert.equal(s.canAutoSend, false);
  assert.equal(factOf(s, 'auto_send').yes, false);
  assert.match(factOf(s, 'auto_send').detailHe, /חסומה בקוד/);
});

test('mode counts are derived, never hardcoded', () => {
  const s = safetySummary({ enabled: true }, matrixWith({
    meeting_point: 'approval', duration_question: 'approval', refund_request: 'disabled',
  }));
  assert.equal(s.counts.approval, 2);
  assert.equal(s.counts.disabled, 1);
  assert.equal(s.counts.total, listCapabilities().length);
  assert.equal(
    s.counts.disabled + s.counts.shadow + s.counts.approval + s.counts.auto,
    s.counts.total,
    'every capability must be counted exactly once',
  );
});

test('the negative facts are rendered as negatives, so a "yes" reads as a warning', () => {
  const s = safetySummary({ enabled: true }, matrixWith());
  for (const key of ['auto_send', 'auto_action', 'refunds', 'prices']) {
    assert.equal(factOf(s, key).negative, true, `${key} must be marked negative`);
  }
});

test('"shows for approval" is neutral — shadow-only is correct, not a fault', () => {
  // Painting the correct starting state red would train the operator to ignore
  // the red marks that actually matter.
  const s = safetySummary({ enabled: true }, matrixWith());
  const fact = factOf(s, 'shows_for_approval');
  assert.equal(fact.yes, false);
  assert.equal(fact.neutral, true);
  assert.notEqual(fact.negative, true, 'it is not a danger either');
});

test('no write tool can execute without approval in the current configuration', () => {
  const s = safetySummary({ enabled: true }, matrixWith({ meeting_point: 'auto' }));
  assert.equal(s.canExecuteWithoutApproval, false);
});
