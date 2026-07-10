import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGalleryTitle,
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

test('title: falls back to deal title when no organization', () => {
  const t = buildGalleryTitle({
    kind: 'private',
    date: '2026-01-02',
    product: { nameHe: 'סדנת גרפיטי' },
    bookings: [{ status: 'active', deal: { title: 'משפחת לוי' } }],
  });
  assert.equal(t, 'סדנת גרפיטי · 02.01.2026 · משפחת לוי');
});

test('title: group slot with several active bookings shows קבוצתי, not one customer', () => {
  const t = buildGalleryTitle({
    kind: 'group_slot',
    date: '2026-03-05',
    product: { nameHe: 'סיור' },
    bookings: [
      { status: 'active', deal: { title: 'א' } },
      { status: 'active', deal: { title: 'ב' } },
    ],
  });
  assert.equal(t, 'סיור · 05.03.2026 · סיור קבוצתי');
});

test('title: cancelled bookings are ignored; missing parts are dropped', () => {
  const t = buildGalleryTitle({
    kind: 'private',
    date: '2026-07-14',
    product: null,
    bookings: [{ status: 'cancelled', deal: { title: 'ישן' } }],
  });
  assert.equal(t, 'סיור · 14.07.2026');
  assert.equal(buildGalleryTitle(null), 'גלריית סיור');
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

function fakeClient({ gallery, mediaCount, existingTask } = {}) {
  const state = {
    revoked: [],
    createdTasks: [],
    events: [],
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
      count: async () => mediaCount ?? 0,
    },
    tourGalleryCleanupTask: {
      findFirst: async () => existingTask ?? null,
      create: async ({ data }) => {
        const task = { id: 'task1', ...data };
        state.createdTasks.push(task);
        return task;
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
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].data.event, 'gallery_cleanup_scheduled');
  assert.equal(res.revokedLinks, 2);
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

test('tour deletion purges immediately (no grace window to revert to)', async () => {
  const { client, state } = fakeClient({ gallery: { id: 'g1' }, mediaCount: 3 });
  await scheduleGalleryCleanup(client, 'tour1', { reason: 'tour_deleted', origin: {} });
  assert.equal(state.createdTasks.length, 1);
  assert.ok(state.createdTasks[0].notBefore <= new Date());
});
