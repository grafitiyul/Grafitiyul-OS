import test from 'node:test';
import assert from 'node:assert/strict';
import { processCleanupTask, sweepAbandonedUploads } from './cleanupWorker.js';

function fakeDeps({ tour, listPages, listFails = false, multiparts = [], liveMedia = 0 } = {}) {
  const state = {
    claimedUpdates: [],
    taskUpdates: [],
    mediaUpdates: [],
    deletedKeys: [],
    abortedUploads: [],
    events: [],
    deletedMediaRows: [],
  };
  let listCall = 0;
  const db = {
    tourGalleryCleanupTask: {
      updateMany: async (args) => {
        state.claimedUpdates.push(args);
        return { count: 1 };
      },
      update: async (args) => {
        state.taskUpdates.push(args);
        return args;
      },
    },
    tourEvent: {
      findUnique: async () => tour ?? null,
    },
    tourMedia: {
      count: async () => liveMedia,
      updateMany: async (args) => {
        state.mediaUpdates.push(args);
        return { count: 1 };
      },
      findMany: async () => [],
      delete: async (args) => {
        state.deletedMediaRows.push(args);
        return args;
      },
    },
    timelineEntry: {
      create: async ({ data }) => {
        state.events.push(data);
        return data;
      },
    },
  };
  const storage = {
    isConfigured: () => true,
    listKeys: async () => {
      if (listFails) throw new Error('r2_down');
      const pages = listPages || [['a', 'b'], []];
      return pages[Math.min(listCall++, pages.length - 1)];
    },
    deleteObjects: async (keys) => {
      state.deletedKeys.push(...keys);
    },
    deleteObject: async (key) => {
      state.deletedKeys.push(key);
    },
    listMultipartUploads: async () => multiparts,
    abortMultipartUpload: async (u) => {
      state.abortedUploads.push(u);
    },
  };
  return { deps: { db, storage, log: { warn: () => {} } }, state };
}

const TASK = {
  id: 'task1',
  tourEventId: 'tour1',
  prefix: 'tour-galleries/tour1/',
  reason: 'tour_cancelled',
  attempts: 0,
};

test('happy path: aborts multiparts, deletes objects, verifies empty, marks done', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'cancelled' },
    listPages: [['k1', 'k2', 'k3'], []],
    multiparts: [{ key: 'k9', uploadId: 'u9' }],
  });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'done');
  assert.deepEqual(state.abortedUploads, [{ key: 'k9', uploadId: 'u9' }]);
  assert.deepEqual(state.deletedKeys, ['k1', 'k2', 'k3']);
  const doneUpdate = state.taskUpdates.at(-1);
  assert.equal(doneUpdate.data.status, 'done');
  assert.equal(doneUpdate.data.deletedObjects, 3);
  assert.equal(state.mediaUpdates.length, 1, 'media rows soft-deleted');
  assert.equal(state.events.at(-1).data.event, 'gallery_cleanup_completed');
});

test('re-run after done is safe: empty prefix → done again with zero objects', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'cancelled' },
    listPages: [[], []],
  });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'done');
  assert.equal(state.deletedKeys.length, 0);
});

test('tour un-cancelled inside the grace window → task skipped, nothing deleted', async () => {
  const { deps, state } = fakeDeps({ tour: { id: 'tour1', status: 'scheduled' } });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'skipped');
  assert.equal(state.deletedKeys.length, 0);
  assert.equal(state.taskUpdates.at(-1).data.status, 'skipped');
  assert.equal(state.events.at(-1).data.event, 'gallery_cleanup_skipped');
});

test('deleted tour (no row) with reason=tour_deleted still purges', async () => {
  const { deps, state } = fakeDeps({ tour: null, listPages: [['x'], []] });
  const result = await processCleanupTask(deps, { ...TASK, reason: 'tour_deleted' });
  assert.equal(result, 'done');
  assert.deepEqual(state.deletedKeys, ['x']);
});

test('partial failure is HONEST: objects remain → pending + lastError + backoff, never done', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'cancelled' },
    listPages: [['k1', 'k2'], ['k2']], // verify list still sees k2
  });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'failed');
  const update = state.taskUpdates.at(-1);
  assert.equal(update.data.status, 'pending');
  assert.match(update.data.lastError, /cleanup_incomplete/);
  assert.ok(update.data.notBefore > new Date(), 'retry is deferred (backoff)');
  assert.ok(!state.events.some((e) => e.data?.event === 'gallery_cleanup_completed'));
});

test('R2 outage: task stays pending with the error recorded', async () => {
  const { deps, state } = fakeDeps({ tour: { id: 'tour1', status: 'cancelled' }, listFails: true });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'failed');
  assert.match(state.taskUpdates.at(-1).data.lastError, /r2_down/);
});

// ── SAFETY INVARIANT (בקרה): live media never purges without approval ──────

test('unapproved task with LIVE media is demoted to awaiting_approval — nothing deleted', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'cancelled' },
    listPages: [['k1'], []],
    liveMedia: 4,
  });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'awaiting_approval');
  assert.equal(state.deletedKeys.length, 0, 'no R2 object touched');
  assert.equal(state.mediaUpdates.length, 0, 'no media row touched');
  const update = state.taskUpdates.at(-1);
  assert.equal(update.data.status, 'awaiting_approval');
});

test('APPROVED task with live media purges (explicit admin approval)', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'cancelled' },
    listPages: [['k1', 'k2'], []],
    liveMedia: 4,
  });
  const result = await processCleanupTask(deps, { ...TASK, approvedAt: new Date() });
  assert.equal(result, 'done');
  assert.deepEqual(state.deletedKeys, ['k1', 'k2']);
});

test('un-cancelled tour wins over the media gate — task skipped, media stays', async () => {
  const { deps, state } = fakeDeps({
    tour: { id: 'tour1', status: 'scheduled' },
    liveMedia: 4,
  });
  const result = await processCleanupTask(deps, TASK);
  assert.equal(result, 'skipped');
  assert.equal(state.deletedKeys.length, 0);
});

test('abandoned pending uploads: multipart aborted, objects removed, row deleted', async () => {
  const { deps, state } = fakeDeps({});
  deps.db.tourMedia.findMany = async () => [
    {
      id: 'm1',
      objectKey: 'tour-galleries/t/originals/m1/a.mp4',
      thumbKey: 'tour-galleries/t/thumbs/m1.webp',
      posterKey: null,
      uploadId: 'up1',
      uploadStatus: 'pending',
    },
  ];
  const swept = await sweepAbandonedUploads(deps);
  assert.equal(swept, 1);
  assert.deepEqual(state.abortedUploads, [
    { key: 'tour-galleries/t/originals/m1/a.mp4', uploadId: 'up1' },
  ]);
  assert.ok(state.deletedKeys.includes('tour-galleries/t/originals/m1/a.mp4'));
  assert.ok(state.deletedKeys.includes('tour-galleries/t/thumbs/m1.webp'));
  assert.equal(state.deletedMediaRows.length, 1);
});
