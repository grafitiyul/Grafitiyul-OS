// Onboarding progress is DERIVED. There is no completion flag anywhere, and
// these tests are what keep it that way: every step must react to real state,
// including backwards when the operator removes something.

import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingState } from './onboarding.js';
import { listCapabilities } from './capabilities/registry.js';
import { normalizeStyleRules } from './style.js';

const matrix = (overrides = {}) =>
  listCapabilities().map((c) => ({ key: c.key, mode: overrides[c.key] || 'shadow' }));

const emptyStyle = { status: 'approved', rules: normalizeStyleRules({}) };
const filledStyle = { status: 'approved', rules: normalizeStyleRules({ greeting: 'בשם פרטי' }) };
const approvedKnowledge = (n) => Array.from({ length: n }, () => ({ status: 'approved' }));

const stepOf = (s, key) => s.steps.find((x) => x.key === key);

const base = {
  settings: { enabled: false }, matrix: matrix(), knowledge: [], playbook: [], styles: [],
};

test('a fresh install has nothing done and points at enabling first', () => {
  const s = onboardingState(base);
  assert.equal(s.doneCount, 0);
  assert.equal(s.next.key, 'enable');
  assert.equal(s.configured, false);
});

test('an APPROVED BUT EMPTY style profile does not count as configured style', () => {
  // This is the exact production state that shipped: four approved-looking
  // profiles with no content. Counting them would have told the operator they
  // were done when the agent still had no voice.
  const s = onboardingState({ ...base, settings: { enabled: true }, styles: [emptyStyle] });
  assert.equal(stepOf(s, 'style').done, false);
});

test('a filled and approved style profile counts', () => {
  const s = onboardingState({ ...base, settings: { enabled: true }, styles: [filledStyle] });
  assert.equal(stepOf(s, 'style').done, true);
});

test('knowledge needs enough items to be useful, not just one', () => {
  const one = onboardingState({ ...base, settings: { enabled: true }, knowledge: approvedKnowledge(1) });
  assert.equal(stepOf(one, 'knowledge').done, false);
  assert.match(stepOf(one, 'knowledge').statusHe, /מומלץ/);

  const three = onboardingState({ ...base, settings: { enabled: true }, knowledge: approvedKnowledge(3) });
  assert.equal(stepOf(three, 'knowledge').done, true);
});

test('draft knowledge never counts — only approved rows change behaviour', () => {
  const s = onboardingState({
    ...base, settings: { enabled: true },
    knowledge: [{ status: 'draft' }, { status: 'draft' }, { status: 'draft' }],
  });
  assert.equal(stepOf(s, 'knowledge').done, false);
});

test('progress moves BACKWARDS when configuration is removed', () => {
  const configured = {
    ...base, settings: { enabled: true }, styles: [filledStyle], knowledge: approvedKnowledge(3),
  };
  const before = onboardingState(configured);
  const after = onboardingState({ ...configured, knowledge: [] });
  assert.ok(after.doneCount < before.doneCount, 'removing knowledge must reopen its step');
  assert.equal(after.configured, false);
});

test('`configured` is what hides the onboarding card, and needs all three basics', () => {
  assert.equal(onboardingState({ ...base, settings: { enabled: true } }).configured, false);
  assert.equal(onboardingState({
    ...base, settings: { enabled: true }, styles: [filledStyle],
  }).configured, false, 'style alone is not enough');
  assert.equal(onboardingState({
    ...base, settings: { enabled: true }, styles: [filledStyle], knowledge: approvedKnowledge(1),
  }).configured, true);
});

test('the authority step reflects a real promotion, not an intention', () => {
  const shadowOnly = onboardingState({ ...base, settings: { enabled: true } });
  assert.equal(stepOf(shadowOnly, 'authority').done, false);

  const promoted = onboardingState({
    ...base, settings: { enabled: true }, matrix: matrix({ meeting_point: 'approval' }),
  });
  assert.equal(stepOf(promoted, 'authority').done, true);
});

test('every step carries a destination and a reason, so none is a dead end', () => {
  const s = onboardingState(base);
  for (const step of s.steps) {
    assert.ok(step.titleHe, `${step.key} has a title`);
    assert.ok(step.whyHe, `${step.key} explains why it matters`);
    assert.ok(step.statusHe, `${step.key} states where you are`);
    assert.ok(step.to?.startsWith('/admin/ai-agent'), `${step.key} links somewhere real`);
  }
});
