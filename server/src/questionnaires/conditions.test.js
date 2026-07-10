import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCondition,
  validateConditionShape,
  referencedKeys,
  isEmptyAnswer,
} from '../../../shared/questionnaire/conditions.mjs';

// Shared evaluator — server-binding semantics (blueprint §10). The client uses
// the SAME module, so these tests cover both sides.

const answers = (map) => (key) => map[key];

test('null/undefined expression → always visible', () => {
  assert.equal(evaluateCondition(null, answers({})), true);
  assert.equal(evaluateCondition(undefined, answers({})), true);
});

test('eq / neq on scalars, including boolean yesno answers', () => {
  assert.equal(evaluateCondition({ q: 'a', op: 'eq', value: 'x' }, answers({ a: 'x' })), true);
  assert.equal(evaluateCondition({ q: 'a', op: 'eq', value: 'x' }, answers({ a: 'y' })), false);
  assert.equal(evaluateCondition({ q: 'b', op: 'eq', value: true }, answers({ b: true })), true);
  assert.equal(evaluateCondition({ q: 'b', op: 'eq', value: false }, answers({ b: false })), true);
  assert.equal(evaluateCondition({ q: 'a', op: 'neq', value: 'x' }, answers({ a: 'y' })), true);
});

test('missing/empty answers fail every comparison but satisfy `empty`', () => {
  for (const op of ['eq', 'neq', 'gt', 'lt', 'contains', 'in']) {
    assert.equal(
      evaluateCondition({ q: 'missing', op, value: 'x' }, answers({})),
      false,
      `op ${op} on missing answer must be false`,
    );
  }
  assert.equal(evaluateCondition({ q: 'missing', op: 'empty' }, answers({})), true);
  assert.equal(evaluateCondition({ q: 'missing', op: 'answered' }, answers({})), false);
  assert.equal(evaluateCondition({ q: 'blank', op: 'answered' }, answers({ blank: '  ' })), false);
});

test('false and 0 are REAL answers (not empty)', () => {
  assert.equal(isEmptyAnswer(false), false);
  assert.equal(isEmptyAnswer(0), false);
  assert.equal(evaluateCondition({ q: 'b', op: 'answered' }, answers({ b: false })), true);
  assert.equal(evaluateCondition({ q: 'n', op: 'answered' }, answers({ n: 0 })), true);
});

test('numeric ops coerce and reject NaN', () => {
  assert.equal(evaluateCondition({ q: 'n', op: 'gte', value: 5 }, answers({ n: 5 })), true);
  assert.equal(evaluateCondition({ q: 'n', op: 'gt', value: 5 }, answers({ n: 5 })), false);
  assert.equal(evaluateCondition({ q: 'n', op: 'lt', value: 10 }, answers({ n: '7' })), true);
  assert.equal(evaluateCondition({ q: 'n', op: 'gt', value: 1 }, answers({ n: 'abc' })), false);
});

test('in / nin / contains (array + substring)', () => {
  assert.equal(evaluateCondition({ q: 'c', op: 'in', value: ['a', 'b'] }, answers({ c: 'b' })), true);
  assert.equal(evaluateCondition({ q: 'c', op: 'nin', value: ['a', 'b'] }, answers({ c: 'z' })), true);
  assert.equal(evaluateCondition({ q: 'm', op: 'contains', value: 'w' }, answers({ m: ['w', 'x'] })), true);
  assert.equal(evaluateCondition({ q: 'm', op: 'contains', value: 'q' }, answers({ m: ['w', 'x'] })), false);
  assert.equal(evaluateCondition({ q: 's', op: 'contains', value: 'לום' }, answers({ s: 'שלום' })), true);
});

test('all / any / not compose recursively', () => {
  const expr = {
    all: [
      { q: 'type', op: 'eq', value: 'workshop' },
      { any: [{ q: 'n', op: 'gte', value: 10 }, { q: 'vip', op: 'eq', value: true }] },
      { not: { q: 'cancelled', op: 'eq', value: true } },
    ],
  };
  assert.equal(evaluateCondition(expr, answers({ type: 'workshop', n: 12 })), true);
  assert.equal(evaluateCondition(expr, answers({ type: 'workshop', vip: true })), true);
  assert.equal(evaluateCondition(expr, answers({ type: 'workshop', n: 3 })), false);
  assert.equal(evaluateCondition(expr, answers({ type: 'workshop', n: 12, cancelled: true })), false);
});

test('unknown op fails closed (condition unsatisfied, no crash)', () => {
  assert.equal(evaluateCondition({ q: 'a', op: 'regex', value: '.' }, answers({ a: 'x' })), false);
});

test('shape validation: valid expression over earlier keys passes', () => {
  const expr = { all: [{ q: 'a', op: 'eq', value: 1 }, { not: { q: 'b', op: 'answered' } }] };
  assert.deepEqual(validateConditionShape(expr, new Set(['a', 'b'])), []);
});

test('shape validation rejects forward/unknown refs (acyclic by construction)', () => {
  const problems = validateConditionShape({ q: 'later_q', op: 'eq', value: 1 }, new Set(['a']));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /forward_or_unknown_ref:later_q/);
});

test('shape validation rejects unknown ops, empty branches, missing values', () => {
  assert.match(validateConditionShape({ q: 'a', op: 'nope' }, ['a'])[0], /unknown_op/);
  assert.match(validateConditionShape({ all: [] }, [])[0], /empty_branch/);
  assert.match(validateConditionShape({ q: 'a', op: 'eq' }, ['a'])[0], /missing_value/);
  assert.match(validateConditionShape({ q: 'a', op: 'in', value: 'x' }, ['a'])[0], /value_must_be_array/);
});

test('referencedKeys collects every question the expression touches', () => {
  const expr = { all: [{ q: 'a', op: 'answered' }, { any: [{ q: 'b', op: 'eq', value: 1 }, { not: { q: 'c', op: 'empty' } }] }] };
  assert.deepEqual(referencedKeys(expr).sort(), ['a', 'b', 'c']);
});
