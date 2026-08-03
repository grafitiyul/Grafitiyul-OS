import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureGuideGalleryLink, guideGalleryUploadUrl } from './links.js';
import { getActiveGalleryLink } from './service.js';

// The guide upload link is a capability: minted once per (tour, guide),
// reused by every later reminder and by the review card, invisible to the
// customer-share surfaces, and never resurrected on a cancelled tour.

process.env.PUBLIC_ORIGIN = 'https://app.example';

const matches = (row, where) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

function fakeDb({ tourStatus = 'scheduled', useTourGallery = true } = {}) {
  const links = [];
  let seq = 0;
  return {
    links,
    tourEvent: {
      findUnique: async ({ where }) =>
        tourStatus == null ? null : { id: where.id, status: tourStatus },
    },
    tourGallery: {
      findUnique: async () => ({ id: 'g1', tourEventId: 't1', customerUploadEnabled: true }),
    },
    guidePortalSettings: {
      findUnique: async () => ({ id: 'singleton', useTourGallery }),
      upsert: async () => ({ id: 'singleton', useTourGallery }),
    },
    tourGalleryLink: {
      findFirst: async ({ where }) => links.find((l) => matches(l, where)) || null,
      create: async ({ data }) => {
        const row = { id: `l${(seq += 1)}`, status: 'active', token: data.token, ...data };
        links.push(row);
        return row;
      },
    },
  };
}

test('minted once per (tour, guide) and reused forever after', async () => {
  const db = fakeDb();
  const a = await ensureGuideGalleryLink(db, { tourEventId: 't1', personRefId: 'p1' });
  const b = await ensureGuideGalleryLink(db, { tourEventId: 't1', personRefId: 'p1' });
  assert.equal(a.token, b.token, 'the reminder retry reuses the sent link');
  const other = await ensureGuideGalleryLink(db, { tourEventId: 't1', personRefId: 'p2' });
  assert.notEqual(other.token, a.token, 'each guide gets their own capability');
  assert.equal(db.links.length, 2);
});

test('never re-arms a link on a cancelled tour', async () => {
  const cancelled = await ensureGuideGalleryLink(fakeDb({ tourStatus: 'cancelled' }), {
    tourEventId: 't1',
    personRefId: 'p1',
  });
  assert.equal(cancelled, null);
  const gone = await ensureGuideGalleryLink(fakeDb({ tourStatus: null }), {
    tourEventId: 't1',
    personRefId: 'p1',
  });
  assert.equal(gone, null);
});

test('guideGalleryUploadUrl builds /g/<token>, and yields null instead of a dead link', async () => {
  const db = fakeDb();
  const url = await guideGalleryUploadUrl(db, { tourEventId: 't1', personRefId: 'p1' });
  assert.match(url, /^https:\/\/app\.example\/g\/[A-Za-z0-9_-]+$/);
  // Gallery switched off for guides → the message omits the section.
  assert.equal(
    await guideGalleryUploadUrl(fakeDb({ useTourGallery: false }), { tourEventId: 't1', personRefId: 'p1' }),
    null,
  );
  // No PersonRef (imported guide) → no capability to mint.
  assert.equal(await guideGalleryUploadUrl(db, { tourEventId: 't1', personRefId: null }), null);
  // Any failure is swallowed into null — a link must never break a reminder.
  const broken = { ...db, tourEvent: { findUnique: async () => { throw new Error('boom'); } } };
  assert.equal(
    await guideGalleryUploadUrl(broken, { tourEventId: 't1', personRefId: 'p1' }, { log: { warn: () => {} } }),
    null,
  );
});

test('staff links are invisible to the customer-share surface', async () => {
  const db = fakeDb();
  await ensureGuideGalleryLink(db, { tourEventId: 't1', personRefId: 'p1' });
  // getActiveGalleryLink is what the portal share UI and the admin workspace
  // read — a guide capability must never surface there.
  assert.equal(await getActiveGalleryLink(db, 'g1'), null);
});
