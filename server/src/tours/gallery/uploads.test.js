import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTIPART_THRESHOLD,
  PART_SIZE,
  classifyUpload,
  completeUpload,
  deleteMediaBatch,
  initiateUploadBatch,
} from './uploads.js';
import { detectMime } from '../../media/detectMime.js';

// ---------- classification ----------

test('classify: images and videos accepted, junk rejected', () => {
  assert.equal(classifyUpload({ mimeType: 'image/jpeg', byteSize: 1000 }).mediaType, 'image');
  assert.equal(classifyUpload({ mimeType: 'video/quicktime', byteSize: 1000 }).mediaType, 'video');
  assert.equal(classifyUpload({ mimeType: 'image/heic', byteSize: 1000 }).mediaType, 'image');
  assert.equal(classifyUpload({ mimeType: 'application/pdf', byteSize: 1000 }).error, 'unsupported_type');
  assert.equal(classifyUpload({ mimeType: 'image/jpeg', byteSize: 0 }).error, 'invalid_size');
  assert.equal(
    classifyUpload({ mimeType: 'image/jpeg', byteSize: 200 * 1024 * 1024 }).error,
    'file_too_large',
  );
});

test('classify: multipart plan kicks in above the threshold with stable part math', () => {
  const small = classifyUpload({ mimeType: 'video/mp4', byteSize: MULTIPART_THRESHOLD });
  assert.equal(small.plan, 'single');
  const big = classifyUpload({ mimeType: 'video/mp4', byteSize: PART_SIZE * 10 + 5 });
  assert.equal(big.plan, 'multipart');
  assert.equal(big.partSize, PART_SIZE);
  assert.equal(big.partCount, 11);
});

// ---------- fakes ----------

