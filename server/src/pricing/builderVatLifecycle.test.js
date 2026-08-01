import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBuilderLines } from './builderCompose.js';
import { toClientLine, lineToData } from '../quote/quoteLineMapping.js';
import { resolveBuilderVatMode, newLineVat, duplicateLineVat } from '../../../shared/vatMode.mjs';

// The FULL QuoteLine lifecycle under an order-level VAT mode: create, duplicate,
// edit, change quantity/price, automatic pricing, import, save, reload,
// recalculate. The rule under test is one sentence: an amount's VAT meaning is
// decided by the line's own override, else by the ORDER's mode — and it never
// changes on its own.
//
// This is the regression suite for the production bug where a Builder set to
// "מחיר לפני מע״מ" composed a newly added line as VAT-INCLUSIVE, because the
// order's mode lived nowhere and 'inherit' fell back to the price list.

const PRICE_LIST_DEFAULT = 'included'; // the live configuration
const RATE = 18;

// The engine's own product resolution (a card priced VAT-inclusive), so the
// tests exercise the real "automatic pricing" branch too.
const CARD = { ok: true, baseAmountMinor: 194700, unitBaseMinor: 194700, vatMode: 'included', vatRate: RATE };
const NO_PRODUCT = { ok: false, error: 'no_product' };

function compose(lines, builderVatMode, productResolution = NO_PRODUCT) {
  return composeBuilderLines({
    inputLines: lines,
    productResolution,
    vatDefault: { mode: resolveBuilderVatMode(builderVatMode, PRICE_LIST_DEFAULT), rate: RATE },
  });
}

const manualLine = (unitPriceMinor, extra = {}) => ({
  id: `l${Math.abs(unitPriceMinor)}`, kind: 'manual', label: 'שורה', quantity: 1,
  unitPriceMinor, ...newLineVat(), ...extra,
});

// ── 1. the three modes, on a freshly added 1,000 line ───────────────────────

test('לפני מע״מ: a new 1,000 line stays 1,000 net and VAT is added on top', () => {
  const { lines, totals } = compose([manualLine(100000)], 'excluded');
  assert.equal(lines[0].effectiveVatMode, 'excluded');
  assert.deepEqual(
    { net: totals.netMinor, vat: totals.vatMinor, gross: totals.grossMinor },
    { net: 100000, vat: 18000, gross: 118000 },
  );
});

test('כולל מע״מ: a new 1,000 line stays 1,000 gross and net/VAT are derived', () => {
  const { lines, totals } = compose([manualLine(100000)], 'included');
  assert.equal(lines[0].effectiveVatMode, 'included');
  assert.deepEqual(
    { net: totals.netMinor, vat: totals.vatMinor, gross: totals.grossMinor },
    { net: 84746, vat: 15254, gross: 100000 },
  );
});

test('פטור: a new 1,000 line adds no VAT at all', () => {
  const { lines, totals } = compose([manualLine(100000)], 'exempt');
  assert.equal(lines[0].effectiveVatMode, 'exempt');
  assert.deepEqual(
    { net: totals.netMinor, vat: totals.vatMinor, gross: totals.grossMinor },
    { net: 100000, vat: 0, gross: 100000 },
  );
});

// ── 2. the exact production scenario ────────────────────────────────────────

test('automatic pricing, then a NEW manual line — both read as net in a לפני מע״מ builder', () => {
  const auto = { id: 'p1', kind: 'product', label: 'סיור', quantity: 1, sourceKind: 'price_rule_base', ...newLineVat() };
  const added = manualLine(100000);
  const { lines } = compose([auto, added], 'excluded', CARD);
  assert.deepEqual(lines.map((l) => l.effectiveVatMode), ['excluded', 'excluded'],
    'the order governs BOTH the engine-priced line and the line added after it');
});

test('an existing manual line, then another one — no mixed semantics', () => {
  const { lines } = compose([manualLine(50000), manualLine(100000)], 'excluded');
  assert.deepEqual(lines.map((l) => l.effectiveVatMode), ['excluded', 'excluded']);
});

test('THE BUG: an inheriting line must never fall back to the price list over the order', () => {
  // Pre-fix behaviour was 'included' here (the price-list default) while the
  // order was 'excluded' — a 1,000 typed as net silently became gross.
  const { lines, totals } = compose([manualLine(100000)], 'excluded');
  assert.notEqual(lines[0].effectiveVatMode, PRICE_LIST_DEFAULT);
  assert.equal(totals.grossMinor, 118000);
});

// ── 3. every other creation path ────────────────────────────────────────────

