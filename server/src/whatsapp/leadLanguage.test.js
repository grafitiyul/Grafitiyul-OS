import test from 'node:test';
import assert from 'node:assert/strict';
import { leadSendLanguage, isIsraeliNumber } from './leadLanguage.js';

// The send language of the automatic new-lead reply comes from the PHONE and
// nothing else. These tests exist mainly to pin the things it must NOT use.

test('leadLanguage: an Israeli mobile in local form selects Hebrew', () => {
  const r = leadSendLanguage('050-123-4567');
  assert.equal(r.language, 'he');
  assert.equal(r.phoneIntl, '972501234567');
  assert.equal(r.reason, null);
});

test('leadLanguage: every Israeli spelling normalizes to the same Hebrew decision', () => {
  for (const raw of ['+972 50 123 4567', '00972501234567', '972050-1234567', '0501234567']) {
    const r = leadSendLanguage(raw);
    assert.equal(r.language, 'he', `expected Hebrew for ${raw}`);
    assert.equal(r.phoneIntl, '972501234567', `expected canonical digits for ${raw}`);
  }
});

test('leadLanguage: a foreign number selects English', () => {
  assert.equal(leadSendLanguage('+1 212 555 1234').language, 'en');
  assert.equal(leadSendLanguage('+44 20 7946 0958').language, 'en');
  assert.equal(leadSendLanguage('+33 6 12 34 56 78').language, 'en');
});

// THE regression this feature was asked for: a Latin-script name must never
// pull an Israeli customer into English. The resolver takes only a phone, so
// the name cannot reach it at all — this test pins that the signature stays
// that way (it would fail to compile a name-aware call).
test('leadLanguage: an English-looking name is irrelevant — the Israeli number wins', () => {
  const israeliNumberOfSomeoneCalledDavidMiller = '+972-54-987-6543';
  assert.equal(leadSendLanguage(israeliNumberOfSomeoneCalledDavidMiller).language, 'he');
  assert.equal(leadSendLanguage.length, 1, 'the resolver must accept the phone and nothing else');
});

test('leadLanguage: an unclassifiable number yields no language and an explicit reason', () => {
  // Impossible Israeli shape (972 + 10 digits) — the canonical normalizer
  // rejects it rather than minting an unreachable number.
  assert.deepEqual(leadSendLanguage('+9725551780355'), {
    language: null, phoneIntl: null, reason: 'invalid_phone',
  });
  // A local format with no country code we can place.
  assert.equal(leadSendLanguage('07911 123456').language, null);
  assert.equal(leadSendLanguage('123').reason, 'invalid_phone');
});

test('leadLanguage: a missing phone is reported distinctly from an invalid one', () => {
  assert.equal(leadSendLanguage(null).reason, 'missing_phone');
  assert.equal(leadSendLanguage('').reason, 'missing_phone');
  assert.equal(leadSendLanguage('   ').reason, 'missing_phone');
  assert.equal(leadSendLanguage('abc').reason, 'invalid_phone');
});

test('leadLanguage: isIsraeliNumber matches the language decision', () => {
  assert.equal(isIsraeliNumber('050-123-4567'), true);
  assert.equal(isIsraeliNumber('+1 212 555 1234'), false);
  assert.equal(isIsraeliNumber('garbage'), false);
});
