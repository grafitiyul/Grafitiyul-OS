import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinor, formatQuantityRow } from './money.js';

test('formatMinor: whole shekels, grouping, cents, negatives', () => {
  assert.equal(formatMinor(165000), '₪1,650');
  assert.equal(formatMinor(0), '₪0');
  assert.equal(formatMinor(125050), '₪1,250.50');
  assert.equal(formatMinor(123456789), '₪1,234,567.89');
  assert.equal(formatMinor(-5000), '-₪50');
  assert.equal(formatMinor(null), '₪0');
});

test('formatMinor contains no invisible bidi control marks', () => {
  for (const v of [165000, 125050, -5000]) {
    assert.ok(!/[‎‏؜⁦-⁩]/.test(formatMinor(v)));
  }
});

test('formatQuantityRow locks the semantic order qty × unit = total', () => {
  assert.equal(formatQuantityRow(2, 165000, 330000), '2 × ₪1,650 = ₪3,300');
  assert.equal(formatQuantityRow(10, 12000, 120000), '10 × ₪120 = ₪1,200');
  assert.equal(formatQuantityRow(2, 25000, 50000), '2 × ₪250 = ₪500');
});
