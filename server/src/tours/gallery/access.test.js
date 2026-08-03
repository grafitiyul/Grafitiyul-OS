import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCustomerGalleryAccess, resolveGuideGalleryAccess } from './access.js';

// Server-side permission resolution — the enforcement layer (UI hiding is
// never the gate). Guide access = valid portal token + enabled + a
// TourAssignment on THIS tour; delete/share come from settings.

function fakeClient({
  person = null,
  tour = null,
  assignment = null,
  settings = { guideCanDelete: true, guideCanShareCustomerLink: true, customerUploadEnabled: true },
  portalSettings = { useTourGallery: true },
  link = null,
  customerTour = null,
} = {}) {
  return {
    personRef: { findUnique: async () => person },
    tourEvent: {
      findUnique: async () => (customerTour !== null ? customerTour : tour),
    },
    tourAssignment: { findFirst: async () => assignment },
    tourGallerySettings: {
      findUnique: async () => ({ id: 'singleton', ...settings }),
      upsert: async () => ({ id: 'singleton', ...settings }),
    },
    guidePortalSettings: {
      findUnique: async () => ({ id: 'singleton', ...portalSettings }),
      upsert: async () => ({ id: 'singleton', ...portalSettings }),
    },
    tourGalleryLink: { findUnique: async () => link },
  };
}

const GUIDE = {
  id: 'p1',
  externalPersonId: 'ext1',
  displayName: 'דנה',
  portalEnabled: true,
  status: 'active',
};
const TOUR = { id: 't1', status: 'scheduled' };

test('assigned guide with enabled portal gets access + settings-based permissions', async () => {
  const client = fakeClient({ person: GUIDE, tour: TOUR, assignment: { id: 'a1' } });
  const res = await resolveGuideGalleryAccess(client, { portalToken: 'tok', tourEventId: 't1' });
  assert.equal(res.ok, true);
  assert.equal(res.permissions.canUpload, true);
  assert.equal(res.permissions.canDelete, true);
  assert.equal(res.permissions.canShareCustomerLink, true);
});

test('portal-wide useTourGallery=false blocks every gallery route (403)', async () => {
  const client = fakeClient({
    person: GUIDE,
    tour: TOUR,
    assignment: { id: 'a1' },
    portalSettings: { useTourGallery: false },
  });
  const res = await resolveGuideGalleryAccess(client, { portalToken: 'tok', tourEventId: 't1' });
  assert.deepEqual(
    { ok: res.ok, status: res.status, error: res.error },
    { ok: false, status: 403, error: 'not_allowed' },
  );
});

test('settings switches gate guide delete/share', async () => {
  const client = fakeClient({
    person: GUIDE,
    tour: TOUR,
    assignment: { id: 'a1' },
    settings: { guideCanDelete: false, guideCanShareCustomerLink: false },
  });
  const res = await resolveGuideGalleryAccess(client, { portalToken: 'tok', tourEventId: 't1' });
  assert.equal(res.ok, true);
  assert.equal(res.permissions.canDelete, false);
  assert.equal(res.permissions.canShareCustomerLink, false);
});

test('NON-assigned guide is refused (403) even with a valid token', async () => {
  const client = fakeClient({ person: GUIDE, tour: TOUR, assignment: null });
  const res = await resolveGuideGalleryAccess(client, { portalToken: 'tok', tourEventId: 't1' });
  assert.deepEqual(res, { ok: false, status: 403, error: 'not_assigned' });
});

test('disabled/blocked portal is refused; unknown token is a plain 404', async () => {
  const disabled = await resolveGuideGalleryAccess(
    fakeClient({ person: { ...GUIDE, portalEnabled: false } }),
    { portalToken: 'tok', tourEventId: 't1' },
  );
  assert.equal(disabled.status, 403);
  const blocked = await resolveGuideGalleryAccess(
    fakeClient({ person: { ...GUIDE, status: 'blocked' } }),
    { portalToken: 'tok', tourEventId: 't1' },
  );
  assert.equal(blocked.status, 403);
  const unknown = await resolveGuideGalleryAccess(fakeClient({ person: null }), {
    portalToken: 'nope',
    tourEventId: 't1',
  });
  assert.equal(unknown.status, 404, 'no enumeration signal');
});

test('cancelled tour: guide gallery access is fully blocked (403)', async () => {
  // Same portal-wide rule as tour detail — a cancelled tour is invisible to
  // guides (deal-reopen keeps assignment rows on the cancelled twin).
  const client = fakeClient({
    person: GUIDE,
    tour: { id: 't1', status: 'cancelled' },
    assignment: { id: 'a1' },
  });
  const res = await resolveGuideGalleryAccess(client, { portalToken: 'tok', tourEventId: 't1' });
  assert.deepEqual(
    { ok: res.ok, status: res.status, error: res.error },
    { ok: false, status: 403, error: 'tour_cancelled' },
  );
});

