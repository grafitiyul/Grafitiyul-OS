// Authority resolution — the separation of CONFIDENCE from AUTHORITY.
//
// The bugs these tests exist to prevent are all the same shape: something that
// is not a permission (a confident model, a stored row, an API payload)
// quietly acting like one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthority, offersToOperator } from './authority.js';
import { clampMode, capabilityDef, listCapabilities, MODE_RANK } from './capabilities/registry.js';

const modes = (entries) => new Map(entries);
const base = { enabled: true, confidence: 'strong', contextPack: {} };

test('a code ceiling cannot be exceeded by configuration', () => {
  // refund_request ships with maxMode 'shadow'. Even a stored 'auto' resolves
  // no higher — this is the invariant that makes "never automatic" real.
  const res = resolveAuthority({
    ...base,
    capabilityKey: 'refund_request',
    storedModes: modes([['refund_request', { mode: 'auto' }]]),
  });
  assert.equal(res.configuredMode, 'shadow');
  assert.notEqual(res.mode, 'auto');
});

test('clampMode refuses to raise a capability above its ceiling', () => {
  assert.equal(clampMode('refund_request', 'auto'), 'shadow');
  assert.equal(clampMode('discount_request', 'auto'), 'approval');
  assert.equal(clampMode('meeting_point', 'auto'), 'auto');
  assert.equal(clampMode('meeting_point', 'nonsense'), null);
  assert.equal(clampMode('no_such_capability', 'shadow'), null);
});

test('every registered capability ships at or below its own ceiling', () => {
  for (const def of listCapabilities()) {
    assert.ok(
      MODE_RANK[def.defaultMode] <= MODE_RANK[def.maxMode],
      `${def.key} ships above its ceiling`,
    );
  }
});

test('high-risk commercial families can never be automatic', () => {
  for (const key of ['pricing_discussion', 'discount_request', 'refund_request', 'cancellation_request', 'complaint', 'booking_change', 'payment_question']) {
    assert.notEqual(capabilityDef(key).maxMode, 'auto', `${key} must not be automatable`);
  }
});

test('an unknown capability key resolves to disabled, never to a default permission', () => {
  // The classifier's output is an INPUT to permissions. A key we do not know is
  // a situation we did not anticipate.
  const res = resolveAuthority({ ...base, capabilityKey: 'invented_by_the_model', storedModes: modes([]) });
  assert.equal(res.mode, 'disabled');
  assert.equal(res.reason, 'unknown_capability');
});

test('confidence lowers the outcome but never raises it', () => {
  const storedModes = modes([['meeting_point', { mode: 'auto' }]]);
  const weak = resolveAuthority({ ...base, confidence: 'weak', capabilityKey: 'meeting_point', storedModes });
  assert.equal(weak.mode, 'approval', 'weak confidence must not act alone');
  assert.equal(weak.reason, 'low_confidence');

  // And the reverse: strong confidence on a shadow capability stays shadow.
  const shadow = resolveAuthority({
    ...base,
    confidence: 'strong',
    capabilityKey: 'meeting_point',
    storedModes: modes([['meeting_point', { mode: 'shadow' }]]),
  });
  assert.equal(shadow.mode, 'shadow');
});

test('a capability that needs canonical data cannot act without it', () => {
  const storedModes = modes([['pricing_discussion', { mode: 'approval' }]]);
  const missing = resolveAuthority({
    ...base, capabilityKey: 'pricing_discussion', storedModes, contextPack: { pricing: null },
  });
  assert.equal(missing.mode, 'shadow');
  assert.equal(missing.reason, 'missing_canonical_data');

  const present = resolveAuthority({
    ...base,
    capabilityKey: 'pricing_discussion',
    storedModes,
    contextPack: { pricing: { totalText: '₪1,200', totalMinor: 120000 } },
  });
  assert.equal(present.mode, 'approval');
});

test('a payment question with an unknown collection state cannot act', () => {
  const storedModes = modes([['payment_question', { mode: 'approval' }]]);
  const unknown = resolveAuthority({
    ...base, capabilityKey: 'payment_question', storedModes, contextPack: { payment: { state: 'unknown' } },
  });
  assert.equal(unknown.mode, 'shadow');
});

test('operator conditions gate an otherwise permitted capability', () => {
  const storedModes = modes([
    ['pricing_discussion', { mode: 'approval', conditions: { maxAmountMinor: 100000 } }],
  ]);
  const overCap = resolveAuthority({
    ...base,
    capabilityKey: 'pricing_discussion',
    storedModes,
    contextPack: { pricing: { totalText: '₪5,000', totalMinor: 500000 } },
  });
  assert.equal(overCap.reason, 'condition_amount');
  assert.equal(overCap.mode, 'shadow');
});

test('only approval and auto ever surface to an operator', () => {
  assert.equal(offersToOperator('disabled'), false);
  assert.equal(offersToOperator('shadow'), false);
  assert.equal(offersToOperator('approval'), true);
  assert.equal(offersToOperator('auto'), true);
});
