import crypto from 'node:crypto';
import * as r2 from '../../r2.js';
import { detectMime, kindOfMime } from '../../media/detectMime.js';
import { emitTimelineEvent } from '../../timeline/events.js';
import { ensureGallery } from './service.js';
import { originalKey, posterKey, thumbKey } from './keys.js';

// Direct-to-R2 upload engine for Tour Gallery. The GOS server never carries
// media bytes — it authorizes, records metadata, and verifies. Flow per file:
//   1. initiateUploadBatch — validate metadata, create pending TourMedia rows
//      with stable object keys (id-based; collision-free by construction).
//   2. getUploadTargets — fresh presigned URLs ON DEMAND (a big mobile batch
//      outlives any single URL's expiry, so URLs are minted per file when the
//      client queue reaches it). Single PUT for small files; multipart parts
//      for large ones. Thumb/poster PUT URLs ride along (client-generated
//      derivatives — no server-side image pipeline exists by design).
//   3. completeUpload — completes multipart from R2's OWN part list (client
//      ETags never trusted/needed), verifies existence + size + magic bytes,
//      then flips the row to 'ready'. Media is never 'ready' unverified.
// Abandoned pending rows are swept by the cleanup worker.

export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
]);
export const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
]);

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // 100MB — generous for any camera still
export const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024; // 8GB safety ceiling
export const MULTIPART_THRESHOLD = 32 * 1024 * 1024; // files above this use multipart
export const PART_SIZE = 16 * 1024 * 1024; // fixed at initiate — part numbers stay stable
export const MAX_PART_URLS_PER_CALL = 20;
export const MAX_FILES_PER_INITIATE = 500; // request-size bound, not a UX limit — the client chunks

export function newMediaId() {
  return crypto.randomBytes(12).toString('hex');
}

export function classifyUpload({ mimeType, byteSize }) {
  const mime = String(mimeType || '').toLowerCase();
  const size = Number(byteSize);
  if (!Number.isFinite(size) || size <= 0) return { error: 'invalid_size' };
  let mediaType = null;
  if (ALLOWED_IMAGE_MIME.has(mime)) mediaType = 'image';
  else if (ALLOWED_VIDEO_MIME.has(mime)) mediaType = 'video';
  if (!mediaType) return { error: 'unsupported_type' };
  const max = mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size > max) return { error: 'file_too_large' };
  return {
    mediaType,
    mimeType: mime,
    byteSize: size,
    plan: size > MULTIPART_THRESHOLD ? 'multipart' : 'single',
    partSize: size > MULTIPART_THRESHOLD ? PART_SIZE : null,
    partCount: size > MULTIPART_THRESHOLD ? Math.ceil(size / PART_SIZE) : null,
  };
}

// uploader: { type: 'office'|'guide'|'customer', userId?, personRefId?, linkId?, label? }
export async function initiateUploadBatch(client, { tour, uploader, files }) {
  if (!tour || tour.status === 'cancelled') return { error: 'tour_cancelled' };
  if (!Array.isArray(files) || files.length === 0) return { error: 'no_files' };
  if (files.length > MAX_FILES_PER_INITIATE) return { error: 'too_many_files_per_call' };
  const gallery = await ensureGallery(client, tour.id);
  const batchId = newMediaId();
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    const fileName = String(f?.fileName || f?.name || 'file').slice(0, 300);
    const cls = classifyUpload({ mimeType: f?.mimeType, byteSize: f?.byteSize });
    if (cls.error) {
      rejected.push({ fileName, clientKey: f?.clientKey ?? null, error: cls.error });
      continue;
    }
    const mediaId = newMediaId();
    const capturedAt = f?.capturedAt ? new Date(f.capturedAt) : null;
    const row = await client.tourMedia.create({
      data: {
        id: mediaId,
        galleryId: gallery.id,
        tourEventId: tour.id,
        objectKey: originalKey(tour.id, mediaId, fileName),
        mediaType: cls.mediaType,
        mimeType: cls.mimeType,
        originalFileName: fileName,
        byteSize: BigInt(cls.byteSize),
        capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : null,
        partSize: cls.partSize,
        batchId,
        uploadedByType: uploader.type,
        uploadedById: uploader.userId || null,
        uploadedByPersonRefId: uploader.personRefId || null,
        uploadedByLinkId: uploader.linkId || null,
        uploadedByLabel: uploader.label || null,
      },
    });
    accepted.push({
      mediaId: row.id,
      clientKey: f?.clientKey ?? null,
      fileName,
      mediaType: cls.mediaType,
      plan: cls.plan,
      partSize: cls.partSize,
      partCount: cls.partCount,
    });
  }
  return { batchId, accepted, rejected };
}

