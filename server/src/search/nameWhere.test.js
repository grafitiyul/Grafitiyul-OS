import test from 'node:test';
import assert from 'node:assert/strict';
import { contactNameOr } from './nameWhere.js';

// Regression: "דור כהן" matched NOTHING before tokenisation, because Contact
// has no stored full-name column for a `contains` to hit. Verified end-to-end
// against real Postgres; this pins the where-clause shape.
test('a single token matches any name field directly', () => {
  const or = contactNameOr('כהן');
  assert.equal(or.length, 4);
  assert.deepEqual(or[0], { firstNameHe: { contains: 'כהן', mode: 'insensitive' } });
  assert.equal(or.some((c) => c.AND), false, 'no token-AND clause for one token');
});

test('a full name adds an AND-of-ORs so every token must match some field', () => {
  const or = contactNameOr('דור כהן');
  const andClause = or.find((c) => c.AND);
  assert.ok(andClause, 'multi-token query must add the AND clause');
  assert.equal(andClause.AND.length, 2);
  for (const part of andClause.AND) {
    assert.equal(part.OR.length, 4, 'each token is tried against all 4 name fields');
  }
  assert.deepEqual(andClause.AND[0].OR[0], { firstNameHe: { contains: 'דור', mode: 'insensitive' } });
  assert.deepEqual(andClause.AND[1].OR[1], { lastNameHe: { contains: 'כהן', mode: 'insensitive' } });
});

test('the single-field clauses survive alongside the token clause', () => {
  const or = contactNameOr('Dor Cohen');
  assert.equal(or.filter((c) => !c.AND).length, 4);
});

test('extra whitespace does not create empty tokens', () => {
  const or = contactNameOr('  דור   כהן  ');
  assert.equal(or.find((c) => c.AND).AND.length, 2);
});

test('a three-part name requires all three tokens', () => {
  const or = contactNameOr('דור בן כהן');
  assert.equal(or.find((c) => c.AND).AND.length, 3);
});
