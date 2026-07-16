import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeColumnState,
  toggleVisibleKey,
  moveKey,
  orderedVisibleColumns,
  setKeyWidth,
  renameColumnKeyInState,
  toggleSortKey,
  sortToParam,
  sortFromParam,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  MAX_SORT_KEYS,
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

test('setKeyWidth clamps to max (default and per-column)', () => {
  assert.deepEqual(setKeyWidth({}, 'a', 9999), { a: MAX_COL_WIDTH }); // default cap
  assert.deepEqual(setKeyWidth({}, 'a', 500, 60, 300), { a: 300 }); // col.maxWidth caps
  assert.deepEqual(setKeyWidth({}, 'a', 200, 60, 300), { a: 200 }); // within range untouched
  // A pathological min > max never yields a value below min.
  assert.deepEqual(setKeyWidth({}, 'a', 10, 400, 100), { a: 400 });
});

test('reset (normalizeColumnState with null) restores default widths (empty map)', () => {
  const s = normalizeColumnState(null, KEYS, DEFAULTS);
  assert.deepEqual(s.widths, {}, 'איפוס לברירת מחדל clears persisted widths too');
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

// ── Multi-column sort ────────────────────────────────────────────────────
// Added with the CRM Tasks workspace. Screens that sort by a single column
// keep passing a single {key,dir}; these helpers are opt-in.

test('toggleSortKey: plain click sorts by one column, asc first', () => {
  assert.deepEqual(toggleSortKey([], 'dueDate'), [{ key: 'dueDate', dir: 'asc' }]);
});

test('toggleSortKey: plain click on the active column flips direction', () => {
  const asc = [{ key: 'dueDate', dir: 'asc' }];
  assert.deepEqual(toggleSortKey(asc, 'dueDate'), [{ key: 'dueDate', dir: 'desc' }]);
  assert.deepEqual(toggleSortKey([{ key: 'dueDate', dir: 'desc' }], 'dueDate'), [{ key: 'dueDate', dir: 'asc' }]);
});

test('toggleSortKey: plain click REPLACES a multi-sort rather than growing it', () => {
  const multi = [{ key: 'dueDate', dir: 'asc' }, { key: 'priority', dir: 'desc' }];
  assert.deepEqual(toggleSortKey(multi, 'title'), [{ key: 'title', dir: 'asc' }]);
  // even clicking a column already in the list collapses to just that column
  assert.deepEqual(toggleSortKey(multi, 'priority'), [{ key: 'priority', dir: 'asc' }]);
});

test('toggleSortKey: shift+click appends, preserving order', () => {
  const one = [{ key: 'dueDate', dir: 'asc' }];
  assert.deepEqual(toggleSortKey(one, 'priority', { additive: true }), [
    { key: 'dueDate', dir: 'asc' },
    { key: 'priority', dir: 'asc' },
  ]);
});

test('toggleSortKey: shift+click cycles asc -> desc -> removed', () => {
  let s = [{ key: 'a', dir: 'asc' }, { key: 'b', dir: 'asc' }];
  s = toggleSortKey(s, 'b', { additive: true });
  assert.deepEqual(s, [{ key: 'a', dir: 'asc' }, { key: 'b', dir: 'desc' }]);
  s = toggleSortKey(s, 'b', { additive: true });
  assert.deepEqual(s, [{ key: 'a', dir: 'asc' }], 'third shift+click drops the column');
});

test('toggleSortKey: sort depth is capped', () => {
  const full = [{ key: 'a', dir: 'asc' }, { key: 'b', dir: 'asc' }, { key: 'c', dir: 'asc' }];
  assert.equal(full.length, MAX_SORT_KEYS);
  assert.deepEqual(toggleSortKey(full, 'd', { additive: true }), full, 'refuses a 4th key');
});

test('toggleSortKey: accepts the legacy single-object shape and never mutates', () => {
  const legacy = { key: 'dueDate', dir: 'asc' };
  assert.deepEqual(toggleSortKey(legacy, 'dueDate'), [{ key: 'dueDate', dir: 'desc' }]);
  const list = [{ key: 'a', dir: 'asc' }];
  toggleSortKey(list, 'b', { additive: true });
  assert.deepEqual(list, [{ key: 'a', dir: 'asc' }], 'input untouched');
});

test('sortToParam / sortFromParam round-trip', () => {
  const s = [{ key: 'dueDate', dir: 'asc' }, { key: 'priority', dir: 'desc' }];
  assert.equal(sortToParam(s), 'dueDate:asc,priority:desc');
  assert.deepEqual(sortFromParam('dueDate:asc,priority:desc'), s);
  assert.equal(sortToParam([]), '');
  assert.deepEqual(sortFromParam(''), []);
  assert.deepEqual(sortFromParam(null), []);
});

test('sortFromParam drops keys the screen does not know', () => {
  // A stale URL or saved view must not send a column the API will 400 on.
  assert.deepEqual(sortFromParam('dueDate:asc,bogus:desc', ['dueDate', 'title']), [{ key: 'dueDate', dir: 'asc' }]);
});

test('sortFromParam defaults a missing/garbage direction to asc and caps depth', () => {
  assert.deepEqual(sortFromParam('a'), [{ key: 'a', dir: 'asc' }]);
  assert.deepEqual(sortFromParam('a:sideways'), [{ key: 'a', dir: 'asc' }]);
  assert.equal(sortFromParam('a:asc,b:asc,c:asc,d:asc').length, MAX_SORT_KEYS);
});
