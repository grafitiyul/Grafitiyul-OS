import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXTERNAL_PERMISSIONS,
  GALLERY_STATUS,
  LINK_STATUS,
  createGallery,
  externalPermissions,
  galleryDefaultLanguage,
  galleryPublicText,
  rotateGalleryLink,
  setGalleryArchived,
  setGalleryLinkEnabled,
  updateGallery,
} from './galleries.js';

// ── Public text ─────────────────────────────────────────────────────────────

test('a standalone gallery shows its own bilingual text', () => {
  const g = {
    tourEventId: null,
    titleHe: 'תמונות מהסדנה',
    titleEn: 'Workshop Photos',
    subtitleHe: 'יולי 2026',
    subtitleEn: 'July 2026',
  };
  assert.deepEqual(galleryPublicText(g, { lang: 'he' }), {
    title: 'תמונות מהסדנה',
    subtitle: 'יולי 2026',
  });
  assert.deepEqual(galleryPublicText(g, { lang: 'en' }), {
    title: 'Workshop Photos',
    subtitle: 'July 2026',
  });
});

test('a gallery titled in one language still reads as itself in the other', () => {
  const g = { tourEventId: null, titleHe: 'תמונות מהסדנה', titleEn: null };
  // Falling back across languages beats going anonymous.
  assert.equal(galleryPublicText(g, { lang: 'en' }).title, 'תמונות מהסדנה');
});

test('the operator label NEVER leaks to a customer', () => {
  // internalName is the same class of internal wording as Deal.title. An
  // untitled gallery must show generic wording, never the operator's label.
  const g = { tourEventId: null, internalName: 'QA — בדיקה פנימית 2026', titleHe: null, titleEn: null };
  for (const lang of ['he', 'en']) {
    const { title } = galleryPublicText(g, { lang });
    assert.ok(!title.includes('QA'), `internalName leaked in ${lang}: ${title}`);
    assert.ok(!title.includes('בדיקה'), `internalName leaked in ${lang}: ${title}`);
  }
});

test('a tour gallery keeps its derived title and ignores any stored text', () => {
  const g = { tourEventId: 'tour1', titleHe: 'לא אמור להופיע' };
  const tour = { date: '2026-07-14', product: { nameHe: 'סיור גרפיטי' }, bookings: [] };
  const { title } = galleryPublicText(g, { lang: 'he', tour });
  assert.ok(title.includes('סיור גרפיטי'));
  assert.ok(!title.includes('לא אמור להופיע'));
});

test('default language normalises to he unless explicitly en', () => {
  assert.equal(galleryDefaultLanguage({ defaultLanguage: 'en' }), 'en');
  assert.equal(galleryDefaultLanguage({ defaultLanguage: 'EN' }), 'en');
  assert.equal(galleryDefaultLanguage({ defaultLanguage: null }), 'he');
  assert.equal(galleryDefaultLanguage({ defaultLanguage: 'klingon' }), 'he');
});

// ── Permissions ─────────────────────────────────────────────────────────────

test('a new gallery is view+download only — upload/delete/edit are opt-in', () => {
  assert.deepEqual(DEFAULT_EXTERNAL_PERMISSIONS, {
    extCanView: true,
    extCanDownload: true,
    extCanUpload: false,
    extCanDelete: false,
    extCanEdit: false,
  });
});

test('a tour gallery ignores the matrix and keeps its proven rules', () => {
  // Flipping extCanDelete on a tour gallery must NOT hand a customer a delete
  // button — tour galleries were designed so customers can never delete.
  const g = {
    tourEventId: 'tour1',
    customerUploadEnabled: true,
    extCanDelete: true,
    extCanEdit: true,
    extCanUpload: false,
  };
  const p = externalPermissions(g);
  assert.equal(p.extCanDelete, false);
  assert.equal(p.extCanEdit, false);
  assert.equal(p.extCanView, true);
  assert.equal(p.extCanDownload, true);
  // The tour gallery's own switch is the upload authority, not the matrix.
  assert.equal(p.extCanUpload, true);
});

test('archiving takes a gallery down without touching five switches', () => {
  const g = {
    tourEventId: null,
    status: GALLERY_STATUS.archived,
    extCanView: true,
    extCanDownload: true,
    extCanUpload: true,
    extCanDelete: true,
    extCanEdit: true,
  };
  assert.deepEqual(externalPermissions(g), {
    extCanView: false,
    extCanDownload: false,
    extCanUpload: false,
    extCanDelete: false,
    extCanEdit: false,
  });
});

// ── A minimal fake prisma for the stateful paths ────────────────────────────

