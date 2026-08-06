import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorAt, reconcileAnchor, stepTargetIndex, canStep, stepAnchor,
  drawerPosition, formatDrawerPosition, navActionForKey, NAV_ORDER,
} from './drawerNav.js';

// Task rows as the Tasks workspace has them: a task id + the deal it belongs
// to. Two tasks may share one deal.
const row = (id, dealId) => ({ id, deal: { id: dealId } });

const LIST = [
  row('t1', 'dA'),
  row('t2', 'dB'),
  row('t3', 'dC'),
  row('t4', 'dD'),
  row('t5', 'dE'),
];

// ── the urgent rule: completing a task does not move the drawer ─────────────

test('completing the open task refreshes the list but keeps the SAME deal open', () => {
  const a = anchorAt(LIST, 2); // t3 / dC
  // The refreshed list no longer contains t3 (it is no longer "open").
  const after = LIST.filter((r) => r.id !== 't3');
  const next = reconcileAnchor(a, after);
  assert.equal(next.recordId, 'dC', 'the pinned deal must not change');
  assert.equal(next.detached, true);
});

test('the drawer never auto-advances, however many times the list refreshes', () => {
  let a = anchorAt(LIST, 0); // t1 / dA
  const dropped = [];
  for (const id of ['t1', 't2', 't3']) {
    dropped.push(id);
    a = reconcileAnchor(a, LIST.filter((r) => !dropped.includes(r.id)));
    assert.equal(a.recordId, 'dA', 'still the deal the operator opened');
  }
});

test('completing the same task twice (a double-click) changes nothing the second time', () => {
  const after = LIST.filter((r) => r.id !== 't3');
  const once = reconcileAnchor(anchorAt(LIST, 2), after);
  const twice = reconcileAnchor(once, after); // the second refresh sees the same list
  assert.equal(twice, once, 'no move, no duplicate state');
});

test('the deal keeps another open task → the anchor re-attaches to it, still the same deal', () => {
  const list = [row('t1', 'dA'), row('t2', 'dB'), row('t3', 'dB'), row('t4', 'dC')];
  const a = anchorAt(list, 1); // t2 / dB
  const after = list.filter((r) => r.id !== 't2'); // t2 completed, t3 (same deal) remains
  const next = reconcileAnchor(a, after);
  assert.equal(next.recordId, 'dB');
  assert.equal(next.detached, false, 'the deal is still in the list — a real position exists');
  assert.equal(next.rowId, 't3');
  assert.equal(next.idx, 1);
});

test('a re-sort that moves the row keeps it attached at its NEW index', () => {
  const a = anchorAt(LIST, 1); // t2
  const resorted = [...LIST].reverse(); // t2 is now at index 3
  const next = reconcileAnchor(a, resorted);
  assert.equal(next.idx, 3);
  assert.equal(next.detached, false);
  assert.equal(next.recordId, 'dB');
});

test('reconcile returns the SAME reference when nothing changed (no render loop)', () => {
  const a = anchorAt(LIST, 2);
  assert.equal(reconcileAnchor(a, LIST), a);
  assert.equal(reconcileAnchor(null, LIST), null);
});

// ── neighbouring navigation stays correct after the row disappears ──────────

test('after the current row is removed, Next continues to the record that FOLLOWED it', () => {
  const a = reconcileAnchor(anchorAt(LIST, 2), LIST.filter((r) => r.id !== 't3'));
  // remaining: t1 t2 t4 t5 — t4 followed t3 and now sits at index 2
  assert.equal(stepAnchor(a, LIST.filter((r) => r.id !== 't3'), 1).recordId, 'dD');
});

test('after the current row is removed, Prev continues to the record that PRECEDED it', () => {
  const after = LIST.filter((r) => r.id !== 't3');
  const a = reconcileAnchor(anchorAt(LIST, 2), after);
  assert.equal(stepAnchor(a, after, -1).recordId, 'dB');
});

test('no record is skipped or repeated when walking a detached anchor forward', () => {
  const after = LIST.filter((r) => r.id !== 't3');
  let a = reconcileAnchor(anchorAt(LIST, 2), after);
  const seen = [];
  while (canStep(a, after, 1)) {
    a = stepAnchor(a, after, 1);
    seen.push(a.recordId);
  }
  assert.deepEqual(seen, ['dD', 'dE']);
});

test('removing the LAST row leaves Next disabled and Prev on the new last row', () => {
  const after = LIST.slice(0, 4);
  const a = reconcileAnchor(anchorAt(LIST, 4), after); // t5 was last
  assert.equal(canStep(a, after, 1), false);
  assert.equal(stepAnchor(a, after, -1).recordId, 'dD');
});