function fakeDb({ galleryExists = true } = {}) {
  const state = { mediaRows: new Map(), events: [], coverClears: [] };
  const db = {
    tourGallery: {
      findUnique: async () => (galleryExists ? { id: 'g1', customerUploadEnabled: true } : null),
      create: async ({ data }) => ({ id: 'g1', ...data }),
      updateMany: async (args) => {
        state.coverClears.push(args);
        return { count: 0 };
      },
    },
    tourGallerySettings: {
      findUnique: async () => ({ id: 'singleton', customerUploadEnabled: true }),
      upsert: async () => ({ id: 'singleton', customerUploadEnabled: true }),
    },
    tourMedia: {
      create: async ({ data }) => {
        state.mediaRows.set(data.id, { ...data, uploadStatus: 'pending', deletedAt: null });
        return state.mediaRows.get(data.id);
      },
      findUnique: async ({ where }) => state.mediaRows.get(where.id) || null,
      findMany: async ({ where }) =>
        [...state.mediaRows.values()].filter(
          (m) => !where?.id?.in || where.id.in.includes(m.id),
        ),
      update: async ({ where, data }) => {
        Object.assign(state.mediaRows.get(where.id), data);
        return state.mediaRows.get(where.id);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const m of state.mediaRows.values()) {
          const idMatch = where.id?.in ? where.id.in.includes(m.id) : m.id === where.id;
          const statusMatch = !where.uploadStatus || m.uploadStatus === where.uploadStatus;
          if (idMatch && statusMatch) {
            Object.assign(m, data);
            count += 1;
          }
        }
        return { count };
      },
      delete: async ({ where }) => {
        state.mediaRows.delete(where.id);
      },
      count: async ({ where }) =>
        [...state.mediaRows.values()].filter((m) => {
          if (where.galleryId && m.galleryId !== where.galleryId) return false;
          if (where.batchId && m.batchId !== where.batchId) return false;
          if (where.uploadStatus && m.uploadStatus !== where.uploadStatus) return false;
          if (where.mediaType && m.mediaType !== where.mediaType) return false;
          if (where.deletedAt === null && m.deletedAt !== null) return false;
          return true;
        }).length,
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

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

function fakeStorage({ head = { size: 1234 }, range = JPEG_HEAD, parts = [] } = {}) {
  const state = { deleted: [], completed: [], aborted: [] };
  return {
    state,
    isConfigured: () => true,
    headObject: async () => head,
    getObjectRange: async () => range,
    listParts: async () => parts,
    completeMultipartUpload: async (args) => {
      state.completed.push(args);
    },
    abortMultipartUpload: async (args) => {
      state.aborted.push(args);
    },
    deleteObject: async (key) => {
      state.deleted.push(key);
    },
  };
}

const TOUR = { id: 'tour1', status: 'scheduled' };
const OFFICE = { type: 'office', userId: 'admin1', label: 'משרד' };

// ---------- initiate ----------

test('initiate: pending rows with id-based keys; same filename never collides', async () => {
  const { db, state } = fakeDb();
  const res = await initiateUploadBatch(db, {
    tour: TOUR,
    uploader: OFFICE,
    files: [
      { clientKey: 'a', fileName: 'IMG_0001.jpg', mimeType: 'image/jpeg', byteSize: 100 },
      { clientKey: 'b', fileName: 'IMG_0001.jpg', mimeType: 'image/jpeg', byteSize: 200 },
    ],
  });
  assert.equal(res.accepted.length, 2);
  const rows = [...state.mediaRows.values()];
  assert.notEqual(rows[0].objectKey, rows[1].objectKey);
  for (const r of rows) {
    assert.ok(r.objectKey.startsWith('tour-galleries/tour1/originals/'));
    assert.equal(r.uploadStatus, 'pending');
    assert.equal(r.batchId, res.batchId);
    assert.equal(r.uploadedByType, 'office');
  }
});

test('initiate: unsupported files land in rejected[], the rest proceed', async () => {
  const { db } = fakeDb();
  const res = await initiateUploadBatch(db, {
    tour: TOUR,
    uploader: OFFICE,
    files: [
      { clientKey: 'ok', fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 },
      { clientKey: 'bad', fileName: 'x.exe', mimeType: 'application/x-msdownload', byteSize: 10 },
    ],
  });
  assert.equal(res.accepted.length, 1);
  assert.deepEqual(res.rejected, [{ fileName: 'x.exe', clientKey: 'bad', error: 'unsupported_type' }]);
});

test('initiate: cancelled tours reject new uploads', async () => {
  const { db } = fakeDb();
  const res = await initiateUploadBatch(db, {
    tour: { id: 'tour1', status: 'cancelled' },
    uploader: OFFICE,
    files: [{ fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 }],
  });
  assert.equal(res.error, 'tour_cancelled');
});

// ---------- complete ----------

async function initiateOne(db, file) {
  const res = await initiateUploadBatch(db, { tour: TOUR, uploader: OFFICE, files: [file] });
  return res.accepted[0].mediaId;
}

test('complete: verifies magic bytes + size, flips to ready, emits first-upload event', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage({ head: { size: 5555 }, range: JPEG_HEAD });
  const id = await initiateOne(db, { fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 100 });
  const media = state.mediaRows.get(id);
  const res = await completeUpload(db, media, { width: 100, height: 50 }, { storage, origin: {} });
  assert.equal(res.media.uploadStatus, 'ready');
  assert.equal(res.media.byteSize, 5555n, 'size comes from R2 head, not the client claim');
  assert.ok(state.events.some((e) => e.data.event === 'gallery_first_upload'));
  assert.ok(state.events.some((e) => e.data.event === 'gallery_batch_uploaded'));
});

test('complete: duplicate completion is idempotent (no second event)', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage();
  const id = await initiateOne(db, { fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 100 });
  await completeUpload(db, state.mediaRows.get(id), {}, { storage, origin: {} });
  const eventsAfterFirst = state.events.length;
  const again = await completeUpload(db, state.mediaRows.get(id), {}, { storage, origin: {} });
  assert.equal(again.alreadyReady, true);
  assert.equal(state.events.length, eventsAfterFirst);
});

test('complete: mislabeled content (video bytes as image) deletes object AND row', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage({ range: MP4_HEAD });
  const id = await initiateOne(db, { fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 100 });
  const res = await completeUpload(db, state.mediaRows.get(id), {}, { storage, origin: {} });
  assert.equal(res.error, 'invalid_content');
  assert.equal(res.status, 422);
  assert.equal(state.mediaRows.size, 0, 'row removed');
  assert.equal(storage.state.deleted.length, 1, 'object removed');
});

