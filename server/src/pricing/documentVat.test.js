import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocumentVatMode,
  documentRowCalc,
  documentTotals,
} from '../../../shared/documentVat.mjs';

// THE shared accounting-document calculation — the ProduceDocumentModal preview
// and the server's iCount payload both run these exact functions, so these
// tests pin the preview AND the payload at once.

test('normalize: canonical modes pass, anything else is included', () => {
  assert.equal(normalizeDocumentVatMode('excluded'), 'excluded');
  assert.equal(normalizeDocumentVatMode('exempt'), 'exempt');
  assert.equal(normalizeDocumentVatMode('included'), 'included');
  assert.equal(normalizeDocumentVatMode(null), 'included');
  assert.equal(normalizeDocumentVatMode('inherit'), 'included');
  assert.equal(normalizeDocumentVatMode('garbage'), 'included');
});

test('included: amount is gross, VAT extracted', () => {
  const c = documentRowCalc({ quantity: 2, unitPriceIls: 590 }, 'included', 18);
  assert.equal(c.unitPriceInclIls, 590);
  assert.equal(c.grossIls, 1180);
  assert.equal(c.netIls, 1000);
  assert.equal(c.vatIls, 180);
  assert.equal(c.exempt, false);
});

test('excluded: VAT added at the UNIT level — the unitprice_incl iCount receives', () => {
  const c = documentRowCalc({ quantity: 1, unitPriceIls: 4900 }, 'excluded', 18);
  assert.equal(c.unitPriceInclIls, 5782);
  assert.equal(c.netIls, 4900);
  assert.equal(c.vatIls, 882);
  assert.equal(c.grossIls, 5782);
});

test('exempt mode / per-row vatExempt: no VAT, net equals gross', () => {
  const modeExempt = documentRowCalc({ quantity: 3, unitPriceIls: 100 }, 'exempt', 18);
  assert.deepEqual(
    { net: modeExempt.netIls, vat: modeExempt.vatIls, gross: modeExempt.grossIls, exempt: modeExempt.exempt },
    { net: 300, vat: 0, gross: 300, exempt: true },
  );
  const rowExempt = documentRowCalc({ quantity: 1, unitPriceIls: 100, vatExempt: true }, 'excluded', 18);
  assert.equal(rowExempt.grossIls, 100);
  assert.equal(rowExempt.vatIls, 0);
  assert.equal(rowExempt.exempt, true);
});

test('negative rows (discounts) reduce every total symmetrically', () => {
  const c = documentRowCalc({ quantity: 1, unitPriceIls: -100 }, 'excluded', 18);
  assert.equal(c.unitPriceInclIls, -118);
  assert.equal(c.grossIls, -118);
  assert.equal(c.netIls, -100);
  assert.equal(c.vatIls, -18);
});

test('totals: Deal #25972 — excluded ₪4,900 + ₪1,900 → net 6,800 / VAT 1,224 / gross 8,024', () => {
  const t = documentTotals(
    [
      { quantity: 1, unitPriceIls: 4900 },
      { quantity: 1, unitPriceIls: 1900 },
    ],
    'excluded',
    18,
  );
  assert.deepEqual(t, { netIls: 6800, vatIls: 1224, grossIls: 8024 });
});

test('totals: mixed exempt row inside an included document', () => {
  const t = documentTotals(
    [
      { quantity: 1, unitPriceIls: 118 },
      { quantity: 1, unitPriceIls: 100, vatExempt: true },
    ],
    'included',
    18,
  );
  assert.deepEqual(t, { netIls: 200, vatIls: 18, grossIls: 218 });
});

test('rounding: excluded unit rounds once at the unit, quantity multiplies the rounded unit', () => {
  // 33.33 × 1.18 = 39.3294 → 39.33; ×3 = 117.99 — matches what iCount computes
  // from unitprice_incl, so preview and provider can never disagree.
  const c = documentRowCalc({ quantity: 3, unitPriceIls: 33.33 }, 'excluded', 18);
  assert.equal(c.unitPriceInclIls, 39.33);
  assert.equal(c.grossIls, 117.99);
});
