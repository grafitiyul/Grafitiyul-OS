import {
  MAX_FILES_PER_INITIATE,
  classifyUpload,
  newMediaId,
} from '../tours/gallery/uploads.js';
import { originalKey, storagePrefix } from './keys.js';

// Upload initiation for STANDALONE galleries and Content Library assets.
//
// Everything downstream of this — presigned targets, multipart, magic-byte
// verification, the pending→ready flip — is the SAME code the tour gallery
// uses (tours/gallery/uploads.js). Only the row creation differs, because a
// non-tour asset has no TourEvent to anchor its object key to.
//
// Validation is imported rather than re-stated on purpose: a second copy of the
// allow-list is how one surface quietly starts accepting a file type the other
// refuses.

export {
  ALLOWED_IMAGE_MIME,
  ALLOWED_VIDEO_MIME,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  classifyUpload,
} from '../tours/gallery/uploads.js';

/**
 * Create pending media rows for a standalone gallery.
 *
 * uploader: { type: 'office'|'customer', userId?, linkId?, label? }
 * Returns { batchId, accepted[], rejected[] } — rejections are per FILE and
 * carry a reason, so one unsupported file never fails a whole drag-and-drop.
 */
export async function initiateGalleryUpload(client, { gallery, uploader, files }) {
  if (!gallery) return { error: 'not_found' };
  if (gallery.status === 'archived') return { error: 'gallery_archived' };
  if (!Array.isArray(files) || files.length === 0) return { error: 'no_files' };
  if (files.length > MAX_FILES_PER_INITIATE) return { error: 'too_many_files_per_call' };

  const owner = { galleryId: gallery.id };
  // Fail fast on a malformed id BEFORE creating any row: a half-initiated batch
  // whose keys cannot be built would leave pending rows that can never complete.
  storagePrefix(owner);

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
        tourEventId: null,
        objectKey: originalKey(owner, mediaId, fileName),
        mediaType: cls.mediaType,
        mimeType: cls.mimeType,
        originalFileName: fileName,
        byteSize: BigInt(cls.byteSize),
        capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : null,
        partSize: cls.partSize,
        batchId,
        storageStrategy: 'r2_native',
        uploadedByType: uploader.type,
        uploadedById: uploader.userId || null,
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

/**
 * Create a pending media row for a Content Library upload (no gallery at all).
 * Same verified pipeline; the object lands under the `library/` prefix.
 */
export async function initiateLibraryUpload(client, { uploader, file }) {
  const fileName = String(file?.fileName || file?.name || 'file').slice(0, 300);
  const cls = classifyUpload({ mimeType: file?.mimeType, byteSize: file?.byteSize });
  if (cls.error) return { error: cls.error };
  const mediaId = newMediaId();
  const row = await client.tourMedia.create({
    data: {
      id: mediaId,
      galleryId: null,
      tourEventId: null,
      objectKey: originalKey({ library: true }, mediaId, fileName),
      mediaType: cls.mediaType,
      mimeType: cls.mimeType,
      originalFileName: fileName,
      byteSize: BigInt(cls.byteSize),
      partSize: cls.partSize,
      storageStrategy: 'r2_native',
      uploadedByType: uploader?.type || 'office',
      uploadedById: uploader?.userId || null,
      uploadedByLabel: uploader?.label || null,
    },
  });
  return {
    mediaId: row.id,
    fileName,
    mediaType: cls.mediaType,
    plan: cls.plan,
    partSize: cls.partSize,
    partCount: cls.partCount,
  };
}
