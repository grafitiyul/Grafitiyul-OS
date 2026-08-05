import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactDisplayName, presetOrgForContact } from './createDealPreset.js';

// Preset-contact mode of the canonical CreateDealModal ("פתיחת דיל חדש" from a
// Contact page): the display name + preselected organization derivation.

test('contactDisplayName — Hebrew name wins', () => {
  assert.equal(
    contactDisplayName({ firstNameHe: 'ישראל', lastNameHe: 'ישראלי', firstNameEn: 'Israel', lastNameEn: 'Israeli' }),
    'ישראל ישראלי',
  );
});

test('contactDisplayName — English-only contact falls back to the English pair', () => {
  assert.equal(
    contactDisplayName({ firstNameHe: '', lastNameHe: '', firstNameEn: 'John', lastNameEn: 'Smith' }),
    'John Smith',
  );
});

test('contactDisplayName — partial names trim cleanly', () => {
  assert.equal(contactDisplayName({ firstNameHe: 'דנה', lastNameHe: '' }), 'דנה');
  assert.equal(contactDisplayName(null), '');
});

test('presetOrgForContact — no org links → null (org section stays closed)', () => {
  assert.equal(presetOrgForContact({ orgLinks: [] }), null);
  assert.equal(presetOrgForContact({}), null);
  assert.equal(presetOrgForContact(null), null);
});

test('presetOrgForContact — single linked org is preselected', () => {
  const c = { orgLinks: [{ isPrimary: false, organization: { id: 'o1', name: 'אורט' } }] };
  assert.deepEqual(presetOrgForContact(c), { id: 'o1', name: 'אורט' });
});

test('presetOrgForContact — the PRIMARY link wins over an earlier non-primary link', () => {
  const c = {
    orgLinks: [
      { isPrimary: false, organization: { id: 'o1', name: 'אורט' } },
      { isPrimary: true, organization: { id: 'o2', name: 'עמל' } },
    ],
  };
  assert.deepEqual(presetOrgForContact(c), { id: 'o2', name: 'עמל' });
});

test('presetOrgForContact — only genuinely linked orgs, never derived from other fields', () => {
  // A contact whose name/phone/email mention an org must NOT produce a preset.
  const c = {
    firstNameHe: 'אורט',
    notes: 'עובד בעמל',
    orgLinks: [],
  };
  assert.equal(presetOrgForContact(c), null);
});