test('add-on, discount, credit and product lines all follow the order', () => {
  const rows = [
    { id: 'a', kind: 'addon', label: 'תוספת', quantity: 1, unitPriceMinor: 20000, ...newLineVat() },
    { id: 'd', kind: 'discount', label: 'הנחה', quantity: 1, unitPriceMinor: 10000, ...newLineVat() },
    { id: 'c', kind: 'credit', label: 'זיכוי', quantity: 1, unitPriceMinor: 5000, ...newLineVat() },
    { id: 'p', kind: 'product', label: 'מוצר', quantity: 1, unitPriceMinor: 30000, overridden: true, ...newLineVat() },
  ];
  const { lines } = compose(rows, 'excluded', CARD);
  for (const l of lines) assert.equal(l.effectiveVatMode, 'excluded', `${l.kind} must follow the order`);
  // …and the signs still work: discount and credit subtract.
  const { totals } = compose(rows, 'excluded', CARD);
  assert.equal(totals.netMinor, 20000 - 10000 - 5000 + 30000);
});

test('a duplicated line keeps its meaning, and an inheriting duplicate follows the order', () => {
  const explicitExempt = manualLine(100000, { vatMode: 'exempt' });
  const dup = { ...explicitExempt, id: 'dup', ...duplicateLineVat(explicitExempt) };
  const { lines } = compose([explicitExempt, dup], 'excluded');
  assert.deepEqual(lines.map((l) => l.effectiveVatMode), ['exempt', 'exempt'],
    'duplication preserves an explicit override');

  const inheriting = manualLine(100000);
  const dup2 = { ...inheriting, id: 'dup2', ...duplicateLineVat(inheriting) };
  assert.deepEqual(compose([dup2], 'excluded').lines[0].effectiveVatMode, 'excluded');
  assert.deepEqual(compose([dup2], 'included').lines[0].effectiveVatMode, 'included');
});

test('an imported/frozen line promoted into a working version keeps its explicit mode', () => {
  const imported = manualLine(194700, { vatMode: 'included', sourceKind: 'pipedrive_import' });
  const { lines } = compose([imported], 'excluded');
  assert.equal(lines[0].effectiveVatMode, 'included',
    'frozen commercial evidence is a real per-line override — the order must not re-read it');
});

// ── 4. edits must not move the VAT meaning ──────────────────────────────────

test('changing quantity or unit price never changes the VAT meaning', () => {
  const base = manualLine(100000);
  const modes = [
    compose([base], 'excluded').lines[0].effectiveVatMode,
    compose([{ ...base, quantity: 7 }], 'excluded').lines[0].effectiveVatMode,
    compose([{ ...base, unitPriceMinor: 999999 }], 'excluded').lines[0].effectiveVatMode,
  ];
  assert.deepEqual(modes, ['excluded', 'excluded', 'excluded']);
  assert.equal(compose([{ ...base, quantity: 3 }], 'excluded').totals.grossMinor, 354000);
});

test('changing the order mode moves inheriting lines and leaves overrides alone', () => {
  const rows = [manualLine(100000), manualLine(100000, { vatMode: 'exempt' })];
  assert.deepEqual(compose(rows, 'included').lines.map((l) => l.effectiveVatMode), ['included', 'exempt']);
  assert.deepEqual(compose(rows, 'excluded').lines.map((l) => l.effectiveVatMode), ['excluded', 'exempt']);
});

// ── 5. save → reload → recalculate is a fixed point ─────────────────────────

test('save → reload → recompute reproduces identical money (round-trip through the DTO)', () => {
  const authored = [manualLine(100000), manualLine(25000, { vatMode: 'exempt' })];
  const first = compose(authored, 'excluded');

  // PUT /price-lines → rows → (DB) → GET /price-lines → the builder's lines
  const persisted = authored.map((l, i) => lineToData(l, i));
  const reloaded = persisted.map((r, i) => toClientLine({ ...r, id: `db${i}`, unitPriceMinor: r.unitPriceMinor }));
  const second = compose(reloaded, 'excluded');

  assert.deepEqual(reloaded.map((l) => l.vatMode), ['inherit', 'exempt'], 'the override survives, the inherit stays inherit');
  assert.deepEqual(second.totals, first.totals);
  assert.equal(second.totals.grossMinor, 118000 + 25000);
});

test('an order with NO lines still carries its mode — the first line added obeys it', () => {
  // The empty-builder hole: the picker used to write the mode onto each existing
  // line, so choosing it before adding anything left no trace at all.
  const empty = compose([], 'excluded');
  assert.equal(empty.totals.grossMinor, 0);
  const { lines } = compose([manualLine(100000)], 'excluded');
  assert.equal(lines[0].effectiveVatMode, 'excluded');
});
