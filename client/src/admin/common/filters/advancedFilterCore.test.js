import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyGroup,
  emptyCondition,
  normalizeTree,
  isConditionComplete,
  countActiveConditions,
  evaluateTree,
  updateNodeAt,
  removeNodeAt,
  addChildAt,
  operatorsFor,
  matchOrdered,
  matchIsAmong,
} from './advancedFilterCore.js';

// Minimal field registry used across the suite.
const FIELDS = {
  name: { key: 'name', type: 'staff', match: (row, op, v) => matchIsAmong(row.names, op, v) },
  date: { key: 'date', type: 'date', match: (row, op, v) => matchOrdered(row.date, op, v) },
  time: { key: 'time', type: 'time', match: (row, op, v) => matchOrdered(row.time, op, v) },
  text: {
    key: 'text',
    type: 'text',
    match: (row, op, v) => op === 'contains' && String(row.text || '').includes(v),
  },
};

const cond = (field, operator, value) => ({ kind: 'condition', field, operator, value });
const group = (op, ...children) => ({ kind: 'group', op, children });

const ROW = { names: ['שיר זמיר', 'דנה לוי'], date: '2026-08-05', time: '10:30', text: 'סדנה' };

test('empty tree matches everything', () => {
  assert.equal(evaluateTree(emptyGroup(), ROW, FIELDS), true);
  assert.equal(evaluateTree(null, ROW, FIELDS), true);
});

test('single condition — is / isNot', () => {
  assert.equal(evaluateTree(group('and', cond('name', 'is', 'שיר זמיר')), ROW, FIELDS), true);
  assert.equal(evaluateTree(group('and', cond('name', 'is', 'אחר')), ROW, FIELDS), false);
  assert.equal(evaluateTree(group('and', cond('name', 'isNot', 'אחר')), ROW, FIELDS), true);
  assert.equal(evaluateTree(group('and', cond('name', 'isNot', 'שיר זמיר')), ROW, FIELDS), false);
});

test('AND requires all, OR requires one', () => {
  const yes = cond('name', 'is', 'שיר זמיר');
  const no = cond('name', 'is', 'אחר');
  assert.equal(evaluateTree(group('and', yes, no), ROW, FIELDS), false);
  assert.equal(evaluateTree(group('or', yes, no), ROW, FIELDS), true);
  assert.equal(evaluateTree(group('or', no, no), ROW, FIELDS), false);
});

test('nested groups: A AND (B OR C)', () => {
  const tree = group(
    'and',
    cond('date', 'on', '2026-08-05'),
    group('or', cond('name', 'is', 'אחר'), cond('name', 'is', 'דנה לוי')),
  );
  assert.equal(evaluateTree(tree, ROW, FIELDS), true);
  const treeNo = group(
    'and',
    cond('date', 'on', '2026-08-05'),
    group('or', cond('name', 'is', 'אחר'), cond('name', 'is', 'עוד אחר')),
  );
  assert.equal(evaluateTree(treeNo, ROW, FIELDS), false);
});

test('incomplete conditions are ignored, not failing', () => {
  const tree = group('and', cond('name', 'is', 'שיר זמיר'), emptyCondition());
  assert.equal(evaluateTree(tree, ROW, FIELDS), true);
  // A group whose only child is incomplete matches everything.
  assert.equal(evaluateTree(group('and', emptyCondition()), ROW, FIELDS), true);
  // Unknown field key (stale persisted state) is ignored.
  assert.equal(evaluateTree(group('and', cond('gone', 'is', 'x')), ROW, FIELDS), true);
});

test('date operators: on / before / after / between', () => {
  assert.equal(evaluateTree(group('and', cond('date', 'before', '2026-09-01')), ROW, FIELDS), true);
  assert.equal(evaluateTree(group('and', cond('date', 'before', '2026-08-05')), ROW, FIELDS), false);
  assert.equal(evaluateTree(group('and', cond('date', 'after', '2026-08-01')), ROW, FIELDS), true);
  assert.equal(
    evaluateTree(group('and', cond('date', 'between', { from: '2026-08-01', to: '2026-08-31' })), ROW, FIELDS),
    true,
  );
  assert.equal(
    evaluateTree(group('and', cond('date', 'between', { from: '2026-09-01', to: '2026-09-30' })), ROW, FIELDS),
    false,
  );
});

test('time operators: before / after / between (lexicographic HH:MM)', () => {
  assert.equal(evaluateTree(group('and', cond('time', 'before', '11:00')), ROW, FIELDS), true);
  assert.equal(evaluateTree(group('and', cond('time', 'after', '11:00')), ROW, FIELDS), false);
  assert.equal(
    evaluateTree(group('and', cond('time', 'between', { from: '10:00', to: '11:00' })), ROW, FIELDS),
    true,
  );
});

test('between is incomplete until both ends are set', () => {
  const half = cond('date', 'between', { from: '2026-08-01', to: '' });
  assert.equal(isConditionComplete(half, FIELDS.date), false);
  assert.equal(evaluateTree(group('and', half), ROW, FIELDS), true); // ignored
});

test('countActiveConditions counts only complete conditions, recursively', () => {
  const tree = group(
    'and',
    cond('name', 'is', 'שיר זמיר'),
    emptyCondition(),
    group('or', cond('date', 'on', '2026-08-05'), cond('gone', 'is', 'x')),
  );
  assert.equal(countActiveConditions(tree, FIELDS), 2);
});

test('normalizeTree survives garbage and clamps shape', () => {
  assert.deepEqual(normalizeTree(null), emptyGroup());
  assert.deepEqual(normalizeTree('junk'), emptyGroup());
  assert.deepEqual(normalizeTree({ kind: 'group', op: 'weird', children: [null, 7] }), emptyGroup('and'));
  const kept = normalizeTree(group('or', cond('name', 'is', 'x')));
  assert.equal(kept.op, 'or');
  assert.equal(kept.children.length, 1);
});

test('tree editing: update / add / remove by path', () => {
  let tree = emptyGroup();
  tree = addChildAt(tree, [], emptyCondition('name'));
  tree = addChildAt(tree, [], emptyGroup('or'));
  tree = addChildAt(tree, [1], emptyCondition('date'));
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[1].children[0].field, 'date');
  tree = updateNodeAt(tree, [0], { operator: 'is', value: 'שיר זמיר' });
  assert.equal(tree.children[0].value, 'שיר זמיר');
  tree = removeNodeAt(tree, [1, 0]);
  assert.equal(tree.children[1].children.length, 0);
  tree = removeNodeAt(tree, [1]);
  assert.equal(tree.children.length, 1);
});

test('operatorsFor respects the type and per-field narrowing', () => {
  assert.deepEqual(operatorsFor({ type: 'date' }), ['on', 'before', 'after', 'between']);
  assert.deepEqual(operatorsFor({ type: 'date', operators: ['before', 'nope'] }), ['before']);
  assert.deepEqual(operatorsFor({ type: 'text' }), ['contains']);
});
