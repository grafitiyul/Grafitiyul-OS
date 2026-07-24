import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderClientLinesFromPricing, RESERVATION_LINE_SOURCE } from './reservationBuilder.js';

// Frozen pricing fixtures shaped exactly like payloadSnapshot.pricingByGroup[i]
// (verified against production session #1000/#1001).

// English / Hebrew group: base rows only, no surcharge (VAT excluded).
const exactNoSurcharge = {
  available: true,
  mode: 'exact',
  priceModel: 'tiered_group',
  rows: [
    { type: 'tier_up_to', scope: 'per_group', quantity: 2, threshold: 10, unitAmountMinor: 165000, totalMinor: 330000 },
    { type: 'extra_participant', scope: 'per_participant', quantity: 10, unitAmountMinor: 12000, totalMinor: 120000 },
  ],
  totals: { netMinor: 450000, vatMinor: 81000, grossMinor: 531000, vatMode: 'excluded', vatRate: 18 },
};

// Non-standard language: a surcharge row on top of the base (₪200 net).
const exactWithLanguageSurcharge = {
  available: true,
  mode: 'exact',
  priceModel: 'fixed',
  rows: [
    { type: 'fixed_price', scope: 'per_group', quantity: 1, unitAmountMinor: 130000, totalMinor: 130000 },
    { type: 'surcharge', scope: 'per_group', quantity: 1, unitAmountMinor: 20000, totalMinor: 20000, labelHe: 'תוספת שפה' },
  ],
  totals: { netMinor: 150000, vatMinor: 27000, grossMinor: 177000, vatMode: 'excluded', vatRate: 18 },
};

test('A/B English/Hebrew group → structured product lines, gross cached, no addon line', () => {
  const { lines, valueMinor, priced } = builderClientLinesFromPricing(exactNoSurcharge, {
    productVariantId: 'variant_1',
    productLabel: 'סיור טעימות',
  });
  assert.equal(priced, true);
  assert.equal(valueMinor, 531000); // = totals.grossMinor
  assert.equal(lines.length, 2);
  // First base row: product line, carries the variant ref + the display name.
  assert.equal(lines[0].kind, 'product');
  assert.equal(lines[0].refId, 'variant_1');
  assert.equal(lines[0].label, 'סיור טעימות');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].unitPriceMinor, 165000);
  assert.equal(lines[0].overridden, true); // frozen — engine must never reprice
  assert.equal(lines[0].sourceKind, RESERVATION_LINE_SOURCE);
  // Extra-participant row is still a structured product line (not free text).
  assert.equal(lines[1].kind, 'product');
  assert.equal(lines[1].label, 'משתתף נוסף');
  assert.equal(lines[1].quantity, 10);
  // No surcharge/addon line for a regular language.
  assert.ok(lines.every((l) => l.kind !== 'addon'));
});

test('C non-standard language → surcharge becomes a structured addon line; totals reconcile', () => {
  const { lines, valueMinor } = builderClientLinesFromPricing(exactWithLanguageSurcharge, {
    productVariantId: 'variant_2',
    productLabel: 'סדנה',
  });
  assert.equal(valueMinor, 177000);
  assert.equal(lines.length, 2);
  const addon = lines.find((l) => l.kind === 'addon');
  assert.ok(addon, 'expected a surcharge addon line');
  assert.equal(addon.label, 'תוספת שפה'); // labelHe carried through, not "טקסט חופשי"
  assert.equal(addon.unitPriceMinor, 20000);
  assert.equal(addon.refId, null); // frozen row has no addon id; label carries meaning
  assert.equal(addon.overridden, true);

  // VAT reconciliation: sum(line net) + VAT = cached gross (VAT excluded ⇒ nets).
  const net = lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
  assert.equal(net, 150000); // = totals.netMinor
  assert.equal(Math.round(net * 1.18), 177000); // = grossMinor
});

test('F every line carries the group VAT basis so the Builder recomputes the frozen gross', () => {
  const { lines } = builderClientLinesFromPricing(exactWithLanguageSurcharge, { productVariantId: 'v' });
  for (const l of lines) {
    assert.equal(l.vatMode, 'excluded');
    assert.equal(l.vatRate, 18);
  }
});

test('structural / price-list-fallback pricing writes NO lines (honest empty, not a zero)', () => {
  for (const p of [
    null,
    { available: false, reason: 'no_agents_card', fallbackKey: 'agent_price_list' },
    { available: true, mode: 'structural', rows: [{ type: 'fixed_price' }], totals: null },
  ]) {
    const r = builderClientLinesFromPricing(p, { productVariantId: 'v' });
    assert.equal(r.priced, false);
    assert.equal(r.lines.length, 0);
    assert.equal(r.valueMinor, null);
  }
});

test('D multi-group isolation: the mapper reads ONLY the pricing it is given', () => {
  // Two different group snapshots → two different Deals; no shared state.
  const g1 = builderClientLinesFromPricing(exactNoSurcharge, { productVariantId: 'v1' });
  const g2 = builderClientLinesFromPricing(exactWithLanguageSurcharge, { productVariantId: 'v2' });
  assert.equal(g1.valueMinor, 531000);
  assert.equal(g2.valueMinor, 177000);
  assert.notEqual(g1.lines.length, 0);
  assert.ok(g1.lines.every((l) => l.refId === 'v1' || l.kind === 'addon'));
  assert.ok(g2.lines.every((l) => l.refId === 'v2' || l.kind === 'addon'));
});
