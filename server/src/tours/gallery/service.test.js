import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GALLERY_TITLE_BOOKINGS_INCLUDE,
  GENERIC_GALLERY_TITLE_HE,
  buildGalleryTitle,
  galleryCustomerLabel,
  newGalleryToken,
  scheduleGalleryCleanup,
} from './service.js';

// ---------- display title (dynamic — never part of storage keys) ----------

test('title: product · date · organization for a business tour', () => {
  const t = buildGalleryTitle({
    kind: 'business',
    date: '2026-07-14',
    product: { nameHe: 'סיור גרפיטי' },
    bookings: [
      { status: 'active', deal: { title: 'דיל', organization: { name: 'חברת ABC' } } },
    ],
  });
  assert.equal(t, 'סיור גרפיטי · 14.07.2026 · חברת ABC');
});

// PRIVACY REGRESSION GUARD — Deal.title is internal CRM wording ("ליד חדש -
// …") and must NEVER appear on a customer-facing gallery. The canonical
// resolution is organization → ordering contact full name → generic fallback.

test('privacy: organization name wins; internal Deal.title never renders', () => {
  const tour = {
    kind: 'business',
    date: '2026-07-14',
    product: { nameHe: 'סיור גרפיטי' },
    bookings: [
      {
        status: 'active',
        deal: {
          title: 'ליד חדש - לילי',
          organization: { name: 'עיריית תל אביב' },
          contacts: [{ contact: { firstNameHe: 'לילי', lastNameHe: 'כהן' } }],
        },
      },
    ],
  };
  const t = buildGalleryTitle(tour);
  assert.equal(t, 'סיור גרפיטי · 14.07.2026 · עיריית תל אביב');
  assert.ok(!t.includes('ליד חדש'));
  assert.equal(galleryCustomerLabel(tour), 'עיריית תל אביב');
});

test('privacy: no organization → ordering contact full name, not Deal.title', () => {
  const t = buildGalleryTitle({
    kind: 'private',
    date: '2026-01-02',
    product: { nameHe: 'סדנת גרפיטי' },
    bookings: [
      {
        status: 'active',
        deal: {
          title: 'ליד חדש - לילי',
          organization: null,
          contacts: [{ contact: { firstNameHe: 'לילי', lastNameHe: 'לוי' } }],
        },
      },
    ],
  });
  assert.equal(t, 'סדנת גרפיטי · 02.01.2026 · לילי לוי');
  assert.ok(!t.includes('ליד חדש'));
});

test('privacy: contact falls back to English name; no names at all → title stays safe', () => {
  const en = galleryCustomerLabel({
    kind: 'private',
    bookings: [
      {
        status: 'active',
        deal: { title: 'ליד חדש', contacts: [{ contact: { firstNameEn: 'John', lastNameEn: 'Doe' } }] },
      },
    ],
  });
  assert.equal(en, 'John Doe');
  const bare = buildGalleryTitle({
    kind: 'private',
    date: '2026-01-02',
    product: { nameHe: 'סדנה' },
    bookings: [{ status: 'active', deal: { title: 'ליד חדש - לילי', contacts: [] } }],
  });
  assert.equal(bare, 'סדנה · 02.01.2026');
  assert.ok(!bare.includes('ליד'));
});

test('privacy: nothing resolvable at all → generic fallback', () => {
  assert.equal(buildGalleryTitle(null), GENERIC_GALLERY_TITLE_HE);
  assert.equal(
    buildGalleryTitle({ kind: 'private', date: 'bad', product: null, bookings: [] }),
    GENERIC_GALLERY_TITLE_HE,
  );
});

test('privacy: the shared bookings include never selects Deal.title', () => {
  // Structural guard: the customer route can only leak what it fetches — the
  // canonical include must not select the deal title (or any other field
  // beyond organization name + contact names).
  const dealSelect = GALLERY_TITLE_BOOKINGS_INCLUDE.select.deal.select;
  assert.equal('title' in dealSelect, false);
  assert.deepEqual(Object.keys(dealSelect).sort(), ['contacts', 'organization']);
});

test('title: group slot with several active bookings shows קבוצתי, not one customer', () => {
  const tour = {
    kind: 'group_slot',
    date: '2026-03-05',
    product: { nameHe: 'סיור' },
    bookings: [
      { status: 'active', deal: { title: 'א', organization: { name: 'ארגון א' } } },
      { status: 'active', deal: { title: 'ב', contacts: [{ contact: { firstNameHe: 'ב' } }] } },
    ],
  };
  assert.equal(buildGalleryTitle(tour), 'סיור · 05.03.2026 · סיור קבוצתי');
  // One shared group gallery never surfaces a single customer's identity.
  assert.equal(galleryCustomerLabel(tour), 'סיור קבוצתי');
});

test('title: group slot with ONE active booking shows THAT customer (org → contact)', () => {
  const t = buildGalleryTitle({
    kind: 'group_slot',
    date: '2026-03-05',
    product: { nameHe: 'סיור' },
    bookings: [
      {
        status: 'active',
        deal: { title: 'ליד חדש - לילי', contacts: [{ contact: { firstNameHe: 'לילי', lastNameHe: 'כהן' } }] },
      },
      { status: 'cancelled', deal: { title: 'אחר', organization: { name: 'ארגון אחר' } } },
    ],
  });
  assert.equal(t, 'סיור · 05.03.2026 · לילי כהן');
});