// ---------- customer link ----------

test('active customer link on a live tour grants view+upload, never delete', async () => {
  const client = fakeClient({
    link: { id: 'l1', status: 'active', gallery: { id: 'g1', tourEventId: 't1', customerUploadEnabled: true } },
    customerTour: { id: 't1', status: 'scheduled', product: null, bookings: [] },
  });
  const res = await resolveCustomerGalleryAccess(client, { token: 'ctok' });
  assert.equal(res.ok, true);
  assert.equal(res.permissions.canUpload, true);
  assert.equal(res.permissions.canDelete, false);
});

test('revoked link and cancelled tour both read as 404 (indistinguishable from unknown)', async () => {
  const revoked = await resolveCustomerGalleryAccess(
    fakeClient({ link: { status: 'revoked', gallery: { tourEventId: 't1' } } }),
    { token: 'ctok' },
  );
  assert.equal(revoked.status, 404);
  const cancelled = await resolveCustomerGalleryAccess(
    fakeClient({
      link: { status: 'active', gallery: { id: 'g1', tourEventId: 't1' } },
      customerTour: { id: 't1', status: 'cancelled' },
    }),
    { token: 'ctok' },
  );
  assert.equal(cancelled.status, 404);
});

test('gallery-level customerUploadEnabled=false blocks customer uploads', async () => {
  const res = await resolveCustomerGalleryAccess(
    fakeClient({
      link: { status: 'active', gallery: { id: 'g1', tourEventId: 't1', customerUploadEnabled: false } },
      customerTour: { id: 't1', status: 'scheduled', product: null, bookings: [] },
    }),
    { token: 'ctok' },
  );
  assert.equal(res.ok, true);
  assert.equal(res.permissions.canUpload, false);
});

test('customer uploads are attributed "לקוח"; a customer link never carries a guide identity', async () => {
  const res = await resolveCustomerGalleryAccess(
    fakeClient({
      link: { id: 'l1', status: 'active', gallery: { id: 'g1', tourEventId: 't1', customerUploadEnabled: true } },
      customerTour: { id: 't1', status: 'scheduled', product: null, bookings: [] },
    }),
    { token: 'ctok' },
  );
  assert.deepEqual(res.uploader, { type: 'customer', linkId: 'l1', label: 'לקוח' });
});

// ---------- staff (guide) upload link — the /g/:token capability the summary
// reminders carry ----------

const STAFF_LINK = {
  id: 'sl1',
  status: 'active',
  audience: 'staff',
  personRefId: 'p1',
  gallery: { id: 'g1', tourEventId: 't1', customerUploadEnabled: false },
};

test('a staff link uploads as the GUIDE, ignoring the customer upload switch', async () => {
  const res = await resolveCustomerGalleryAccess(
    fakeClient({
      link: STAFF_LINK,
      person: GUIDE,
      assignment: { id: 'a1' },
      customerTour: { id: 't1', status: 'scheduled', product: null, bookings: [] },
    }),
    { token: 'stok' },
  );
  assert.equal(res.ok, true);
  // customerUploadEnabled=false above — upload is the staff link's purpose.
  assert.equal(res.permissions.canUpload, true);
  assert.equal(res.permissions.canDelete, false);
  assert.deepEqual(res.uploader, { type: 'guide', personRefId: 'p1', linkId: 'sl1', label: 'דנה' });
});

test('a staff link dies (generic 404) when the guide is unassigned, blocked, or the gallery is off', async () => {
  const base = {
    link: STAFF_LINK,
    person: GUIDE,
    assignment: { id: 'a1' },
    customerTour: { id: 't1', status: 'scheduled', product: null, bookings: [] },
  };
  const unassigned = await resolveCustomerGalleryAccess(
    fakeClient({ ...base, assignment: null }), { token: 'stok' },
  );
  assert.deepEqual(unassigned, { ok: false, status: 404, error: 'not_found' });
  const blocked = await resolveCustomerGalleryAccess(
    fakeClient({ ...base, person: { ...GUIDE, status: 'blocked' } }), { token: 'stok' },
  );
  assert.equal(blocked.status, 404, 'blocked reads as unknown — no enumeration');
  const portalOff = await resolveCustomerGalleryAccess(
    fakeClient({ ...base, person: { ...GUIDE, portalEnabled: false } }), { token: 'stok' },
  );
  assert.equal(portalOff.status, 404);
  const galleryOff = await resolveCustomerGalleryAccess(
    fakeClient({ ...base, portalSettings: { useTourGallery: false } }), { token: 'stok' },
  );
  assert.equal(galleryOff.status, 404);
  const cancelled = await resolveCustomerGalleryAccess(
    fakeClient({ ...base, customerTour: { id: 't1', status: 'cancelled' } }), { token: 'stok' },
  );
  assert.equal(cancelled.status, 404);
});
