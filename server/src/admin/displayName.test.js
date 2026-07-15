import test from 'node:test';
import assert from 'node:assert/strict';
import { adminDisplayName, ADMIN_NAME_SELECT } from './displayName.js';

test('displayName wins when present', () => {
  assert.equal(adminDisplayName({ username: 'dorko', displayName: 'דור כהן' }), 'דור כהן');
});

test('falls back to username when displayName is absent', () => {
  assert.equal(adminDisplayName({ username: 'dorko', displayName: null }), 'dorko');
  assert.equal(adminDisplayName({ username: 'dorko' }), 'dorko');
});

test('a blank displayName is not a name — fall back', () => {
  // The column is free text; '' and '   ' must not render as an empty owner cell.
  assert.equal(adminDisplayName({ username: 'dorko', displayName: '' }), 'dorko');
  assert.equal(adminDisplayName({ username: 'dorko', displayName: '   ' }), 'dorko');
});

test('names are trimmed', () => {
  assert.equal(adminDisplayName({ username: ' dorko ', displayName: '  דור כהן  ' }), 'דור כהן');
  assert.equal(adminDisplayName({ username: ' dorko ' }), 'dorko');
});

test('degrades to empty string rather than throwing', () => {
  // Owner is non-null in the DB, but a reader that forgot to include the
  // relation should render blank, not crash the grid.
  assert.equal(adminDisplayName(null), '');
  assert.equal(adminDisplayName(undefined), '');
  assert.equal(adminDisplayName({}), '');
  assert.equal(adminDisplayName({ displayName: 42, username: null }), '');
});

test('ADMIN_NAME_SELECT keeps both fields together and is frozen', () => {
  // A caller that selects displayName without username loses the fallback.
  assert.deepEqual(ADMIN_NAME_SELECT, { id: true, username: true, displayName: true });
  assert.ok(Object.isFrozen(ADMIN_NAME_SELECT));
});
