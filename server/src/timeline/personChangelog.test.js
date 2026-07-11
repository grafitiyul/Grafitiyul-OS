import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffPersonFields,
  normalizeBankDetails,
  personChangeSnapshot,
} from './personChangelog.js';

// Person changelog — same contract as the deal changelog: grouped immutable
// changes with raw values + pre-formatted display, restore-friendly.

test('normalizeBankDetails: structured shape, trimming, legacy junk → nulls', () => {
  const clean = normalizeBankDetails({
    beneficiary: '  דנה כהן ',
    bankCode: '10',
    bankName: 'בנק לאומי',
    branchCode: '936',
    branchName: 'פלורנטין',
    accountNumber: ' 123456 ',
    someLegacyKey: 'dropped',
  });
  assert.deepEqual(clean, {
    beneficiary: 'דנה כהן',
    bankCode: '10',
    bankName: 'בנק לאומי',
    branchCode: '936',
    branchName: 'פלורנטין',
    accountNumber: '123456',
  });
  assert.deepEqual(normalizeBankDetails(null), {
    beneficiary: null,
    bankCode: null,
    bankName: null,
    branchCode: null,
    branchName: null,
    accountNumber: null,
  });
  // Legacy free-form JSON degrades safely.
  assert.equal(normalizeBankDetails({ iban: 'IL...' }).accountNumber, null);
});

test('snapshot groups bank code+name into one logical field', () => {
  const snap = personChangeSnapshot(
    { displayName: 'דנה', email: 'd@x.il', phone: '050' },
    {
      imageUrl: '/api/media/a1',
      bankDetails: { bankCode: '10', bankName: 'בנק לאומי', branchCode: '936' },
    },
  );
  assert.deepEqual(snap.bank, { code: '10', name: 'בנק לאומי' });
  assert.deepEqual(snap.branch, { code: '936', name: null });
  assert.equal(snap.imageUrl, '/api/media/a1');
});

test('diff: only touched keys compared; bank renders "10 — בנק לאומי"', () => {
  const before = personChangeSnapshot(
    { displayName: 'דנה', email: 'old@x.il', phone: '050' },
    { bankDetails: { bankCode: '12', bankName: 'בנק הפועלים' } },
  );
  const changes = diffPersonFields(before, {
    bank: { code: '10', name: 'בנק לאומי' },
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fieldKey, 'bank');
  assert.equal(changes[0].oldDisplay, '12 — בנק הפועלים');
  assert.equal(changes[0].newDisplay, '10 — בנק לאומי');
  // email untouched (undefined) → no fabricated change even though old ≠ null
  assert.ok(!changes.find((c) => c.fieldKey === 'email'));
});

test('diff: identical values produce no change; photo displays as תמונה/ללא תמונה', () => {
  const before = { imageUrl: null, displayName: 'דנה' };
  assert.deepEqual(diffPersonFields(before, { displayName: 'דנה' }), []);
  const [c] = diffPersonFields(before, { imageUrl: '/api/media/x9' });
  assert.equal(c.oldDisplay, 'ללא תמונה');
  assert.equal(c.newDisplay, 'תמונה');
  assert.equal(c.oldValue, null);
  assert.equal(c.newValue, '/api/media/x9'); // raw URL preserved → history preview
});

test('VAT history shows Hebrew labels, never raw enum values', () => {
  const before = { vatStatus: 'exempt' };
  const [c] = diffPersonFields(before, { vatStatus: 'vat_18' });
  assert.equal(c.labelHe, 'מע״מ');
  assert.equal(c.oldDisplay, 'פטור ממע״מ');
  assert.equal(c.newDisplay, '18% מע״מ');
  assert.equal(c.oldValue, 'exempt'); // raw value preserved for restore
});

test('seniority supplement: snapshot normalizes Decimal to string; diff shows old → new', () => {
  const snap = personChangeSnapshot(null, { senioritySupplement: 12.5 });
  assert.equal(snap.senioritySupplement, '12.5');
  const [c] = diffPersonFields({ senioritySupplement: '12.50' }, { senioritySupplement: '15.00' });
  assert.equal(c.labelHe, 'תוספת ותק');
  assert.equal(c.oldDisplay, '12.50');
  assert.equal(c.newDisplay, '15.00');
});

test('diff: bank equality is structural (same code+name → no change)', () => {
  const before = personChangeSnapshot(null, {
    bankDetails: { bankCode: '10', bankName: 'בנק לאומי' },
  });
  assert.deepEqual(
    diffPersonFields(before, { bank: { code: '10', name: 'בנק לאומי' } }),
    [],
  );
});