test('title: cancelled bookings are ignored; missing parts are dropped', () => {
  const t = buildGalleryTitle({
    kind: 'private',
    date: '2026-07-14',
    product: null,
    bookings: [{ status: 'cancelled', deal: { title: 'ישן' } }],
  });
  assert.equal(t, 'סיור · 14.07.2026');
});

test('title changes when tour data changes — same media, same keys, new title', () => {
  const base = {
    kind: 'business',
    date: '2026-07-14',
    product: { nameHe: 'סיור גרפיטי' },
    bookings: [],
  };
  const before = buildGalleryTitle(base);
  const after = buildGalleryTitle({ ...base, date: '2026-08-20', product: { nameHe: 'סדנה' } });
  assert.notEqual(before, after);
  assert.equal(after, 'סדנה · 20.08.2026');
});

// ---------- tokens ----------

test('gallery tokens are high-entropy base64url (project convention)', () => {
  const t = newGalleryToken();
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(newGalleryToken(), newGalleryToken());
});

// ---------- cancellation cleanup scheduling ----------

function fakeClient({ gallery, mediaCount, liveCount, existingTask } = {}) {
  const state = {
    revoked: [],
    createdTasks: [],
    events: [],
    issues: [],
  };
  const client = {
    tourGallery: {
      findUnique: async () => gallery ?? null,
    },
    tourGalleryLink: {
      updateMany: async (args) => {
        state.revoked.push(args);
        return { count: 2 };
      },
    },
    tourMedia: {
      // The service counts ALL rows first, then LIVE (ready, undeleted) rows.
      count: async ({ where }) =>
        where?.uploadStatus === 'ready' ? (liveCount ?? mediaCount ?? 0) : (mediaCount ?? 0),
    },
    tourGalleryCleanupTask: {
      findFirst: async () => existingTask ?? null,
      create: async ({ data }) => {
        const task = { id: 'task1', ...data };
        state.createdTasks.push(task);
        return task;
      },
    },
    tourEvent: {
      findUnique: async () => null,
    },
    operationalIssue: {
      findFirst: async () => null,
      create: async ({ data }) => {
        state.issues.push(data);
        return { id: 'issue1', ...data };
      },
    },
    timelineEntry: {
      create: async ({ data }) => {
        state.events.push(data);
        return data;
      },
    },
  };
  return { client, state };
}

test('cancel with media: revokes links, creates ONE cleanup task, emits event', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 5 });
  const res = await scheduleGalleryCleanup(client, 'tour1', {
    reason: 'tour_cancelled',
    origin: { actorType: 'system', actorLabel: 'מערכת', createdBy: null, createdByName: null },
  });
  assert.equal(state.revoked.length, 1);
  assert.equal(state.createdTasks.length, 1);
  assert.equal(state.createdTasks[0].prefix, 'tour-galleries/tour1/');
  assert.ok(state.createdTasks[0].notBefore > new Date(), 'grace window applies to cancels');
  // SAFETY INVARIANT: live media → the task parks for approval + issue raised.
  assert.equal(state.createdTasks[0].status, 'awaiting_approval');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].data.event, 'gallery_cleanup_awaiting_approval');
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].type, 'gallery_cleanup_approval');
  assert.equal(state.issues[0].dedupeKey, 'gallery_cleanup_approval:tour1');
  assert.equal(res.revokedLinks, 2);
});

test('cancel with only leftover rows (no LIVE media): auto pending task, no issue', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 3, liveCount: 0 });
  await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_cancelled', origin: {} });
  assert.equal(state.createdTasks.length, 1);
  assert.equal(state.createdTasks[0].status, 'pending');
  assert.equal(state.events[0].data.event, 'gallery_cleanup_scheduled');
  assert.equal(state.issues.length, 0);
});

test('repeated cancel is idempotent — existing pending task, no duplicate', async () => {
  const { client, state } = fakeClient({
    gallery: { id: 'g1' },
    mediaCount: 5,
    existingTask: { id: 'taskOld', status: 'pending' },
  });
  const res = await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_cancelled', origin: {} });
  assert.equal(state.createdTasks.length, 0);
  assert.equal(state.events.length, 0);
  assert.equal(res.task.id, 'taskOld');
});

test('cancel with an untouched gallery is a no-op (nothing in R2 either)', async () => {
  const { client, state } = fakeClient({ gallery: null });
  const res = await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_cancelled', origin: {} });
  assert.equal(res, null);
  assert.equal(state.revoked.length, 0);
  assert.equal(state.createdTasks.length, 0);
});

test('empty gallery (no media ever): links revoked but no purge task', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 0 });
  const res = await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_cancelled', origin: {} });
  assert.equal(state.revoked.length, 1);
  assert.equal(state.createdTasks.length, 0);
  assert.equal(res.task, null);
});

test('tour deletion with only leftover rows purges immediately (no grace window)', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 3, liveCount: 0 });
  await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_deleted', origin: {} });
  assert.equal(state.createdTasks.length, 1);
  assert.equal(state.createdTasks[0].status, 'pending');
  assert.ok(state.createdTasks[0].notBefore <= new Date());
});

test('tour deletion with LIVE media still parks for approval (defence in depth)', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 3, liveCount: 3 });
  await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_deleted', origin: {} });
  assert.equal(state.createdTasks[0].status, 'awaiting_approval');
  assert.equal(state.issues.length, 1);
});
