import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySearchInput,
  isCreatable,
  createLeadDescription,
  createLeadPrefill,
} from './searchIntent.js';

// ————— phones — every common spelling converges on the canonical intl form,
// and the operator's original text is preserved for display/prefill —————

test('common phone formats classify as phone with the canonical intl digits', () => {
  for (const raw of [
    '0501234567',
    '050-123-4567',
    '050 123 4567',
    '(050) 123-4567',
    '+972501234567',
    '972501234567',
    '+972 50 123 4567',
  ]) {
    const r = classifySearchInput(raw);
    assert.equal(r.kind, 'phone', `${raw} should be a phone`);
    assert.equal(r.intl, '972501234567', `${raw} should normalize canonically`);
    assert.equal(r.text, raw.trim(), 'original input preserved');
  }
});

test('phone-shaped but malformed input is invalid — no creation offered', () => {
  assert.equal(classifySearchInput('050-123').kind, 'invalid'); // too short
  assert.equal(classifySearchInput('+9725551780355').kind, 'invalid'); // impossible Israeli
  assert.equal(classifySearchInput('12345').kind, 'invalid'); // digit fragment
});

// ————— emails — system convention: trim + lowercase —————

test('emails classify as email, lowercased per the system convention', () => {
  const r = classifySearchInput('  Dana.Cohen@Example.COM ');
  assert.equal(r.kind, 'email');
  assert.equal(r.email, 'dana.cohen@example.com');
  assert.equal(r.text, 'Dana.Cohen@Example.COM');
});

test('malformed email-like input is invalid, never treated as a name', () => {
  assert.equal(classifySearchInput('dana@example').kind, 'invalid');
  assert.equal(classifySearchInput('dana@').kind, 'invalid');
});

// ————— names — via the canonical shared/nameLanguage.mjs script rule —————

test('Hebrew names route to the Hebrew side', () => {
  assert.equal(classifySearchInput('דנה כהן').kind, 'name_he');
});

test('Latin names route to the English side', () => {
  assert.equal(classifySearchInput('Dana Cohen').kind, 'name_en');
});

test('mixed-script names are never guessed — flagged mixed and still creatable', () => {
  const r = classifySearchInput('Dana כהן');
  assert.equal(r.kind, 'mixed');
  assert.ok(isCreatable(r));
  const p = createLeadPrefill(r);
  assert.equal(p.fullName, 'Dana כהן');
  assert.ok(p.hint, 'mixed prefill carries an operator hint');
});

// ————— invalid inputs —————

test('empty / one-character / punctuation-only input is invalid', () => {
  for (const raw of ['', ' ', 'a', 'א', '..', '!!']) {
    const r = classifySearchInput(raw);
    assert.equal(r.kind, 'invalid', `"${raw}" should be invalid`);
    assert.ok(!isCreatable(r));
    assert.equal(createLeadPrefill(r), null);
    assert.equal(createLeadDescription(r), null);
  }
});

// ————— prefill routing: exactly one Contact field receives the value —————

test('phone prefills ONLY the phone field, preserving original formatting', () => {
  const p = createLeadPrefill(classifySearchInput('050-123-4567'));
  assert.deepEqual(p, { phone: '050-123-4567' });
});

test('email prefills ONLY the email field, lowercased', () => {
  const p = createLeadPrefill(classifySearchInput('Dana@Example.com'));
  assert.deepEqual(p, { email: 'dana@example.com' });
});

test('names prefill ONLY the full-name field (canonical split happens at submit)', () => {
  assert.deepEqual(createLeadPrefill(classifySearchInput('דנה כהן')), { fullName: 'דנה כהן' });
  assert.deepEqual(createLeadPrefill(classifySearchInput('Dana Cohen')), { fullName: 'Dana Cohen' });
});

// ————— the supporting action label —————

test('create-lead description adapts to the recognized type', () => {
  assert.match(createLeadDescription(classifySearchInput('050-123-4567')), /050-123-4567/);
  assert.match(createLeadDescription(classifySearchInput('Dana@Example.com')), /dana@example\.com/);
  assert.match(createLeadDescription(classifySearchInput('דנה כהן')), /דנה כהן/);
});
