import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMediaInGallery,
  mayModifyMedia,
  requireCapability,
  resolvePublicGalleryAccess,
} from './access.js';

// A public capability surface. Every test here is a security boundary, not a
// behaviour preference.

function fakeDb({ link = null, media = [], galleryItems = [] } = {}) {
  return {
    tourGalleryLink: {
      findUnique: async ({ where }) => (link && link.token === where.token ? link : null),
    },
    tourMedia: {
      findFirst: async ({ where }) =>
        media.find((m) => m.id === where.id && (where.deletedAt !== null || !m.deletedAt)) || null,
    },
    galleryItem: {
      findUnique: async ({ where }) =>
        galleryItems.find(
          (g) =>
            g.galleryId === where.galleryId_mediaId.galleryId &&
            g.mediaId === where.galleryId_mediaId.mediaId,
        ) || null,
    },
  };
}

const activeGallery = {
  id: 'g1',
  tourEventId: null,
  status: 'active',
  extCanView: true,
  extCanDownload: true,
  extCanUpload: true,
  extCanDelete: true,
  extCanEdit: true,
};

// ── Token resolution ────────────────────────────────────────────────────────

test('an unknown token is 404', async () => {
  const db = fakeDb({ link: null });
  assert.deepEqual(await resolvePublicGalleryAccess(db, { token: 'nope' }), {
    ok: false,
    status: 404,
    error: 'not_found',
  });
});

test('an empty token never reaches the database', async () => {
  const db = fakeDb({ link: { token: '', gallery: activeGallery, status: 'active' } });
  const res = await resolvePublicGalleryAccess(db, { token: '' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('disabled, revoked and archived are all indistinguishable from unknown', async () => {
  // A capability surface must not confirm that a link once existed.
  const cases = [
    { label: 'disabled', link: { token: 'T', status: 'disabled', gallery: activeGallery } },
    { label: 'revoked', link: { token: 'T', status: 'revoked', gallery: activeGallery } },
    {
      label: 'archived',
      link: { token: 'T', status: 'active', gallery: { ...activeGallery, status: 'archived' } },
    },
  ];
  for (const c of cases) {
    const res = await resolvePublicGalleryAccess(fakeDb({ link: c.link }), { token: 'T' });
    assert.equal(res.ok, false, c.label);
    assert.equal(res.status, 404, `${c.label} must be 404, not 403`);
    assert.equal(res.error, 'not_found', c.label);
  }
});

test('a live link opens the gallery with server-resolved permissions', async () => {
  const db = fakeDb({ link: { id: 'l1', token: 'T', status: 'active', gallery: activeGallery } });
  const res = await resolvePublicGalleryAccess(db, { token: 'T' });
  assert.equal(res.ok, true);
  assert.equal(res.gallery.id, 'g1');
  assert.deepEqual(res.permissions, {
    canView: true,
    canDownload: true,
    canUpload: true,
    canDelete: true,
    canEdit: true,
  });
});

test('permissions come from the gallery, not from the request', async () => {
  const locked = { ...activeGallery, extCanUpload: false, extCanDelete: false, extCanEdit: false };
  const db = fakeDb({ link: { id: 'l1', token: 'T', status: 'active', gallery: locked } });
  const res = await resolvePublicGalleryAccess(db, { token: 'T' });
  assert.equal(res.permissions.canUpload, false);
  assert.equal(res.permissions.canDelete, false);
  assert.equal(res.permissions.canEdit, false);
});

// ── Capability enforcement ──────────────────────────────────────────────────

test('a refused capability is 403; a hidden gallery is 404', () => {
  const allowed = { ok: true, permissions: { canUpload: true, canDelete: false } };
  assert.equal(requireCapability(allowed, 'canUpload'), true);

  // Reached a real gallery but may not do this → 403.
  assert.throws(() => requireCapability(allowed, 'canDelete'), (e) => e.status === 403);
  // Never resolved a gallery at all → 404, so existence stays hidden.
  assert.throws(() => requireCapability({ ok: false }, 'canView'), (e) => e.status === 404);
});

// ── Cross-gallery boundary ──────────────────────────────────────────────────

test('a token for one gallery cannot touch another gallery\'s media', async () => {
  const db = fakeDb({
    media: [{ id: 'm1', galleryId: 'OTHER' }],
    galleryItems: [],
  });
  await assert.rejects(
    () => assertMediaInGallery(db, { galleryId: 'g1', mediaId: 'm1' }),
    (e) => e.status === 404,
  );
});

test('media curated into this gallery is reachable; unknown media is not', async () => {
  const db = fakeDb({
    media: [{ id: 'm1', galleryId: 'OTHER' }],
    galleryItems: [{ galleryId: 'g1', mediaId: 'm1' }],
  });
  const found = await assertMediaInGallery(db, { galleryId: 'g1', mediaId: 'm1' });
  assert.equal(found.id, 'm1');

  await assert.rejects(
    () => assertMediaInGallery(db, { galleryId: 'g1', mediaId: 'ghost' }),
    (e) => e.status === 404,
  );
});

// ── What "edit" and "delete" mean for an external visitor ───────────────────

test('a visitor may only modify what their OWN link uploaded', () => {
  const access = { ok: true, link: { id: 'l1' }, permissions: { canEdit: true, canDelete: true } };

  // Their own upload — allowed.
  assert.equal(
    mayModifyMedia(access, { uploadedByType: 'customer', uploadedByLinkId: 'l1' }),
    true,
  );
  // Another guest's upload, same gallery — refused.
  assert.equal(
    mayModifyMedia(access, { uploadedByType: 'customer', uploadedByLinkId: 'l2' }),
    false,
  );
  // The operator's own media — refused, however permissive the matrix is.
  assert.equal(mayModifyMedia(access, { uploadedByType: 'office', uploadedById: 'a1' }), false);
  // A guide's upload — refused.
  assert.equal(
    mayModifyMedia(access, { uploadedByType: 'guide', uploadedByPersonRefId: 'p1' }),
    false,
  );
});

test('no access means no modification, whatever media is passed', () => {
  assert.equal(mayModifyMedia({ ok: false }, { uploadedByType: 'customer', uploadedByLinkId: 'l1' }), false);
  assert.equal(mayModifyMedia(null, { uploadedByType: 'customer' }), false);
  assert.equal(mayModifyMedia({ ok: true, link: { id: 'l1' } }, null), false);
});
