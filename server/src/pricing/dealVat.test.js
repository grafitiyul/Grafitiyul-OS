import test from 'node:test';
import assert from 'node:assert/strict';
import { dealVatExempt } from './dealVat.js';

// Fixture: PRODUCTION deal #26617 (the bug report) — working version
// vatMode='exempt', ONE product line ₪1,000.00 with vatMode='inherit'.
// The old tourist-path check (line.vatMode === 'exempt' only) called this
// deal VAT-liable; the payment-link path ignored VAT entirely.
const deal26617 = (versionVatMode = 'exempt', lineVatMode = 'inherit') => ({
  valueMinor: 100000n,
  quoteVersions: [
    {
      id: 'cmsdf63ju000tagpqt2hfanc6',
      vatMode: versionVatMode,
      lines: [{ vatMode: lineVatMode, unitPriceMinor: 100000n, quantity: 1, kind: 'product' }],
    },
  ],
});

// 1) THE production bug: order-level exempt + inherit lines IS exempt.
test('dealVatExempt: QuoteVersion exempt + inherit lines → exempt (deal #26617)', () => {
  assert.equal(dealVatExempt(deal26617('exempt', 'inherit')), true);
});

// 2) excluded order + inherit lines → VAT applies.
test('dealVatExempt: QuoteVersion excluded + inherit lines → not exempt', () => {
  assert.equal(dealVatExempt(deal26617('excluded', 'inherit')), false);
});

// 3) included order + inherit lines → VAT applies.
test('dealVatExempt: QuoteVersion included + inherit lines → not exempt', () => {
  assert.equal(dealVatExempt(deal26617('included', 'inherit')), false);
});

// 4) explicit line-level exempt override (order never chose a mode).
test('dealVatExempt: explicit line-level exempt with null order mode → exempt', () => {
  assert.equal(dealVatExempt(deal26617(null, 'exempt')), true);
});

test('dealVatExempt: explicit line override BEATS the order mode', () => {
  // exempt order, one line explicitly included → the deal still owes VAT.
  assert.equal(dealVatExempt(deal26617('exempt', 'included')), false);
});

test('dealVatExempt: mixed lines → not exempt (one payment cannot split VAT)', () => {
  const d = deal26617('included', 'exempt');
  d.quoteVersions[0].lines.push({ vatMode: 'inherit' });
  assert.equal(dealVatExempt(d), false);
});

test('dealVatExempt: line-less Builder follows the order mode; no version → not exempt', () => {
  assert.equal(dealVatExempt({ quoteVersions: [{ vatMode: 'exempt', lines: [] }] }), true);
  assert.equal(dealVatExempt({ quoteVersions: [{ vatMode: null, lines: [] }] }), false);
  assert.equal(dealVatExempt({ quoteVersions: [] }), false);
  assert.equal(dealVatExempt({}), false);
});
