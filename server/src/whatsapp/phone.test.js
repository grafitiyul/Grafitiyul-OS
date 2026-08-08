import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneIntl, buildPhoneIndex, matchContactId } from './phone.js';

test('normalizePhoneIntl: Israeli local forms → international digits', () => {
  assert.equal(normalizePhoneIntl('0501234567'), '972501234567');
  assert.equal(normalizePhoneIntl('050-123-4567'), '972501234567');
  assert.equal(normalizePhoneIntl('03-1234567'), '97231234567'); // landline
});

test('normalizePhoneIntl: international inputs pass through cleanly', () => {
  assert.equal(normalizePhoneIntl('+972 50 123 4567'), '972501234567');
  assert.equal(normalizePhoneIntl('972501234567'), '972501234567');
  assert.equal(normalizePhoneIntl('0031612345678'), '31612345678'); // 00 prefix
  assert.equal(normalizePhoneIntl('12125551234'), '12125551234'); // NANP
});

test('normalizePhoneIntl: unusable input → null', () => {
  assert.equal(normalizePhoneIntl(''), null);
  assert.equal(normalizePhoneIntl('123'), null);
  assert.equal(normalizePhoneIntl('אין טלפון'), null);
  assert.equal(normalizePhoneIntl('012345678901'), null); // leading 0, unknown local shape
});

test('normalizePhoneIntl: 972+0 double prefix is repaired', () => {
  assert.equal(normalizePhoneIntl('972050-1234567'), '972501234567'); // mobile
  assert.equal(normalizePhoneIntl('97203-1234567'), '97231234567'); // landline
  // A TRUNCATED mobile is no longer "repaired" into a number that cannot exist
  // (changed 2026-08-08). 052-321816 is one digit short of an Israeli mobile,
  // and the old length-only check let it through purely because 972 + 8 digits
  // is the length of a valid LANDLINE. The numbering plan tells them apart: a
  // 5-prefix subscriber needs 9 digits, so this is data, not a phone.
  assert.equal(normalizePhoneIntl('+972 052-321816'), null);
});

test('normalizePhoneIntl: impossible Israeli shapes → null, never a fake JID', () => {
  assert.equal(normalizePhoneIntl('+9725551780355'), null); // 972 + 10 digits (foreign number, wrong prefix)
  assert.equal(normalizePhoneIntl('97254583848482'), null); // 972 + 11 digits
  assert.equal(normalizePhoneIntl('9725012345'), null); // 972 + 7 digits (truncated)
  // Real foreign numbers still pass through untouched.
  assert.equal(normalizePhoneIntl('5215551780355'), '5215551780355'); // Mexico mobile JID form
});

test('matching: exactly-one-owner links; ambiguity and misses stay unmatched', () => {
  const index = buildPhoneIndex([
    { contactId: 'c1', value: '050-123-4567' },
    { contactId: 'c1', value: '+972501234567' }, // same contact, duplicate forms
    { contactId: 'c2', value: '052-999-8888' },
    { contactId: 'c3', value: '0529998888' }, // c2+c3 SHARE a number → ambiguous
  ]);
  assert.equal(matchContactId('972501234567', index), 'c1'); // dup forms of one contact still match
  assert.equal(matchContactId('972529998888', index), null); // shared number → never guess
  assert.equal(matchContactId('972500000000', index), null); // unknown number
  assert.equal(matchContactId(null, index), null);
});
