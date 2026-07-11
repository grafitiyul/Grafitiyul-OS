// Ops tool: end-to-end upload-engine verification against the REAL R2 bucket (run with
// production env via `railway run`). Uses the actual upload engine with an
// in-memory DB stub — production Postgres is never touched. Covers: initiate
// → presigned URLs → PUT (single + multipart parts) → complete (R2 ListParts
// assembly) → magic-byte verification → ready → cleanup.
import * as r2 from '../src/r2.js';
import {
  initiateUploadBatch,
  getUploadTargets,
  completeUpload,
  PART_SIZE,
} from '../src/tours/gallery/uploads.js';

const rows = new Map();
const db = {
  tourGallery: {
    findUnique: async () => ({ id: 'g-e2e', customerUploadEnabled: true }),
  },
  tourGallerySettings: {
    findUnique: async () => ({ id: 'singleton', customerUploadEnabled: true }),
    upsert: async () => ({ id: 'singleton', customerUploadEnabled: true }),
  },
  tourMedia: {
    create: async ({ data }) => {
      rows.set(data.id, { ...data, uploadStatus: 'pending', deletedAt: null });
      return rows.get(data.id);
    },
    update: async ({ where, data }) => Object.assign(rows.get(where.id), data),
    updateMany: async ({ where, data }) => {
      const m = rows.get(where.id);
      if (m && (!where.uploadStatus || m.uploadStatus === where.uploadStatus)) {
        Object.assign(m, data);
        return { count: 1 };
      }
      return { count: 0 };
    },
    findUnique: async ({ where }) => rows.get(where.id),
    delete: async ({ where }) => rows.delete(where.id),
    count: async () => 99, // suppress first-upload event path
  },
  timelineEntry: { create: async ({ data }) => data },
};

const TOUR = { id: 'e2etesttour0', status: 'scheduled' };

// A tiny real PNG (signature + IHDR fragment padded).
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000dIHDRfakepixels-for-e2e'),
]);
// 40MB "JPEG" (magic bytes + noise) → exercises the multipart plan (3 parts).
const bigSize = 40 * 1024 * 1024;
const big = Buffer.alloc(bigSize, 7);
big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[3] = 0xe0;

async function put(url, body, contentType) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body,
  });
  if (!res.ok) throw new Error(`PUT ${res.status}: ${await res.text()}`);
}

const init = await initiateUploadBatch(db, {
  tour: TOUR,
  uploader: { type: 'office', userId: null, label: 'e2e' },
  files: [
    { clientKey: 's', fileName: 'e2e-small.png', mimeType: 'image/png', byteSize: png.length },
    { clientKey: 'b', fileName: 'e2e-big.jpg', mimeType: 'image/jpeg', byteSize: bigSize },
  ],
});
console.log('initiate:', init.accepted.map((a) => `${a.fileName}→${a.plan}`).join(', '));

// 1. single-part
const small = init.accepted.find((a) => a.clientKey === 's');
const smallRow = rows.get(small.mediaId);
const t1 = await getUploadTargets(db, smallRow, {});
await put(t1.putUrl, png, 'image/png');
const done1 = await completeUpload(db, rows.get(small.mediaId), {}, { origin: {} });
if (done1.error) throw new Error('single-part complete failed: ' + done1.error);
console.log('single-part: READY, verified mime =', done1.media.mimeType, 'size =', Number(done1.media.byteSize));

// 2. multipart (3 real parts)
const bigA = init.accepted.find((a) => a.clientKey === 'b');
if (bigA.plan !== 'multipart' || bigA.partCount !== 3) throw new Error('unexpected plan');
const bigRow = rows.get(bigA.mediaId);
const t2 = await getUploadTargets(db, bigRow, { partNumbers: [1, 2, 3] });
for (const n of [1, 2, 3]) {
  const from = (n - 1) * PART_SIZE;
  await put(t2.partUrls[n], big.subarray(from, Math.min(from + PART_SIZE, bigSize)));
  console.log(`multipart: part ${n} uploaded`);
}
const done2 = await completeUpload(db, rows.get(bigA.mediaId), {}, { origin: {} });
if (done2.error) throw new Error('multipart complete failed: ' + done2.error);
console.log('multipart: READY, verified mime =', done2.media.mimeType, 'size =', Number(done2.media.byteSize), '(expected', bigSize, ')');

// 3. duplicate completion idempotency against the real bucket
const again = await completeUpload(db, rows.get(bigA.mediaId), {}, { origin: {} });
console.log('duplicate complete → alreadyReady:', !!again.alreadyReady);

// cleanup
const keys = await r2.listKeys('tour-galleries/e2etesttour0/');
await r2.deleteObjects(keys);
console.log('cleanup:', keys.length, 'objects deleted; prefix empty =', (await r2.listKeys('tour-galleries/e2etesttour0/')).length === 0);
console.log('\nE2E ENGINE VERIFICATION PASSED (server-side legs). Browser leg requires bucket CORS.');
