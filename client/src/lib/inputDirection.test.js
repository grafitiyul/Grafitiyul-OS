import test from 'node:test';
import assert from 'node:assert/strict';
import { dirForInput } from './inputDirection.js';

// Pins the composer-field direction rule: a Hebrew form must READ Hebrew while
// empty, but must not force RTL onto an English address the user typed.

test('empty field is RTL so the Hebrew placeholder starts on the right', () => {
  assert.equal(dirForInput(''), 'rtl');
  assert.equal(dirForInput('   '), 'rtl');
  assert.equal(dirForInput(null), 'rtl');
  assert.equal(dirForInput(undefined), 'rtl');
});

test('non-empty field defers to its content (auto = first-strong)', () => {
  assert.equal(dirForInput('dor@example.com'), 'auto'); // renders LTR, readable
  assert.equal(dirForInput('שלום'), 'auto'); // renders RTL
  assert.equal(dirForInput('Re: הצעת מחיר'), 'auto');
});