test('complete: missing object is recoverable — row survives, 409', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage({ head: null });
  const id = await initiateOne(db, { fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 100 });
  const res = await completeUpload(db, state.mediaRows.get(id), {}, { storage, origin: {} });
  assert.equal(res.error, 'object_missing');
  assert.equal(state.mediaRows.get(id).uploadStatus, 'pending');
});

test('complete: multipart assembles from R2 part list (client etags never used)', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage({
    head: { size: PART_SIZE * 3 },
    range: MP4_HEAD,
    parts: [
      { partNumber: 2, etag: 'e2', size: PART_SIZE },
      { partNumber: 1, etag: 'e1', size: PART_SIZE },
      { partNumber: 3, etag: 'e3', size: PART_SIZE },
    ],
  });
  const id = await initiateOne(db, {
    fileName: 'v.mp4',
    mimeType: 'video/mp4',
    byteSize: PART_SIZE * 3,
  });
  state.mediaRows.get(id).uploadId = 'up1';
  const res = await completeUpload(db, state.mediaRows.get(id), {}, { storage, origin: {} });
  assert.equal(res.media.uploadStatus, 'ready');
  assert.equal(storage.state.completed.length, 1);
  assert.deepEqual(
    storage.state.completed[0].parts.map((p) => p.partNumber),
    [2, 1, 3],
    'r2 list passed through; sorting happens in the r2 helper',
  );
});

test('complete: batch event fires only when the LAST file of the batch resolves', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage();
  const res = await initiateUploadBatch(db, {
    tour: TOUR,
    uploader: OFFICE,
    files: [
      { clientKey: 'a', fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 },
      { clientKey: 'b', fileName: 'b.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    ],
  });
  const [m1, m2] = res.accepted.map((a) => a.mediaId);
  await completeUpload(db, state.mediaRows.get(m1), {}, { storage, origin: {} });
  assert.ok(!state.events.some((e) => e.data.event === 'gallery_batch_uploaded'));
  await completeUpload(db, state.mediaRows.get(m2), {}, { storage, origin: {} });
  const batchEvents = state.events.filter((e) => e.data.event === 'gallery_batch_uploaded');
  assert.equal(batchEvents.length, 1);
  assert.equal(batchEvents[0].data.images, 2);
});

// ---------- delete ----------

test('bulk delete: soft-deletes rows, removes objects, clears cover, ONE event', async () => {
  const { db, state } = fakeDb();
  const storage = fakeStorage();
  const res = await initiateUploadBatch(db, {
    tour: TOUR,
    uploader: OFFICE,
    files: [
      { clientKey: 'a', fileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 },
      { clientKey: 'b', fileName: 'b.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    ],
  });
  for (const a of res.accepted) {
    await completeUpload(db, state.mediaRows.get(a.mediaId), {}, { storage, origin: {} });
  }
  const before = state.events.length;
  const del = await deleteMediaBatch(
    db,
    {
      tourEventId: 'tour1',
      ids: res.accepted.map((a) => a.mediaId),
      deletedById: 'admin1',
      deletedByLabel: 'משרד',
      origin: {},
    },
    { storage },
  );
  assert.equal(del.deleted, 2);
  for (const a of res.accepted) {
    assert.ok(state.mediaRows.get(a.mediaId).deletedAt, 'soft-deleted, row kept for audit');
  }
  assert.ok(storage.state.deleted.length >= 2, 'objects removed from R2');
  assert.equal(state.coverClears.length, 1);
  assert.equal(state.events.length - before, 1, 'one batch event, not one per photo');
});

// ---------- sniffer ----------

test('detectMime: HEIC/AVIF brands are stills, not mp4', () => {
  const heic = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  assert.equal(detectMime(heic), 'image/heic');
  const avif = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
  assert.equal(detectMime(avif), 'image/avif');
  assert.equal(detectMime(MP4_HEAD), 'video/mp4');
});
