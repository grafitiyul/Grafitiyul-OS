import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStaffDisplayName,
  isAirtableRecordId,
  isEmailLike,
  HISTORICAL_STAFF_FALLBACK,
} from '../../../shared/staffAssignmentDisplay.mjs';

// THE canonical staff-assignment display rule — one resolver, one behavior on
// every tour/payroll surface. Priority + corruption cases pinned one by one.

test('linked PersonRef name always wins', () => {
  assert.equal(
    resolveStaffDisplayName({
      personRef: { displayName: 'לירון מרציאנו' },
      displayName: 'recQhpJc72rQPQ1c0',
      externalPersonId: 'lyronne.marciano@gmail.com',
    }),
    'לירון מרציאנו',
  );
});

test('valid snapshot used when no PersonRef linked', () => {
  assert.equal(
    resolveStaffDisplayName({ personRef: null, displayName: 'רון', externalPersonId: 'legacy:rec123' }),
    'רון',
  );
});

test('corrupted rec-id snapshot is rejected → falls back to email', () => {
  assert.equal(
    resolveStaffDisplayName({
      personRef: null,
      displayName: 'recQhpJc72rQPQ1c0',
      externalPersonId: 'lyronne.marciano@gmail.com',
    }),
    'lyronne.marciano@gmail.com',
  );
});

test('no PersonRef, rec-id snapshot, non-email external → neutral fallback', () => {
  assert.equal(
    resolveStaffDisplayName({
      personRef: null,
      displayName: 'recQhpJc72rQPQ1c0',
      externalPersonId: 'legacy:recABC',
    }),
    HISTORICAL_STAFF_FALLBACK,
  );
});

test('internal handles are never shown as a name', () => {
  assert.equal(
    resolveStaffDisplayName({ personRef: null, displayName: 'recQhpJc72rQPQ1c0', externalPersonId: 'guide:13' }),
    HISTORICAL_STAFF_FALLBACK,
  );
  assert.equal(
    resolveStaffDisplayName({ personRef: null, displayName: '', externalPersonId: 'manual:abc-def' }),
    HISTORICAL_STAFF_FALLBACK,
  );
});

test('empty / null row → neutral fallback', () => {
  assert.equal(resolveStaffDisplayName(null), HISTORICAL_STAFF_FALLBACK);
  assert.equal(resolveStaffDisplayName({}), HISTORICAL_STAFF_FALLBACK);
});

test('whitespace is trimmed on every branch', () => {
  assert.equal(resolveStaffDisplayName({ personRef: { displayName: '  דנה  ' } }), 'דנה');
  assert.equal(resolveStaffDisplayName({ displayName: '  שרה  ' }), 'שרה');
  assert.equal(resolveStaffDisplayName({ externalPersonId: '  a@b.com  ' }), 'a@b.com');
});

test('isAirtableRecordId strictness — exactly rec + 14 alnum', () => {
  assert.equal(isAirtableRecordId('recQhpJc72rQPQ1c0'), true); // rec + 14
  assert.equal(isAirtableRecordId('rec123'), false); // too short
  assert.equal(isAirtableRecordId('recQhpJc72rQPQ1c0extra'), false); // too long
  assert.equal(isAirtableRecordId('legacy:recQhpJc72rQPQ1c0'), false); // prefixed
  assert.equal(isAirtableRecordId('recovery'), false); // real word starting with rec
  assert.equal(isAirtableRecordId('רון'), false);
});

test('isEmailLike accepts real emails, rejects handles', () => {
  assert.equal(isEmailLike('a@b.com'), true);
  assert.equal(isEmailLike('lyronne.marciano@gmail.com'), true);
  assert.equal(isEmailLike('guide:13'), false);
  assert.equal(isEmailLike('legacy:recABC'), false);
  assert.equal(isEmailLike('not-an-email'), false);
});
