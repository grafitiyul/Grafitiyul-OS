import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuidePortalAccess, buildGuidePermissions } from './access.js';

// Regression guard for the portal-pay outage: resolveGuidePortalAccess's
// contract is (client, { portalToken }). portalPay.js once passed the token
// POSITIONALLY — the resolver threw before any payroll query ran and every
// guide saw "שגיאה בטעינת נתוני השכר" even after office approval. These tests
// pin the contract with a stub client (no DB).

const PERSON = {
  id: 'p1',
  externalPersonId: 'ext-1',
  displayName: 'מדריך בדיקה',
  portalEnabled: true,
  status: 'active',
};

const SETTINGS = {
  viewTeam: true,
  viewParticipantPhone: true,
  viewParticipantEmail: true,
  viewCustomerInfo: true,
  viewFieldRep: true,
  fillTourSummary: true,
  useTourGallery: true,
  useCoordinationForms: true,
  viewPay: true,
  viewProcedures: true,
  viewTraining: true,
  editPersonalProfile: true,
};

function stubClient({ person = PERSON, settings = SETTINGS } = {}) {
  return {
    personRef: {
      findUnique: async ({ where }) => (where.portalToken === 'good-token' ? person : null),
    },
    guidePortalSettings: { findUnique: async () => settings },
    tourGallerySettings: {
      findUnique: async () => ({ guideCanDelete: true, guideCanShareCustomerLink: true }),
    },
  };
}

test('resolveGuidePortalAccess(client, { portalToken }) resolves ok with permissions', async () => {
  const access = await resolveGuidePortalAccess(stubClient(), { portalToken: 'good-token' });
  assert.equal(access.ok, true);
  assert.equal(access.person.externalPersonId, 'ext-1');
  assert.equal(access.permissions.viewPay, true);
});

test('viewPay=false in settings flows into permissions (the pay gate)', async () => {
  const access = await resolveGuidePortalAccess(
    stubClient({ settings: { ...SETTINGS, viewPay: false } }),
    { portalToken: 'good-token' },
  );
  assert.equal(access.ok, true);
  assert.equal(access.permissions.viewPay, false);
});

test('unknown token → 404 without enumeration signal', async () => {
  const access = await resolveGuidePortalAccess(stubClient(), { portalToken: 'wrong' });
  assert.deepEqual(access, { ok: false, status: 404, error: 'not_found' });
});

test('blocked/disabled person → 403 portal_disabled', async () => {
  const access = await resolveGuidePortalAccess(
    stubClient({ person: { ...PERSON, portalEnabled: false } }),
    { portalToken: 'good-token' },
  );
  assert.deepEqual(access, { ok: false, status: 403, error: 'portal_disabled' });
});

test('REGRESSION: passing the token positionally (the portal-pay bug) fails loudly, never resolves', async () => {
  await assert.rejects(() => resolveGuidePortalAccess('good-token'));
});

test('buildGuidePermissions carries viewPay from settings verbatim', () => {
  const gallery = { guideCanDelete: false, guideCanShareCustomerLink: false };
  assert.equal(buildGuidePermissions({ ...SETTINGS, viewPay: true }, gallery).viewPay, true);
  assert.equal(buildGuidePermissions({ ...SETTINGS, viewPay: false }, gallery).viewPay, false);
});