// Fresh presigned URLs for ONE pending media row. body: { partNumbers?, thumb?,
// poster? }. Also bumps updatedAt (prisma @updatedAt) so an actively-worked
// file never looks abandoned to the sweep.
export async function getUploadTargets(client, media, body = {}) {
  if (!r2.isConfigured()) return { error: 'r2_not_configured', status: 503 };
  if (media.uploadStatus !== 'pending') return { error: 'not_pending', status: 409 };
  const out = {};
  if (media.partSize) {
    let uploadId = media.uploadId;
    if (!uploadId) {
      uploadId = await r2.createMultipartUpload({
        key: media.objectKey,
        contentType: media.mimeType,
      });
      await client.tourMedia.update({ where: { id: media.id }, data: { uploadId } });
    } else {
      await client.tourMedia.update({ where: { id: media.id }, data: {} }); // touch updatedAt
    }
    const partNumbers = (Array.isArray(body.partNumbers) ? body.partNumbers : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000)
      .slice(0, MAX_PART_URLS_PER_CALL);
    out.partUrls = {};
    for (const n of partNumbers) {
      out.partUrls[n] = await r2.presignUploadPart({
        key: media.objectKey,
        uploadId,
        partNumber: n,
      });
    }
  } else {
    await client.tourMedia.update({ where: { id: media.id }, data: {} }); // touch updatedAt
    out.putUrl = await r2.presignPut({
      key: media.objectKey,
      contentType: media.mimeType,
      expiresIn: 3600,
    });
  }
  if (body.thumb) {
    out.thumbPutUrl = await r2.presignPut({
      key: thumbKey(media.tourEventId, media.id),
      contentType: 'image/webp',
      expiresIn: 3600,
    });
  }
  if (body.poster && media.mediaType === 'video') {
    out.posterPutUrl = await r2.presignPut({
      key: posterKey(media.tourEventId, media.id),
      contentType: 'image/webp',
      expiresIn: 3600,
    });
  }
  return out;
}

// Read the ftyp/magic prefix and decide whether the stored object really is
// the media kind the row claims. deps injectable for tests.
async function verifyObject(storage, media) {
  const head = await storage.headObject(media.objectKey);
  if (!head || head.size <= 0) return { error: 'object_missing' };
  const max = media.mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (head.size > max) return { error: 'file_too_large' };
  const prefix = await storage.getObjectRange(media.objectKey, 0, 15);
  const sniffed = detectMime(prefix);
  if (!sniffed || kindOfMime(sniffed) !== media.mediaType) {
    return { error: 'invalid_content', sniffed };
  }
  return { head, sniffed };
}

// body: { width?, height?, durationSeconds?, hasThumb?, hasPoster? }
// Idempotent: completing an already-ready row returns it unchanged; multipart
// completion recovers cleanly when R2 already assembled the object.
export async function completeUpload(client, media, body = {}, { storage = r2, origin } = {}) {
  if (media.deletedAt) return { error: 'not_found', status: 404 };
  if (media.uploadStatus === 'ready') return { media, alreadyReady: true };
  if (!storage.isConfigured()) return { error: 'r2_not_configured', status: 503 };

  // Multipart: assemble from R2's own part list. NoSuchUpload + existing
  // object = a duplicate completion racing us — fall through to verification.
  if (media.uploadId) {
    try {
      const parts = await storage.listParts({ key: media.objectKey, uploadId: media.uploadId });
      if (parts.length === 0) {
        const head = await storage.headObject(media.objectKey);
        if (!head) return { error: 'no_parts_uploaded', status: 409 };
      } else {
        await storage.completeMultipartUpload({
          key: media.objectKey,
          uploadId: media.uploadId,
          parts,
        });
      }
    } catch (e) {
      const gone = e?.name === 'NoSuchUpload' || e?.Code === 'NoSuchUpload';
      if (!gone) throw e;
      const head = await storage.headObject(media.objectKey);
      if (!head) return { error: 'upload_not_found', status: 409 };
    }
  }

  const verified = await verifyObject(storage, media);
  if (verified.error === 'object_missing') {
    // Complete raced ahead of the PUT — recoverable; the row stays pending so
    // the client can finish the upload and complete again.
    return { error: 'object_missing', status: 409 };
  }
  if (verified.error) {
    // Dishonest/broken content: remove the object AND the row so nothing
    // half-uploaded or mislabeled can ever surface as media.
    await storage.deleteObject(media.objectKey);
    await client.tourMedia.delete({ where: { id: media.id } }).catch(() => {});
    return { error: verified.error, status: 422 };
  }

  const data = {
    uploadStatus: 'ready',
    completedAt: new Date(),
    uploadId: null,
    byteSize: BigInt(verified.head.size),
    mimeType: verified.sniffed,
  };
  const width = Number(body.width);
  const height = Number(body.height);
  const duration = Number(body.durationSeconds);
  if (Number.isInteger(width) && width > 0 && width < 100000) data.width = width;
  if (Number.isInteger(height) && height > 0 && height < 100000) data.height = height;
  if (Number.isFinite(duration) && duration > 0) data.durationSeconds = duration;

  // Derivatives are optional (client-generated): record them only if the
  // bytes actually landed.
  if (body.hasThumb) {
    const tk = thumbKey(media.tourEventId, media.id);
    if (await storage.headObject(tk)) data.thumbKey = tk;
  }
  if (body.hasPoster && media.mediaType === 'video') {
    const pk = posterKey(media.tourEventId, media.id);
    if (await storage.headObject(pk)) data.posterKey = pk;
  }

  // Guarded transition — only ONE completer flips pending → ready.
  const flipped = await client.tourMedia.updateMany({
    where: { id: media.id, uploadStatus: 'pending' },
    data,
  });
  const updated = await client.tourMedia.findUnique({ where: { id: media.id } });
  if (flipped.count > 0) {
    await emitUploadEvents(client, updated, { origin });
  }
  return { media: updated };
}

