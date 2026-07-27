import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAddresses, addAddresses, isValidAddress } from './recipientParse.js';

// The chip field keeps the composer's existing comma-joined string contract —
// these pin the tokenisation feeding it, so a typed or pasted list can never
// silently drop or duplicate a recipient.

test('splits on comma and semicolon, trimming whitespace', () => {
  assert.deepEqual(splitAddresses('a@x.com, b@y.com;c@z.com'), ['a@x.com', 'b@y.com', 'c@z.com']);
  assert.deepEqual(splitAddresses('  a@x.com  ,  b@y.com '), ['a@x.com', 'b@y.com']);
});

test('ignores empty segments and stray separators', () => {
  assert.deepEqual(splitAddresses('a@x.com,,;,b@y.com,'), ['a@x.com', 'b@y.com']);
  assert.deepEqual(splitAddresses(''), []);
  assert.deepEqual(splitAddresses(null), []);
  assert.deepEqual(splitAddresses(undefined), []);
});

test('preserves the order the user typed', () => {
  assert.deepEqual(splitAddresses('z@x.com, a@x.com'), ['z@x.com', 'a@x.com']);
});

test('addAddresses appends without duplicating (case-insensitive)', () => {
  assert.equal(addAddresses('a@x.com', ['b@y.com']), 'a@x.com, b@y.com');
  assert.equal(addAddresses('a@x.com', ['A@X.com']), 'a@x.com'); // already present
  assert.equal(addAddresses('', ['a@x.com', 'a@x.com']), 'a@x.com'); // dedupes within the batch
  assert.equal(addAddresses('', []), '');
});

test('addAddresses accepts a pasted multi-address batch', () => {
  assert.equal(addAddresses('', splitAddresses('a@x.com, b@y.com')), 'a@x.com, b@y.com');
});

test('address validity drives the invalid-chip warning', () => {
  assert.equal(isValidAddress('a@x.com'), true);
  assert.equal(isValidAddress('not-an-email'), false);
  assert.equal(isValidAddress('a@b'), false); // no TLD
  assert.equal(isValidAddress(''), false);
});
