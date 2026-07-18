import test from 'node:test';
import assert from 'node:assert/strict';
import { mapProductLine, reconcileDeal, planBuilderImport } from './builderImport.js';

test('mapProductLine: frozen manual line, VAT mode from tax_method, comment→text note', () => {
  const [main, ...rest] = mapProductLine({ name: 'סיור וסדנת גרפיטי', quantity: 2, item_price: 1700, sum: 3400, tax_method: 'inclusive', tax: 0, comments: '<div>מחיר לקבוצה</div>' }, 4);
  assert.equal(main.kind, 'manual');
  assert.equal(main.overridden, true, 'manual+overridden → engine never reprices');
  assert.equal(main.sourceKind, 'pipedrive_import');
  assert.equal(main.label, 'סיור וסדנת גרפיטי');
  assert.equal(main.quantity, 2);
  assert.equal(main.unitPriceMinor, 170000n);
  assert.equal(main.vatMode, 'included');
  assert.equal(main.note, 'מחיר לקבוצה');
  assert.equal(main.sortOrder, 4);
  assert.equal(rest.length, 0, 'no discount line when discount is absent');
});

test('mapProductLine: VAT modes + placeholder (blank name) preserved', () => {
  assert.equal(mapProductLine({ tax_method: 'exclusive', item_price: 100, quantity: 1, sum: 100 }, 0)[0].vatMode, 'excluded');
  assert.equal(mapProductLine({ tax_method: 'none', item_price: 100, quantity: 1, sum: 100 }, 0)[0].vatMode, 'exempt');
  const ph = mapProductLine({ name: '', item_price: 0, quantity: 1, sum: 0, tax_method: 'inclusive' }, 2)[0];
  assert.equal(ph.label, '', 'placeholder row kept with empty label');
  assert.equal(ph.unitPriceMinor, 0n);
});

test('mapProductLine: real discount → synthesised discount line so derived total == source sum', () => {
  const lines = mapProductLine({ name: 'סיור', quantity: 1, item_price: 2000, sum: 1800, discount: 10, discount_type: 'percentage', tax_method: 'inclusive' }, 6);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].unitPriceMinor, 200000n);
  assert.equal(lines[1].kind, 'discount');
  assert.equal(lines[1].unitPriceMinor, 20000n, 'gross 2000 − sum 1800 = 200 → 20000 minor');
  assert.match(lines[1].note, /10%/);
  assert.equal(lines[1].sortOrder, 7);
});

test('reconcileDeal: A match / B zero-value / C differ (all minor/agorot)', () => {
  assert.equal(reconcileDeal(340000n, 340000), 'A');
  assert.equal(reconcileDeal(340050n, 340000), 'A', 'within ₪1 still matches');
  assert.equal(reconcileDeal(340000n, 0), 'B');
  assert.equal(reconcileDeal(340000n, null), 'B');
  assert.equal(reconcileDeal(397000n, 160000), 'C');
});

test('planBuilderImport: classifies, skips missing-deal + already-imported, deterministic order', () => {
  const dealBy = new Map([
    ['329', { id: 'd329', valueMinor: 340000 }],
    ['2062', { id: 'd2062', valueMinor: 160000 }],
    ['999', { id: 'd999', valueMinor: 0 }],
  ]);
  const docs = [
    { dealId: 2062, products: [{ name: 'א', quantity: 1, item_price: 1900, sum: 1900, tax_method: 'inclusive', order_nr: 1 }, { name: '', quantity: 1, item_price: 1600, sum: 1600, tax_method: 'inclusive', order_nr: 2 }, { name: 'ב', quantity: 1, item_price: 470, sum: 470, tax_method: 'inclusive', order_nr: 3 }] },
    { dealId: 329, products: [{ name: 'סיור', quantity: 1, item_price: 3400, sum: 3400, tax_method: 'inclusive', order_nr: 0 }] },
    { dealId: 999, products: [{ name: 'חינם', quantity: 1, item_price: 0, sum: 0, tax_method: 'inclusive' }] },
    { dealId: 555, products: [{ name: 'x', quantity: 1, item_price: 1, sum: 1 }] }, // no GOS deal
    { dealId: 329, products: [] }, // empty products
  ];
  const r = planBuilderImport(docs, dealBy, new Set());
  assert.equal(r.stats.plan, 3);
  assert.equal(r.stats.noDeal, 1);
  assert.equal(r.stats.emptyProducts, 1);
  assert.equal(r.stats.classA, 1, 'deal 329 lines == value');
  assert.equal(r.stats.classC, 1, 'deal 2062 lines(3970) ≠ value(1600)');
  assert.equal(r.stats.classB, 1, 'deal 999 zero value');
  assert.equal(r.stats.placeholderLines, 1);
  assert.equal(r.payloads[0].legacyDealId, '329', 'sorted by deal id ascending');
  assert.equal(r.payloads[0].reconciliation.class, 'A');
});

test('planBuilderImport: idempotency — already-crosswalked deals are skipped', () => {
  const dealBy = new Map([['329', { id: 'd329', valueMinor: 340000 }]]);
  const docs = [{ dealId: 329, products: [{ name: 'סיור', quantity: 1, item_price: 3400, sum: 3400, tax_method: 'inclusive' }] }];
  const r = planBuilderImport(docs, dealBy, new Set(['329']));
  assert.equal(r.stats.plan, 0);
  assert.equal(r.stats.alreadyImported, 1);
});
