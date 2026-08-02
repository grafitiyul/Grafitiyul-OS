import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifies } from './repairImportedVatMode.js';

// The repair changes a VAT MODE, never an amount. It may only fire where the
// stored line sum already equals the agreed deal total while the mode claims
// those amounts are net — that equality is the proof the mode is wrong.

test('fires when the stored amount is really the gross', () => {
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 30_000, dealValueMinor: 30_000 }), true);
});

test('does NOT fire on a correct excluded version (net × 1.18 = gross)', () => {
  // The owner was explicit: a precise ×1.18 relationship is not a defect.
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 680_000, dealValueMinor: 802_400 }), false);
});

test('never touches included or exempt versions', () => {
  assert.equal(qualifies({ vatMode: 'included', lineSumMinor: 30_000, dealValueMinor: 30_000 }), false);
  assert.equal(qualifies({ vatMode: 'exempt', lineSumMinor: 30_000, dealValueMinor: 30_000 }), false);
});

test('refuses when the sum does not land on the deal value', () => {
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 25_000, dealValueMinor: 30_000 }), false);
});

test('refuses on an unpriced deal or an empty version', () => {
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 30_000, dealValueMinor: 0 }), false);
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 0, dealValueMinor: 30_000 }), false);
});

test('absorbs only agorot-scale rounding', () => {
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 30_000, dealValueMinor: 30_008 }), true);
  assert.equal(qualifies({ vatMode: 'excluded', lineSumMinor: 30_000, dealValueMinor: 30_500 }), false);
});
