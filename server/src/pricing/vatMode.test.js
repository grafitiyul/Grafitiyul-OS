import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDER_VAT_MODES,
  LINE_VAT_MODES,
  resolveBuilderVatMode,
  effectiveLineVatMode,
  newLineVat,
  duplicateLineVat,
  normalizeBuilderVatMode,
} from '../../../shared/vatMode.mjs';
import { splitVat } from './engine.js';

test('the three builder modes are the product vocabulary; lines add only inherit', () => {
  assert.deepEqual([...BUILDER_VAT_MODES], ['included', 'excluded', 'exempt']);
  assert.deepEqual([...LINE_VAT_MODES], ['inherit', 'included', 'excluded', 'exempt']);
});

test('resolveBuilderVatMode: stored mode wins, else the price list, else included', () => {
  assert.equal(resolveBuilderVatMode('excluded', 'included'), 'excluded');
  assert.equal(resolveBuilderVatMode(null, 'included'), 'included');
  assert.equal(resolveBuilderVatMode('inherit', 'excluded'), 'excluded');
  assert.equal(resolveBuilderVatMode(null, null), 'included');
  assert.equal(resolveBuilderVatMode('nonsense', 'exempt'), 'exempt');
});

// THE regression this module exists for.
test('a new line in a "לפני מע״מ" builder is NET — never re-read as VAT-inclusive', () => {
  const builder = resolveBuilderVatMode('excluded', 'included'); // price list says included
  const fresh = newLineVat();
  assert.equal(fresh.vatMode, 'inherit');
  assert.equal(effectiveLineVatMode(fresh.vatMode, builder), 'excluded');
  // …and the ONE calculation then adds VAT on top of the typed 1,000.
  const s = splitVat(100000, effectiveLineVatMode(fresh.vatMode, builder), 18);
  assert.deepEqual(s, { netMinor: 100000, vatMinor: 18000, grossMinor: 118000 });
});

test('every builder mode reads a newly typed 1,000 the way the operator sees it', () => {
  const cases = [
    ['excluded', { netMinor: 100000, vatMinor: 18000, grossMinor: 118000 }],
    ['included', { netMinor: 84746, vatMinor: 15254, grossMinor: 100000 }],
    ['exempt', { netMinor: 100000, vatMinor: 0, grossMinor: 100000 }],
  ];
  for (const [mode, expected] of cases) {
    const builder = resolveBuilderVatMode(mode, 'included');
    const line = newLineVat();
    const eff = effectiveLineVatMode(line.vatMode, builder);
    assert.equal(eff, mode);
    assert.deepEqual(splitVat(100000, eff, mode === 'exempt' ? 0 : 18), expected, mode);
  }
});

test('a per-line override beats the order; the order beats the engine/card fallback', () => {
  assert.equal(effectiveLineVatMode('exempt', 'excluded', 'included'), 'exempt');
  assert.equal(effectiveLineVatMode('inherit', 'excluded', 'included'), 'excluded');
  // No order opinion → the engine-priced product line keeps its card's terms.
  assert.equal(effectiveLineVatMode('inherit', null, 'included'), 'included');
  assert.equal(effectiveLineVatMode(null, null, null), 'included');
});

test('duplicating a line preserves its VAT meaning exactly', () => {
  assert.deepEqual(duplicateLineVat({ vatMode: 'exempt', vatRate: 0 }), { vatMode: 'exempt', vatRate: 0 });
  assert.deepEqual(duplicateLineVat({ vatMode: 'inherit', vatRate: null }), { vatMode: 'inherit', vatRate: null });
  // A duplicate of an inheriting line keeps inheriting — it must not be frozen
  // to the mode that happened to be active at the moment it was copied.
  const dup = duplicateLineVat({ vatMode: 'inherit' });
  assert.equal(effectiveLineVatMode(dup.vatMode, 'excluded'), 'excluded');
  assert.equal(effectiveLineVatMode(dup.vatMode, 'included'), 'included');
});

test('changing the order mode moves every inheriting line with it, and only those', () => {
  const lines = [{ vatMode: 'inherit' }, { vatMode: 'exempt' }, { vatMode: 'inherit' }];
  const before = lines.map((l) => effectiveLineVatMode(l.vatMode, 'included'));
  const after = lines.map((l) => effectiveLineVatMode(l.vatMode, 'excluded'));
  assert.deepEqual(before, ['included', 'exempt', 'included']);
  assert.deepEqual(after, ['excluded', 'exempt', 'excluded']);
});

test('normalizeBuilderVatMode rejects anything that is not a real order mode', () => {
  assert.equal(normalizeBuilderVatMode('included'), 'included');
  assert.equal(normalizeBuilderVatMode('inherit'), null);
  assert.equal(normalizeBuilderVatMode(''), null);
  assert.equal(normalizeBuilderVatMode(undefined), null);
});