function fakeDb({ galleries = [], links = [] } = {}) {
  const state = { galleries: [...galleries], links: [...links], audits: [] };
  const match = (row, where) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
      return row[k] === v;
    });
  return {
    state,
    tourGallery: {
      findUnique: async ({ where }) => state.galleries.find((g) => g.id === where.id) || null,
      create: async ({ data }) => {
        const row = { id: `g${state.galleries.length + 1}`, ...data };
        state.galleries.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const g = state.galleries.find((x) => x.id === where.id);
        Object.assign(g, data);
        return g;
      },
    },
    tourGalleryLink: {
      findFirst: async ({ where }) => state.links.find((l) => match(l, where)) || null,
      create: async ({ data }) => {
        const row = { id: `l${state.links.length + 1}`, ...data };
        state.links.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const hit = state.links.filter((l) => match(l, where));
        for (const l of hit) Object.assign(l, data);
        return { count: hit.length };
      },
    },
    galleryAudit: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };
}

test('a gallery must be named for the operator before it exists', async () => {
  const db = fakeDb();
  await assert.rejects(() => createGallery(db, { internalName: '   ' }), /internal_name_required/);
});

test('a tour gallery cannot be given a competing title', async () => {
  const db = fakeDb({ galleries: [{ id: 'g1', tourEventId: 'tour1' }] });
  await assert.rejects(
    () => updateGallery(db, 'g1', { titleHe: 'שם מתחרה' }),
    /tour_gallery_not_editable/,
  );
});

test('rotation kills the old token and mints a new one', async () => {
  const db = fakeDb({
    galleries: [{ id: 'g1', tourEventId: null }],
    links: [{ id: 'l1', galleryId: 'g1', audience: 'external', token: 'OLD', status: 'active' }],
  });
  const fresh = await rotateGalleryLink(db, 'g1', { actorId: 'admin1' });
  const old = db.state.links.find((l) => l.token === 'OLD');
  assert.equal(old.status, LINK_STATUS.revoked);
  assert.equal(old.revokedReason, 'rotated');
  assert.notEqual(fresh.token, 'OLD');
  assert.equal(fresh.status, undefined); // defaults to active at the DB layer
});

test('rotation never touches a guide staff link already sent in WhatsApp', async () => {
  const db = fakeDb({
    galleries: [{ id: 'g1', tourEventId: null }],
    links: [
      { id: 'l1', galleryId: 'g1', audience: 'external', token: 'OLD', status: 'active' },
      { id: 'l2', galleryId: 'g1', audience: 'staff', token: 'GUIDE', status: 'active' },
    ],
  });
  await rotateGalleryLink(db, 'g1', {});
  assert.equal(db.state.links.find((l) => l.token === 'GUIDE').status, 'active');
});

test('disable is reversible on the SAME url; rotation is not', async () => {
  const db = fakeDb({
    galleries: [{ id: 'g1', tourEventId: null }],
    links: [{ id: 'l1', galleryId: 'g1', audience: 'external', token: 'TOK', status: 'active' }],
  });
  await setGalleryLinkEnabled(db, 'g1', false, { actorId: 'admin1' });
  const link = db.state.links[0];
  assert.equal(link.status, LINK_STATUS.disabled);
  assert.ok(link.disabledAt);

  await setGalleryLinkEnabled(db, 'g1', true, { actorId: 'admin1' });
  assert.equal(link.status, LINK_STATUS.active);
  assert.equal(link.token, 'TOK', 'the shared URL survives a disable/enable cycle');
  assert.equal(link.disabledAt, null);
});

test('archiving disables links rather than revoking them, so it can be undone', async () => {
  const db = fakeDb({
    galleries: [{ id: 'g1', tourEventId: null, status: 'active' }],
    links: [{ id: 'l1', galleryId: 'g1', audience: 'external', token: 'TOK', status: 'active' }],
  });
  await setGalleryArchived(db, 'g1', true, { actorId: 'a1' });
  assert.equal(db.state.links[0].status, LINK_STATUS.disabled);
  assert.equal(db.state.links[0].token, 'TOK');

  await setGalleryArchived(db, 'g1', false, { actorId: 'a1' });
  assert.equal(db.state.links[0].status, LINK_STATUS.active);
  assert.equal(db.state.galleries[0].status, GALLERY_STATUS.active);
});

test('changing permissions is audited', async () => {
  const db = fakeDb({
    galleries: [{ id: 'g1', tourEventId: null, extCanUpload: false, extCanView: true }],
  });
  await updateGallery(db, 'g1', { permissions: { extCanUpload: true } }, { actorId: 'admin1' });
  const audit = db.state.audits.find((a) => a.action === 'permissions_changed');
  assert.ok(audit, 'a permission change leaves an audit record');
  assert.equal(audit.actorId, 'admin1');
});
