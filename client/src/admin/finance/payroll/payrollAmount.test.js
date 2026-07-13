import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAmountEdit, lineFinalMinor, isOverridden } from './payrollAmount.js';

// The unified empty/zero/return-to-calculated rules shared by the single-entry
// modal and the activity matrix. Values are minor units (agorot); the editable
// field is in major units (₪), so "60" → 6000, "0" → 0, "" → clear.

test('empty input clears the override (returns to calculated)', () => {
  assert.deepEqual(resolveAmountEdit('', { calculatedMinor: 6000, overrideMinor: 7500 }), { overrideMinor: null });
});

test('empty input with no existing override is a no-op', () => {
  assert.deepEqual(resolveAmountEdit('', { calculatedMinor: 6000, overrideMinor: null }), { noop: true });
});

test('"0" is an explicit zero override, distinct from clearing', () => {
  assert.deepEqual(resolveAmountEdit('0', { calculatedMinor: 6000, overrideMinor: null }), { overrideMinor: 0 });
});

test('typing a new value writes that override', () => {
  assert.deepEqual(resolveAmountEdit('75', { calculatedMinor: 6000, overrideMinor: null }), { overrideMinor: 7500 });
});

test('typing the calculated value clears the override (never stores a redundant one)', () => {
  assert.deepEqual(resolveAmountEdit('60', { calculatedMinor: 6000, overrideMinor: 7500 }), { overrideMinor: null });
  assert.deepEqual(resolveAmountEdit('60', { calculatedMinor: 6000, overrideMinor: null }), { noop: true });
});

test('re-entering the same override value is a no-op', () => {
  assert.deepEqual(resolveAmountEdit('75', { calculatedMinor: 6000, overrideMinor: 7500 }), { noop: true });
});

test('invalid input is ignored', () => {
  assert.deepEqual(resolveAmountEdit('abc', { calculatedMinor: 6000, overrideMinor: null }), { noop: true });
});

test('lineFinalMinor: override wins, else calculated, else 0', () => {
  assert.equal(lineFinalMinor({ overrideMinor: 7500, calculatedMinor: 6000 }), 7500);
  assert.equal(lineFinalMinor({ overrideMinor: null, calculatedMinor: 6000 }), 6000);
  assert.equal(lineFinalMinor({ overrideMinor: null, calculatedMinor: null }), 0);
  assert.equal(lineFinalMinor({ overrideMinor: 0, calculatedMinor: 6000 }), 0, 'explicit zero override wins over calculated');
});

test('isOverridden only when the override differs from the calculation', () => {
  assert.equal(isOverridden({ overrideMinor: 7500, calculatedMinor: 6000 }), true);
  assert.equal(isOverridden({ overrideMinor: 0, calculatedMinor: 6000 }), true);
  assert.equal(isOverridden({ overrideMinor: null, calculatedMinor: 6000 }), false);
  assert.equal(isOverridden({ overrideMinor: 6000, calculatedMinor: 6000 }), false);
});