test('removing the FIRST row leaves Prev disabled and Next on the new first row', () => {
  const after = LIST.slice(1);
  const a = reconcileAnchor(anchorAt(LIST, 0), after);
  assert.equal(canStep(a, after, -1), false);
  assert.equal(stepAnchor(a, after, 1).recordId, 'dB');
});

// ── ordinary boundaries ────────────────────────────────────────────────────

test('first item: Prev disabled — last item: Next disabled', () => {
  assert.equal(canStep(anchorAt(LIST, 0), LIST, -1), false);
  assert.equal(canStep(anchorAt(LIST, 0), LIST, 1), true);
  assert.equal(canStep(anchorAt(LIST, 4), LIST, 1), false);
  assert.equal(canStep(anchorAt(LIST, 4), LIST, -1), true);
});

test('a refused step returns the anchor unchanged — the drawer never closes or jumps', () => {
  const a = anchorAt(LIST, 0);
  assert.equal(stepAnchor(a, LIST, -1), a);
  assert.equal(stepTargetIndex(a, LIST, -1), null);
});

test('manual arrows walk the current order one record at a time', () => {
  let a = anchorAt(LIST, 0);
  a = stepAnchor(a, LIST, 1);
  assert.equal(a.recordId, 'dB');
  a = stepAnchor(a, LIST, 1);
  assert.equal(a.recordId, 'dC');
  a = stepAnchor(a, LIST, -1);
  assert.equal(a.recordId, 'dB');
});

test('an emptied list disables both directions and still keeps the record open', () => {
  const a = reconcileAnchor(anchorAt(LIST, 2), []);
  assert.equal(a.recordId, 'dC');
  assert.equal(canStep(a, [], 1), false);
  assert.equal(canStep(a, [], -1), false);
});

test('switching filters keeps the deal open and clamps the anchor into the new list', () => {
  const narrow = [row('x1', 'dZ')];
  const a = reconcileAnchor(anchorAt(LIST, 4), narrow);
  assert.equal(a.recordId, 'dE', 'the pinned deal survives a filter change');
  assert.equal(a.detached, true);
  assert.ok(a.idx <= narrow.length);
  assert.equal(canStep(a, narrow, -1), true, 'navigation resumes inside the new result set');
});

test('a row with no deal opens nothing', () => {
  assert.equal(anchorAt([{ id: 't9' }], 0), null);
  assert.equal(anchorAt(LIST, 99), null);
});

// ── the counter ────────────────────────────────────────────────────────────

test('the counter reads "102 מתוך 115" — never an ambiguous RTL slash', () => {
  const rows = Array.from({ length: 115 }, (_, i) => row(`t${i}`, `d${i}`));
  const pos = drawerPosition(anchorAt(rows, 101), rows);
  assert.deepEqual(pos, { index: 102, total: 115 });
  assert.equal(formatDrawerPosition(pos), '102 מתוך 115');
  assert.ok(!formatDrawerPosition(pos).includes('/'));
});

test('the total follows the refreshed list, and a detached record claims no position', () => {
  const after = LIST.filter((r) => r.id !== 't3');
  const a = reconcileAnchor(anchorAt(LIST, 2), after);
  assert.deepEqual(drawerPosition(a, after), { index: null, total: 4 });
  assert.equal(formatDrawerPosition(drawerPosition(a, after)), '— מתוך 4');
});

// ── direction: not reversed in RTL ─────────────────────────────────────────

test('the left button is הקודם and the right button is הבא, in that physical order', () => {
  assert.deepEqual(NAV_ORDER, ['prev', 'next']);
});

test('Alt+← is previous and Alt+→ is next — the physical key, never mirrored', () => {
  assert.equal(navActionForKey({ key: 'ArrowLeft', altKey: true }), 'prev');
  assert.equal(navActionForKey({ key: 'ArrowRight', altKey: true }), 'next');
});

test('the legacy PageUp/PageDown and Alt+↑/↓ bindings keep working', () => {
  assert.equal(navActionForKey({ key: 'PageUp' }), 'prev');
  assert.equal(navActionForKey({ key: 'PageDown' }), 'next');
  assert.equal(navActionForKey({ key: 'ArrowUp', altKey: true }), 'prev');
  assert.equal(navActionForKey({ key: 'ArrowDown', altKey: true }), 'next');
});

test('a bare arrow key is not navigation (it belongs to the page underneath)', () => {
  assert.equal(navActionForKey({ key: 'ArrowLeft' }), null);
  assert.equal(navActionForKey({ key: 'ArrowRight', altKey: false }), null);
  assert.equal(navActionForKey({ key: 'a', altKey: true }), null);
  assert.equal(navActionForKey(null), null);
});
