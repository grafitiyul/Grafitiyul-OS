import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneQuery, significantDigits, isExactPhoneMatch } from './phoneQuery.js';

// The spec's core requirement: 050… / 97250… / +97250… / spaced / dashed /
// bracketed must ALL find the same contact.
const SAME_NUMBER = [
  '0501234567',
  '050-123-4567',
  '050 123 4567',
  '(050) 123-4567',
  '+972501234567',
  '+972 50 123 4567',
  '972501234567',
  '972-50-1234567',
  '00972501234567',
];

test('every spelling of one number yields the same exact query', () => {
  for (const raw of SAME_NUMBER) {
    const pq = phoneQuery(raw);
    assert.equal(pq.kind, 'exact', `${raw} should normalize`);
    assert.equal(pq.intl, '972501234567', `${raw} → intl`);
    assert.equal(pq.significant, '501234567', `${raw} → significant`);
  }
});

test('every spelling matches a contact stored in any other spelling', () => {
  for (const stored of SAME_NUMBER) {
    for (const typed of SAME_NUMBER) {
      const pq = phoneQuery(typed);
      assert.equal(
        isExactPhoneMatch(stored, pq.intl),
        true,
        `typed ${typed} should match stored ${stored}`,
      );
    }
  }
});

test('a different number never matches', () => {
  const pq = phoneQuery('0501234567');
  assert.equal(isExactPhoneMatch('0501234568', pq.intl), false);
  assert.equal(isExactPhoneMatch('0521234567', pq.intl), false);
});

test('significant digits are the last 9 — present in every stored spelling', () => {
  assert.equal(significantDigits('972501234567'), '501234567');
  assert.equal(significantDigits('12125551234'), '125551234');
  assert.equal(significantDigits(null), null);
});

test('a partial fragment is a partial query, with the leading zero stripped', () => {
  const pq = phoneQuery('050123');
  assert.equal(pq.kind, 'partial');
  // '50123' appears in both '0501234567' and '972501234567'.
  assert.equal(pq.needle, '50123');
});

test('a bare prefix still searches', () => {
  assert.deepEqual(phoneQuery('050'), { kind: 'partial', needle: '50' });
});

test('non-phone and too-short input is not a phone query', () => {
  assert.equal(phoneQuery('שלום').kind, 'none');
  assert.equal(phoneQuery('').kind, 'none');
  assert.equal(phoneQuery('5').kind, 'none');
});

test('a text query containing digits still yields a usable fragment', () => {
  const pq = phoneQuery('סיור 2026');
  assert.equal(pq.kind, 'partial');
  assert.equal(pq.needle, '2026');
});

test('a landline normalizes like a mobile', () => {
  const pq = phoneQuery('03-1234567');
  assert.equal(pq.kind, 'exact');
  assert.equal(pq.intl, '97231234567');
});
