import test from 'node:test';
import assert from 'node:assert/strict';
import { profileDto } from './portalProfile.js';

// Exposure boundary — the guide-profile DTO must NEVER carry the admin-only
// payroll facts, even when the profile row has them set. The DTO is an
// explicit whitelist; these tests pin that contract.

const PERSON = {
  displayName: 'דנה',
  email: 'dana@x.il',
  phone: '050-1234567',
  lifecycleHint: 'staff',
};

const PROFILE_WITH_PAYROLL = {
  imageUrl: '/api/media/a1',
  imageOriginalUrl: '/api/media/a0',
  imageCrop: { x: 0, y: 0, zoom: 1 },
  bankDetails: { beneficiary: 'דנה', bankCode: '10', bankName: 'בנק לאומי' },
  // Admin-only payroll facts deliberately present on the row:
  vatStatus: 'vat_18',
  senioritySupplement: '12.50',
  travelAllowance: '30.00',
  // Internal admin fields that must also never leak:
  notes: 'הערה פנימית',
  description: 'תיאור',
};

test('guide profile DTO never contains admin payroll or internal fields', () => {
  const dto = profileDto(PERSON, PROFILE_WITH_PAYROLL, { editPersonalProfile: true });
  assert.equal('vatStatus' in dto, false);
  assert.equal('senioritySupplement' in dto, false);
  assert.equal('travelAllowance' in dto, false);
  assert.equal('notes' in dto, false);
  assert.equal('description' in dto, false);
  // And not nested inside the bank object either.
  assert.equal('vatStatus' in dto.bank, false);
  assert.equal('senioritySupplement' in dto.bank, false);
  assert.equal('travelAllowance' in dto.bank, false);
  // The whitelisted operational fields are still there.
  assert.equal(dto.displayName, 'דנה');
  assert.equal(dto.bank.bankCode, '10');
  assert.equal(dto.imageUrl, '/api/media/a1');
});

test('guide profile DTO keys are exactly the whitelist (no accidental widening)', () => {
  const dto = profileDto(PERSON, PROFILE_WITH_PAYROLL, { editPersonalProfile: false });
  assert.deepEqual(Object.keys(dto).sort(), [
    'bank',
    'canEdit',
    'displayName',
    'editableName',
    'email',
    'imageCrop',
    'imageOriginalUrl',
    'imageUrl',
    'lifecycleStage',
    'phone',
  ]);
});

// Language: the DTO shows the name in the READER's language through the
// canonical resolver, and ships the lifecycle stage as a KEY (the portal owns
// both wordings) — no rendered Hebrew crosses the wire.
test('guide profile DTO is language-aware and enum-safe', () => {
  const person = { ...PERSON, displayName: 'דנה כהן' };
  const profile = {
    ...PROFILE_WITH_PAYROLL,
    firstNameHe: 'דנה',
    lastNameHe: 'כהן',
    firstNameEn: 'Dana',
    lastNameEn: 'Cohen',
  };
  assert.equal(profileDto(person, profile, { editPersonalProfile: true }, 'he').displayName, 'דנה כהן');
  assert.equal(profileDto(person, profile, { editPersonalProfile: true }, 'en').displayName, 'Dana Cohen');
  // The EDITABLE field is always the legacy PersonRef string, in both languages
  // — the portal must never overwrite the management-owned name pair.
  assert.equal(profileDto(person, profile, { editPersonalProfile: true }, 'en').editableName, 'דנה כהן');
  assert.equal(profileDto(person, profile, { editPersonalProfile: true }, 'en').lifecycleStage, 'staff');
});

// No English name on file → the guide still sees a name (the canonical
// resolver's documented rule), never a blank. This is a DATA gap, reported by
// scripts/reportPortalEnglishGaps.js, not something code invents a name for.
test('missing English staff name falls back to the authored Hebrew one', () => {
  const person = { ...PERSON, displayName: 'דנה כהן' };
  const profile = { ...PROFILE_WITH_PAYROLL, firstNameHe: 'דנה', lastNameHe: 'כהן' };
  assert.equal(profileDto(person, profile, { editPersonalProfile: true }, 'en').displayName, 'דנה כהן');
});
