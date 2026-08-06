import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWER_DEAL_PARAM, DRAWER_TASK_PARAM,
  drawerParams, withDrawerParams, readDrawerParams, restoreAnchor,
} from './drawerRestore.js';
import { clampDrawerStart, maxDrawerStart, MIN_LIST_STRIP_PX } from './drawerWidth.js';

// Rows in the CRM task shape: { id: taskId, deal: { id: dealId } }.
const row = (id, dealId) => ({ id, deal: { id: dealId } });

// ── what the URL carries ────────────────────────────────────────────────────

test('a closed drawer contributes nothing — closing genuinely clears the state', () => {
  assert.deepEqual(drawerParams(null), {});
  assert.deepEqual(drawerParams({ recordId: null, rowId: 't1' }), {});
});

test('an open drawer carries the deal AND the task — ids only', () => {
  const p = drawerParams({ recordId: 'deal_1', rowId: 'task_9', idx: 3, detached: false });
  assert.deepEqual(p, { [DRAWER_DEAL_PARAM]: 'deal_1', [DRAWER_TASK_PARAM]: 'task_9' });
  // Nothing about the row's CONTENT may travel.
  assert.deepEqual(Object.keys(p).sort(), ['deal', 'task']);
});

test('withDrawerParams merges into a freshly rebuilt query without losing the filters', () => {
  const base = new URLSearchParams({ window: 'week', ownerIds: 'u1', sort: 'dueDate:desc' });
  const next = withDrawerParams(base, { recordId: 'deal_1', rowId: 'task_9' });
  assert.equal(next.get('window'), 'week');
  assert.equal(next.get('ownerIds'), 'u1');
  assert.equal(next.get('deal'), 'deal_1');
  assert.equal(next.get('task'), 'task_9');
  // The source is not mutated.
  assert.equal(base.get('deal'), null);
});

test('withDrawerParams DROPS stale drawer params when the drawer closed', () => {
  const stale = new URLSearchParams({ window: 'week', deal: 'deal_1', task: 'task_9' });
  const next = withDrawerParams(stale, null);
  assert.equal(next.get('deal'), null);
  assert.equal(next.get('task'), null);
  assert.equal(next.get('window'), 'week');
});

test('readDrawerParams: nothing open reads as null', () => {
  assert.equal(readDrawerParams(new URLSearchParams({ window: 'week' })), null);
  const r = readDrawerParams(new URLSearchParams({ deal: 'deal_1' }));
  assert.deepEqual(r, { recordId: 'deal_1', rowId: null });
});

// ── coming back after a refresh ─────────────────────────────────────────────

const ROWS = [row('task_1', 'deal_a'), row('task_9', 'deal_b'), row('task_3', 'deal_c')];

test('the same task is still there → the drawer lands exactly on it', () => {
  const a = restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, ROWS);
  assert.deepEqual(a, { recordId: 'deal_b', rowId: 'task_9', idx: 1, detached: false });
});

test('the task moved after a re-sort → still found, at its new index', () => {
  const resorted = [ROWS[2], ROWS[1], ROWS[0]];
  assert.equal(restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, resorted).idx, 1);
});

test('that task is gone but the deal has another row → anchor onto it', () => {
  const rows = [row('task_1', 'deal_a'), row('task_77', 'deal_b')];
  const a = restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, rows);
  assert.deepEqual(a, { recordId: 'deal_b', rowId: 'task_77', idx: 1, detached: false });
});

test('the task no longer exists → the DEAL stays open and says so honestly', () => {
  const a = restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, [row('task_1', 'deal_a')]);
  assert.equal(a.recordId, 'deal_b', 'the deal the operator was working on stays open');
  assert.equal(a.detached, true, 'and is honest that it is no longer in the list');
});

test('a missing task NEVER falls through to whatever deal sits at that index', () => {
  // The teleporting bug in its restore form: index 0 belongs to deal_a, and the
  // restore must not silently render it as though it were deal_b.
  const a = restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, ROWS.slice(0, 1));
  assert.notEqual(a.recordId, 'deal_a');
  assert.equal(a.recordId, 'deal_b');
});

test('an empty list still keeps the deal open', () => {
  const a = restoreAnchor({ recordId: 'deal_b', rowId: 'task_9' }, []);
  assert.equal(a.recordId, 'deal_b');
  assert.equal(a.detached, true);
});

test('no remembered drawer restores nothing', () => {
  assert.equal(restoreAnchor(null, ROWS), null);
  assert.equal(restoreAnchor({ recordId: null }, ROWS), null);
});

// ── how wide ────────────────────────────────────────────────────────────────

test('the drawer can never cover the whole queue', () => {
  assert.equal(clampDrawerStart(0, 1600), MIN_LIST_STRIP_PX);
  assert.equal(clampDrawerStart(-500, 1600), MIN_LIST_STRIP_PX);
});

test('the drawer can never be squeezed to a sliver', () => {
  const max = maxDrawerStart(1600);
  assert.equal(clampDrawerStart(99_999, 1600), max);
  assert.ok(1600 - max >= 480, 'the deal workspace keeps a workable width');
});

test('a width chosen on a wide monitor is re-clamped on a laptop', () => {
  const wide = clampDrawerStart(900, 1920);
  const onLaptop = clampDrawerStart(wide, 1280);
  assert.ok(onLaptop < wide);
  assert.ok(onLaptop >= MIN_LIST_STRIP_PX);
  assert.ok(onLaptop <= maxDrawerStart(1280));
});

test('the range never inverts on a narrow pane', () => {
  for (const w of [320, 500, 700, 900, 1100]) {
    const v = clampDrawerStart(400, w);
    assert.ok(v >= MIN_LIST_STRIP_PX, `min holds at ${w}`);
    assert.ok(v <= maxDrawerStart(w), `max holds at ${w}`);
  }
});

test('an unmeasurable pane yields no offset (mobile / not yet laid out)', () => {
  assert.equal(clampDrawerStart(400, 0), 0);
  assert.equal(clampDrawerStart(Number.NaN, 1600), 0);
});
