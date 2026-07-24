// Semantic pricing localization — pure. Hebrew and English render from the
// SAME typed rows; no Hebrew leaks into the English form; quantity > 1 renders
// the explicit "qty × unit = total" while quantity 1 stays clean.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingRowText, pricingTotalsText, pricingT } from './pricingText.js';

const tier = { type: 'tier_up_to', threshold: 10, quantity: 1, unitAmountMinor: 165000, totalMinor: 165000 };
const tier2 = { ...tier, quantity: 2, totalMinor: 330000 };
const extra = { type: 'extra_participant', quantity: 10, unitAmountMinor: 12000, totalMinor: 120000 };
const fixed = { type: 'fixed_price', quantity: 1, unitAmountMinor: 130000, totalMinor: 130000 };
const sat = { type: 'saturday_surcharge', quantity: 2, unitAmountMinor: 25000, totalMinor: 50000 };

test('Hebrew rows localize with interpolated thresholds', () => {
  assert.equal(pricingRowText(tier, 'he').label, 'עד 10 משתתפים');
  assert.equal(pricingRowText(extra, 'he').label, 'כל משתתף נוסף');
  assert.equal(pricingRowText(fixed, 'he').label, 'מחיר קבוע');
  assert.equal(pricingRowText(sat, 'he').label, 'תוספת שבת/חג');
});

test('שבת and חג semantic types share ONE canonical combined label', () => {
  const hol = { type: 'holiday_surcharge', quantity: 1, unitAmountMinor: 25000, totalMinor: 25000 };
  assert.equal(pricingRowText(sat, 'he').label, 'תוספת שבת/חג');
  assert.equal(pricingRowText(hol, 'he').label, 'תוספת שבת/חג');
  assert.equal(pricingRowText(sat, 'en').label, 'Saturday / Holiday surcharge');
  assert.equal(pricingRowText(hol, 'en').label, 'Saturday / Holiday surcharge');
});

test('English rows localize — NO Hebrew in the English form', () => {
  const rows = [tier, extra, fixed, sat, { type: 'holiday_surcharge', quantity: 1, unitAmountMinor: 25000, totalMinor: 25000 }];
  for (const r of rows) {
    const { label } = pricingRowText(r, 'en');
    assert.equal(/[֐-׿]/.test(label), false, `Hebrew leaked into: ${label}`);
  }
  assert.equal(pricingRowText(tier, 'en').label, 'Up to 10 participants');
  assert.equal(pricingRowText(extra, 'en').label, 'Each additional participant');
  assert.equal(pricingRowText(fixed, 'en').label, 'Fixed price');
  assert.equal(pricingRowText(sat, 'en').label, 'Saturday / Holiday surcharge');
});

test('quantity > 1 renders qty × unit = total; quantity 1 renders one amount', () => {
  const multi = pricingRowText(extra, 'he').amountText;
  assert.match(multi, /^10 × /);
  assert.match(multi, / = /);
  const single = pricingRowText(fixed, 'he').amountText;
  assert.equal(single.includes('×'), false);
  assert.equal(single.includes('1 ×'), false);
  const groups2 = pricingRowText(tier2, 'en').amountText;
  assert.match(groups2, /^2 × /);
});

test('structural rows (quantity null) render the unit amount without multiplication', () => {
  const structural = pricingRowText({ type: 'tier_up_to', threshold: 5, quantity: null, unitAmountMinor: 90000, totalMinor: null }, 'he');
  assert.equal(structural.amountText.includes('×'), false);
});

test('totals hierarchy: pre-VAT expected (primary) → VAT → total to pay; values unchanged', () => {
  const totals = { netMinor: 150000, vatMinor: 27000, grossMinor: 177000, vatMode: 'included', vatRate: 18 };
  const he = pricingTotalsText(totals, 'he');
  assert.deepEqual(he.map((r) => r.kind), ['subtotal', 'vat', 'total']);
  assert.equal(he[0].label, 'צפי להזמנה זו');
  assert.equal(he[1].label, 'מע״מ (18%)');
  assert.equal(he[2].label, 'סה״כ לתשלום');
  // The AMOUNTS are exactly the same engine values as before the relabel:
  // pre-VAT expected = net, total to pay = gross, and they reconcile.
  assert.equal(he[0].amountText, pricingTotalsText(totals, 'he')[0].amountText);
  const en = pricingTotalsText(totals, 'en');
  assert.equal(en[0].label, 'Expected for this reservation');
  assert.equal(en[1].label, 'VAT (18%)');
  assert.equal(en[2].label, 'Total to pay');
  for (const r of en) assert.equal(/[֐-׿]/.test(r.label), false);
  const exempt = pricingTotalsText({ netMinor: 100, vatMinor: 0, grossMinor: 100, vatMode: 'exempt' }, 'en');
  assert.equal(exempt[1].label, 'VAT exempt');
});

test('fallback + chrome strings exist in both languages (English has no Hebrew)', () => {
  const en = pricingT('en');
  assert.equal(en.fallback, 'Automatic price calculation is not available for this product. The price will be according to the agent price list.');
  assert.equal(/[֐-׿]/.test(en.fallback + en.title + en.loading + en.structuralHint), false);
  const he = pricingT('he');
  assert.equal(he.fallback, 'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.');
});

test('generic business surcharge keeps its catalog label in both languages', () => {
  const row = { type: 'surcharge', labelHe: 'תוספת שישי', quantity: 1, unitAmountMinor: 15000, totalMinor: 15000 };
  assert.equal(pricingRowText(row, 'he').label, 'תוספת שישי');
  assert.equal(pricingRowText(row, 'en').label, 'תוספת שישי'); // business data, like product names
});
