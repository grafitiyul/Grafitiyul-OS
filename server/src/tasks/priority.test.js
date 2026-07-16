import test from 'node:test';
import assert from 'node:assert/strict';
import * as priorityModule from './priority.js';
import { PRIORITY_VALUES, priorityRank, comparePriority, isValidPriority } from './priority.js';

// The whole point of this module: prove semantic ordering works WITHOUT a
// denormalized priorityRank column (architecture decision #11).

test('lexicographic sort is wrong — this is the bug the module exists to fix', () => {
  const naive = ['low', 'high', 'medium'].sort();
  assert.deepEqual(naive, ['high', 'low', 'medium'], 'guard: plain sort really is nonsense');
});

test('priorityRank orders high > medium > low > none', () => {
  assert.equal(priorityRank('high'), 0);
  assert.equal(priorityRank('medium'), 1);
  assert.equal(priorityRank('low'), 2);
  assert.equal(priorityRank(null), 3);
});

test('unrecognised values rank last, never first', () => {
  // A junk value must not jump to the top of an operator's list.
  for (const junk of [undefined, '', '  ', 'HIGH', 'urgent', 'critical', 0, 42, {}, []]) {
    assert.equal(priorityRank(junk), 3, `${JSON.stringify(junk)} should rank last`);
  }
});

test('priorityRank tolerates surrounding whitespace', () => {
  assert.equal(priorityRank(' high '), 0);
});

test('comparePriority asc sorts most urgent first, none last', () => {
  const rows = [null, 'low', 'high', 'medium', 'high'];
  const sorted = [...rows].sort((a, b) => comparePriority(a, b));
  assert.deepEqual(sorted, ['high', 'high', 'medium', 'low', null]);
});

test('comparePriority desc is the exact reverse ordering', () => {
  const rows = [null, 'low', 'high', 'medium'];
  const asc = [...rows].sort((a, b) => comparePriority(a, b, 'asc'));
  const desc = [...rows].sort((a, b) => comparePriority(a, b, 'desc'));
  assert.deepEqual(desc, [...asc].reverse());
  assert.deepEqual(desc, [null, 'low', 'medium', 'high']);
});

test('comparePriority is a consistent comparator (equal values tie)', () => {
  assert.equal(comparePriority('high', 'high'), 0);
  assert.equal(comparePriority(null, undefined), 0);
  assert.ok(comparePriority('high', 'low') < 0);
  assert.ok(comparePriority('low', 'high') > 0);
});

test('PRIORITY_VALUES is ordered most-urgent-first and frozen', () => {
  assert.deepEqual(PRIORITY_VALUES, ['high', 'medium', 'low']);
  assert.ok(Object.isFrozen(PRIORITY_VALUES));
  // The array order must agree with the ranks, or the UI and the sort disagree.
  const ranks = PRIORITY_VALUES.map(priorityRank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('this module exposes NO raw SQL — the §4.4 escape hatch went unused', () => {
  // §4.4 permitted one narrowly-contained SQL CASE as a fallback. It was not
  // needed: the canonical `where` is built by Prisma, so a raw ORDER BY would
  // still need the filtered id set first, and duplicating the filter into SQL
  // is forbidden. Ordering that id set in memory with comparePriority is
  // strictly simpler and adds no SQL surface. This test fails if someone
  // reintroduces a SQL fragment here without revisiting that reasoning.
  const exported = Object.keys(priorityModule);
  assert.deepEqual(
    exported.sort(),
    ['PRIORITY_VALUES', 'comparePriority', 'isValidPriority', 'priorityRank'],
    'no SQL fragment should be exported from priority.js',
  );
  for (const [name, value] of Object.entries(priorityModule)) {
    if (typeof value === 'string') {
      assert.ok(!/\bCASE\b|\bORDER BY\b|\bSELECT\b/i.test(value), `${name} must not carry SQL`);
    }
  }
});

test('isValidPriority accepts the vocabulary and null, rejects junk', () => {
  for (const v of ['high', 'medium', 'low', null, undefined]) assert.ok(isValidPriority(v));
  for (const v of ['urgent', 'HIGH', '', 'none', 0]) assert.ok(!isValidPriority(v));
});
