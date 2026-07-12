import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeColumnState,
  toggleVisibleKey,
  moveKey,
  orderedVisibleColumns,
  setKeyWidth,
  renameColumnKeyInState,
  MIN_COL_WIDTH,
} from './tableColumnsCore.js';

const KEYS = ['a', 'b', 'c', 'd'];
const DEFAULTS = ['a', 'b'];

test('no saved state → defaults visible, canonical order', () => {
  const s = normalizeColumnState(null, KEYS, DEFAULTS);
  assert.deepEqual(s.visible, ['a', 'b']);
  assert.deepEqual(s.order, ['a', 'b', 'c', 'd']);
});

test('legacy saved array (visible-only) is honored; order is canonical', () => {
  const s = normalizeColumnState(['c', 'a'], KEYS, DEFAULTS);
  assert.deepEqual(s.visible, ['c', 'a']);
  assert.deepEqual(s.order, ['a', 'b', 'c', 'd']);
});

test('v2 saved state restores both visibility and order', () => {
  const s = normalizeColumnState({ visible: ['b', 'c'], order: ['c', 'a', 'b', 'd'] }, KEYS, DEFAULTS);
  assert.deepEqual(s.visible, ['b', 'c']);
  assert.deepEqual(s.order, ['c', 'a', 'b', 'd']);
});

test('unknown (removed) keys are dropped from both lists', () => {
  const s = normalizeColumnState({ visible: ['a', 'zz'], order: ['zz', 'b', 'a', 'c', 'd'] }, KEYS, DEFAULTS);
  assert.deepEqual(s.visible, ['a']);
  assert.deepEqual(s.order, ['b', 'a', 'c', 'd']);
});

test('columns added after the save keep default visibility and append to order', () => {
  // Save was made when only a+b existed; c (def) and d were added later.
  const s = normalizeColumnState({ visible: ['a'], order: ['b', 'a'] }, KEYS, ['a', 'c']);
  assert.deepEqual(s.visible, ['a', 'c']); // c is new + default-on → shown
  assert.deepEqual(s.order, ['b', 'a', 'c', 'd']);
});

test('a column the user deliberately hid stays hidden after normalize', () => {
  // b existed at save time (in order) and is not in visible → stays hidden
  // even though it is default-on.
  const s = normalizeColumnState({ visible: ['a'], order: ['a', 'b', 'c', 'd'] }, KEYS, DEFAULTS);
  assert.deepEqual(s.visible, ['a']);
});

test('toggle hides and shows; never hides the last visible column', () => {
  assert.deepEqual(toggleVisibleKey(['a', 'b'], 'b'), ['a']);
  assert.deepEqual(toggleVisibleKey(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleVisibleKey(['a'], 'a'), ['a']); // guard
});

test('moveKey reorders like a header drag (drop before/after target)', () => {
  assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveKey(['a', 'b'], 'a', 'zz'), ['a', 'b']); // unknown target — no-op
});

test('orderedVisibleColumns renders user order with visibility applied', () => {
  const columns = KEYS.map((k) => ({ key: k, label: k }));
  const out = orderedVisibleColumns(columns, { visible: ['a', 'c'], order: ['c', 'b', 'a', 'd'] });
  assert.deepEqual(out.map((c) => c.key), ['c', 'a']);
});

test('widths: restored per key, unknown keys dropped, clamped to the floor', () => {
  const s = normalizeColumnState(
    { visible: ['a'], order: ['a', 'b', 'c', 'd'], widths: { a: 240, b: 10, zz: 300, c: 'garbage' } },
    KEYS,
    DEFAULTS,
  );
  assert.deepEqual(s.widths, { a: 240, b: MIN_COL_WIDTH });
});

test('widths: legacy array save and missing widths → empty map', () => {
  assert.deepEqual(normalizeColumnState(['a'], KEYS, DEFAULTS).widths, {});
  assert.deepEqual(normalizeColumnState({ visible: ['a'], order: ['a', 'b'] }, KEYS, DEFAULTS).widths, {});
});

test('setKeyWidth clamps to min (default and per-column) and rounds', () => {
  assert.deepEqual(setKeyWidth({}, 'a', 240.6), { a: 241 });
  assert.deepEqual(setKeyWidth({ a: 240 }, 'a', 5), { a: MIN_COL_WIDTH });
  assert.deepEqual(setKeyWidth({}, 'a', 90, 120), { a: 120 }); // col.minWidth wins
  assert.deepEqual(setKeyWidth({ a: 240 }, 'a', NaN), { a: 240 }); // garbage → unchanged
});

test('per-table isolation: normalizing one table state never depends on another', () => {
  // Different canonical sets produce independent results from the same raw —
  // the guarantee that deals/contacts/organizations keys can never bleed.
  const dealsState = normalizeColumnState({ visible: ['a'], order: ['b', 'a'] }, ['a', 'b'], ['a']);
  const orgsState = normalizeColumnState(null, ['x', 'y'], ['x']);
  assert.deepEqual(dealsState.order, ['b', 'a']);
  assert.deepEqual(orgsState.order, ['x', 'y']);
  assert.deepEqual(orgsState.visible, ['x']);
});

test('renameColumnKeyInState: v2 object — swaps key in visible/order/widths, keeps place', () => {
  const raw = {
    visible: ['date', 'customer', 'status'],
    order: ['date', 'customer', 'status', 'organization'],
    widths: { customer: 220, status: 120 },
  };
  const next = renameColumnKeyInState(raw, 'customer', 'booker');
  assert.deepEqual(next.visible, ['date', 'booker', 'status']);
  assert.deepEqual(next.order, ['date', 'booker', 'status', 'organization']);
  assert.deepEqual(next.widths, { booker: 220, status: 120 }, 'width carries to the new key');
});

test('renameColumnKeyInState: legacy array form', () => {
  assert.deepEqual(
    renameColumnKeyInState(['date', 'customer', 'status'], 'customer', 'booker'),
    ['date', 'booker', 'status'],
  );
});

test('renameColumnKeyInState: target already present → just drop the old key', () => {
  const raw = { visible: ['customer', 'booker'], order: ['customer', 'booker'], widths: { booker: 200 } };
  const next = renameColumnKeyInState(raw, 'customer', 'booker');
  assert.deepEqual(next.visible, ['booker']);
  assert.deepEqual(next.order, ['booker']);
  assert.deepEqual(next.widths, { booker: 200 }, 'existing target width is not overwritten');
});

test('renameColumnKeyInState: absent source is a content no-op', () => {
  const raw = { visible: ['date'], order: ['date', 'status'], widths: {} };
  const next = renameColumnKeyInState(raw, 'customer', 'booker');
  assert.deepEqual(next.visible, ['date']);
  assert.deepEqual(next.order, ['date', 'status']);
});
