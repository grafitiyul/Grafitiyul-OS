import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIORITY_VALUES,
  PRIORITY_ORDER_SQL,
  priorityRank,
  comparePriority,
  priorityOrderSql,
  isValidPriority,
} from './priority.js';

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

test('the SQL CASE ranks identically to the in-memory comparator', () => {
  // Both consumers must agree, or the grid sorts differently from any
  // in-memory path. Parse the ranks straight out of the constant.
  for (const value of ['high', 'medium', 'low']) {
    const m = PRIORITY_ORDER_SQL.match(new RegExp(`WHEN '${value}' THEN (\\d+)`));
    assert.ok(m, `CASE must handle ${value}`);
    assert.equal(Number(m[1]), priorityRank(value), `SQL rank for ${value} must match priorityRank`);
  }
  const fallback = PRIORITY_ORDER_SQL.match(/ELSE (\d+) END/);
  assert.equal(Number(fallback[1]), priorityRank(null), 'SQL ELSE must match the none rank');
});

test('priorityOrderSql only accepts exact directions — no injection surface', () => {
  assert.ok(priorityOrderSql('asc').endsWith(' ASC'));
  assert.ok(priorityOrderSql('desc').endsWith(' DESC'));
  for (const bad of ['ASC', 'asc; DROP TABLE "Task"', '', null, undefined, 'ascending', 1]) {
    assert.throws(() => priorityOrderSql(bad), /direction must be/, `must reject ${JSON.stringify(bad)}`);
  }
});

test('the SQL fragment interpolates nothing and binds no parameters', () => {
  // Guards the §4.4 constraint: no untrusted fragment can reach the query text.
  assert.ok(!PRIORITY_ORDER_SQL.includes('${'), 'no template interpolation');
  assert.ok(!PRIORITY_ORDER_SQL.includes('$1'), 'no positional parameters to disturb the caller');
  assert.ok(!/;/.test(PRIORITY_ORDER_SQL), 'single expression, no statement break');
  assert.ok(PRIORITY_ORDER_SQL.includes('"Task"."priority"'), 'reads the source-of-truth column directly');
});

test('isValidPriority accepts the vocabulary and null, rejects junk', () => {
  for (const v of ['high', 'medium', 'low', null, undefined]) assert.ok(isValidPriority(v));
  for (const v of ['urgent', 'HIGH', '', 'none', 0]) assert.ok(!isValidPriority(v));
});
