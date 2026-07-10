import test from 'node:test';
import assert from 'node:assert/strict';
import { processExportJob, requestExport, sweepExpiredExports } from './exports.js';

// Export job lifecycle: request/reuse rules, worker build (streams through
// the zipper into storage — the API process never buffers a gallery), expiry.

function fakeDb({
  mediaCount = 3,
  media = null,
  existingExport = null,
  tour = { id: 't1', status: 'scheduled' },
  lastChange = 0,
} = {}) {
  const state = { createdExports: [], exportUpdates: [], events: [] };
  const mediaRows =
    media ??
    Array.from({ length: mediaCount }, (_, i) => ({
      id: `m${i}`,
      objectKey: `tour-galleries/t1/originals/m${i}/f${i}.jpg`,
      originalFileName: `f${i}.jpg`,
      byteSize: 10n,
      capturedAt: null,
      completedAt: new Date(lastChange || '2026-07-01'),
      uploadStatus: 'ready',
      deletedAt: null,
    }));
  const db = {
    tourMedia: {
      count: async () => mediaRows.length,
      findMany: async () => mediaRows,
      findFirst: async ({ where, orderBy }) => {
        if (orderBy?.completedAt) {
          return mediaRows.length ? { completedAt: new Date(lastChange || '2026-07-01') } : null;
        }
        if (orderBy?.deletedAt) return null;
        return null;
      },
    },
    tourEvent: { findUnique: async () => tour },
    tourGalleryExport: {
      findFirst: async () => existingExport,
      create: async ({ data }) => {
        const job = { id: 'exp1', createdAt: new Date(), attempts: 0, ...data };
        state.createdExports.push(job);
        return job;
      },
      update: async (args) => {
        state.exportUpdates.push(args);
        return args;
      },
      updateMany: async () => ({ count: 1 }),
    },
    tourGallerySettings: {
      findUnique: async () => ({ id: 'singleton', archiveExpiryHours: 72 }),
      upsert: async () => ({ id: 'singleton', archiveExpiryHours: 72 }),
    },
    timelineEntry: {
      create: async ({ data }) => {
        state.events.push(data);
        return data;
      },
    },
  };
  return { db, state };
}

function fakeStorage() {
  const state = { uploaded: [], deleted: [] };
  return {
    state,
    isConfigured: () => true,
    getObjectStream: async (key) =>
      (async function* gen() {
        yield Buffer.from(`bytes-of-${key}`);
      })(),
    uploadStream: async ({ key, body }) => {
      let total = 0;
      for await (const chunk of body) total += chunk.length;
      state.uploaded.push({ key, total });
      return total;
    },
    deleteObject: async (key) => {
      state.deleted.push(key);
    },
  };
}

const GALLERY = { id: 'g1' };

test('request: empty gallery refused; new job created + timeline event otherwise', async () => {
  const empty = fakeDb({ mediaCount: 0 });
  const refused = await requestExport(empty.db, {
    tourEventId: 't1',
    gallery: GALLERY,
    requestedBy: { type: 'office' },
    origin: {},
  });
  assert.equal(refused.error, 'gallery_empty');

  const { db, state } = fakeDb({ mediaCount: 3 });
  const res = await requestExport(db, {
    tourEventId: 't1',
    gallery: GALLERY,
    requestedBy: { type: 'customer', linkId: 'l1' },
    origin: {},
  });
  assert.equal(res.reused, false);
  assert.equal(state.createdExports[0].requestedByType, 'customer');
  assert.equal(state.events[0].data.event, 'gallery_export_requested');
});

test('request: a fresh ready export is REUSED (no rebuild of gigabytes)', async () => {
  const { db, state } = fakeDb({
    lastChange: new Date('2026-07-01').getTime(),
    existingExport: {
      id: 'old',
      status: 'ready',
      createdAt: new Date('2026-07-02'),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const res = await requestExport(db, {
    tourEventId: 't1',
    gallery: GALLERY,
    requestedBy: { type: 'office' },
    origin: {},
  });
  assert.equal(res.reused, true);
  assert.equal(res.export.id, 'old');
  assert.equal(state.createdExports.length, 0);
});

test('request: gallery changed AFTER the ready export → a new job is queued', async () => {
  const { db, state } = fakeDb({
    lastChange: new Date('2026-07-05').getTime(),
    existingExport: {
      id: 'old',
      status: 'ready',
      createdAt: new Date('2026-07-02'),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const res = await requestExport(db, {
    tourEventId: 't1',
    gallery: GALLERY,
    requestedBy: { type: 'office' },
    origin: {},
  });
  assert.equal(res.reused, false);
  assert.equal(state.createdExports.length, 1);
});

test('worker: builds the archive under archives/<exportId>.zip and marks ready + expiry', async () => {
  const { db, state } = fakeDb({ mediaCount: 2 });
  const storage = fakeStorage();
  const job = { id: 'exp9', tourEventId: 't1', galleryId: 'g1', attempts: 0 };
  const result = await processExportJob({ db, storage, log: { warn: () => {} } }, job);
  assert.equal(result, 'ready');
  assert.equal(storage.state.uploaded.length, 1);
  assert.equal(storage.state.uploaded[0].key, 'tour-galleries/t1/archives/exp9.zip');
  assert.ok(storage.state.uploaded[0].total > 0, 'zip bytes streamed');
  const ready = state.exportUpdates.at(-1);
  assert.equal(ready.data.status, 'ready');
  assert.ok(ready.data.expiresAt > new Date());
  assert.ok(state.events.some((e) => e.data.event === 'gallery_export_completed'));
});

test('worker: cancelled tour fails the job instead of exporting deleted-soon media', async () => {
  const { db, state } = fakeDb({ tour: { id: 't1', status: 'cancelled' } });
  const storage = fakeStorage();
  const result = await processExportJob(
    { db, storage, log: { warn: () => {} } },
    { id: 'exp9', tourEventId: 't1', galleryId: 'g1', attempts: 0 },
  );
  assert.equal(result, 'failed');
  assert.equal(storage.state.uploaded.length, 0);
  assert.equal(state.exportUpdates.at(-1).data.error, 'tour_cancelled');
});

test('expiry sweep: ready-but-expired archives are deleted from R2 and marked expired', async () => {
  const { db, state } = fakeDb();
  db.tourGalleryExport.findMany = async () => [
    { id: 'e1', status: 'ready', archiveKey: 'tour-galleries/t1/archives/e1.zip' },
  ];
  const storage = fakeStorage();
  const swept = await sweepExpiredExports({ db, storage });
  assert.equal(swept, 1);
  assert.deepEqual(storage.state.deleted, ['tour-galleries/t1/archives/e1.zip']);
  assert.equal(state.exportUpdates.at(-1).data.status, 'expired');
});
