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
  // Internal admin fields that must also never leak:
  notes: 'הערה פנימית',
  description: 'תיאור',
};

test('guide profile DTO never contains admin payroll or internal fields', () => {
  const dto = profileDto(PERSON, PROFILE_WITH_PAYROLL, { editPersonalProfile: true });
  assert.equal('vatStatus' in dto, false);
  assert.equal('senioritySupplement' in dto, false);
  assert.equal('notes' in dto, false);
  assert.equal('description' in dto, false);
  // And not nested inside the bank object either.
  assert.equal('vatStatus' in dto.bank, false);
  assert.equal('senioritySupplement' in dto.bank, false);
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
    'email',
    'imageCrop',
    'imageOriginalUrl',
    'imageUrl',
    'lifecycleLabel',
    'phone',
  ]);
});