// Timeline policy: batch-level events, never one per photo. "First media in
// the gallery" gets its own moment; each batch reports once when its last
// pending row resolves.
async function emitUploadEvents(client, media, { origin }) {
  const readyCount = await client.tourMedia.count({
    where: { galleryId: media.galleryId, uploadStatus: 'ready', deletedAt: null },
  });
  if (readyCount === 1) {
    await emitTimelineEvent(client, {
      subjectType: 'tour_event',
      subjectId: media.tourEventId,
      kind: 'tour',
      data: {
        event: 'gallery_first_upload',
        uploadedByType: media.uploadedByType,
        uploadedByLabel: media.uploadedByLabel,
      },
      origin,
    });
  }
  if (media.batchId) {
    const pendingInBatch = await client.tourMedia.count({
      where: { batchId: media.batchId, uploadStatus: 'pending', deletedAt: null },
    });
    if (pendingInBatch === 0) {
      const [images, videos] = await Promise.all([
        client.tourMedia.count({
          where: { batchId: media.batchId, uploadStatus: 'ready', deletedAt: null, mediaType: 'image' },
        }),
        client.tourMedia.count({
          where: { batchId: media.batchId, uploadStatus: 'ready', deletedAt: null, mediaType: 'video' },
        }),
      ]);
      await emitTimelineEvent(client, {
        subjectType: 'tour_event',
        subjectId: media.tourEventId,
        kind: 'tour',
        data: {
          event: 'gallery_batch_uploaded',
          batchId: media.batchId,
          images,
          videos,
          uploadedByType: media.uploadedByType,
          uploadedByLabel: media.uploadedByLabel,
        },
        origin,
      });
    }
  }
}

// Client-initiated abort of ONE pending upload: abort multipart, drop any
// partial object/derivatives, remove the row. Idempotent.
export async function abortUpload(client, media, { storage = r2 } = {}) {
  if (media.uploadStatus === 'ready') return { error: 'already_ready', status: 409 };
  if (storage.isConfigured()) {
    if (media.uploadId) {
      await storage.abortMultipartUpload({ key: media.objectKey, uploadId: media.uploadId });
    }
    await storage.deleteObject(media.objectKey);
    await storage.deleteObject(thumbKey(media.tourEventId, media.id));
    if (media.mediaType === 'video') {
      await storage.deleteObject(posterKey(media.tourEventId, media.id));
    }
  }
  await client.tourMedia.delete({ where: { id: media.id } }).catch(() => {});
  return { ok: true };
}

// Bulk delete (staff/guide surfaces — customers can NEVER reach this). Soft
// delete keeps attribution/audit in the DB; R2 objects are removed so deleted
// media stops being downloadable immediately. ONE timeline event per call.
export async function deleteMediaBatch(
  client,
  { tourEventId, ids, deletedById, deletedByLabel, origin },
  { storage = r2 } = {},
) {
  const rows = await client.tourMedia.findMany({
    where: {
      id: { in: (ids || []).map(String).slice(0, 500) },
      tourEventId,
      deletedAt: null,
    },
  });
  if (rows.length === 0) return { deleted: 0 };
  await client.tourMedia.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { deletedAt: new Date(), deletedById: deletedById || null },
  });
  // Clear a dangling cover ref so the fallback (newest image) kicks in.
  await client.tourGallery.updateMany({
    where: { tourEventId, coverMediaId: { in: rows.map((r) => r.id) } },
    data: { coverMediaId: null },
  });
  if (storage.isConfigured()) {
    for (const r of rows) {
      if (r.uploadId) {
        await storage.abortMultipartUpload({ key: r.objectKey, uploadId: r.uploadId }).catch(() => {});
      }
      await storage.deleteObject(r.objectKey);
      if (r.thumbKey) await storage.deleteObject(r.thumbKey);
      if (r.posterKey) await storage.deleteObject(r.posterKey);
    }
  }
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    data: { event: 'gallery_media_deleted', count: rows.length, by: deletedByLabel || null },
    origin,
  });
  return { deleted: rows.length };
}
