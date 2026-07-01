// Products route — pure unit tests for the deletion safety verdict. No DB.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { productDeletionVerdict } from './products.js';

test('no references → hard delete allowed', () => {
  const v = productDeletionVerdict({ deals: 0, quoteLines: 0 });
  assert.equal(v.canHardDelete, true);
  assert.deepEqual(v.blockers, []);
});

test('deals reference → blocked, blocker reported', () => {
  const v = productDeletionVerdict({ deals: 3, quoteLines: 0 });
  assert.equal(v.canHardDelete, false);
  assert.deepEqual(v.blockers, [{ kind: 'deals', count: 3 }]);
});

test('quote lines reference → blocked', () => {
  const v = productDeletionVerdict({ deals: 0, quoteLines: 2 });
  assert.equal(v.canHardDelete, false);
  assert.deepEqual(v.blockers, [{ kind: 'quoteLines', count: 2 }]);
});

test('both references → both blockers, order deals then quoteLines', () => {
  const v = productDeletionVerdict({ deals: 1, quoteLines: 5 });
  assert.equal(v.canHardDelete, false);
  assert.deepEqual(v.blockers, [
    { kind: 'deals', count: 1 },
    { kind: 'quoteLines', count: 5 },
  ]);
});

test('missing/undefined counts default to zero (allowed)', () => {
  assert.equal(productDeletionVerdict().canHardDelete, true);
  assert.equal(productDeletionVerdict({}).canHardDelete, true);
});
