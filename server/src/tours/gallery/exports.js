import * as r2 from '../../r2.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';
import { archiveKey } from './keys.js';
import { getGallerySettings } from './service.js';
import { zipStream, uniqueZipNames } from './zipStream.js';

// "Download all" — async ZIP export jobs. The API request only CREATES the
// job; the gallery worker streams R2 → zip → R2 (flat memory), then the
// archive is served by presigned redirect until it expires. A ready export is
// REUSED while the gallery hasn't changed since it was built — repeated
// clicks don't rebuild gigabytes.

export const MAX_EXPORT_ATTEMPTS = 5;

async function latestMediaChange(client, galleryId) {
  const [lastCompleted, lastDeleted] = await Promise.all([
    client.tourMedia.findFirst({
      where: { galleryId, uploadStatus: 'ready' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
    client.tourMedia.findFirst({
      where: { galleryId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { deletedAt: true },
    }),
  ]);
  const a = lastCompleted?.completedAt?.getTime() || 0;
  const b = lastDeleted?.deletedAt?.getTime() || 0;
  return Math.max(a, b);
}

// requestedBy: { type: 'office'|'guide'|'customer', linkId? }
export async function requestExport(client, { tourEventId, gallery, requestedBy, origin }) {
  const mediaCount = await client.tourMedia.count({
    where: { galleryId: gallery.id, uploadStatus: 'ready', deletedAt: null },
  });
  if (mediaCount === 0) return { error: 'gallery_empty', status: 409 };

  // Reuse: a live (ready, unexpired) export built AFTER the last gallery
  // change, or an already-queued job.
  const existing = await client.tourGalleryExport.findFirst({
    where: { tourEventId, status: { in: ['pending', 'running', 'ready'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    if (existing.status !== 'ready') return { export: existing, reused: true };
    const changedAt = await latestMediaChange(client, gallery.id);
    const stillValid =
      (!existing.expiresAt || existing.expiresAt > new Date()) &&
      existing.createdAt.getTime() >= changedAt;
    if (stillValid) return { export: existing, reused: true };
  }

  const job = await client.tourGalleryExport.create({
    data: {
      tourEventId,
      galleryId: gallery.id,
      requestedByType: requestedBy.type,
      requestedByLinkId: requestedBy.linkId || null,
      mediaCount,
    },
  });
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    data: { event: 'gallery_export_requested', mediaCount, by: requestedBy.type },
    origin,
  });
  return { export: job, reused: false };
}

// Worker step: build ONE export. Streams every ready media object through the
// store-zipper into archives/<exportId>.zip. deps: { db, storage, log }.
export async function processExportJob(deps, job) {
  const { db, storage, log } = deps;
  const claimed = await db.tourGalleryExport.updateMany({
    where: { id: job.id, status: 'pending' },
    data: { status: 'running', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'not_claimed';

  try {
    if (!storage.isConfigured()) throw new Error('r2_not_configured');
    const tour = await db.tourEvent.findUnique({
      where: { id: job.tourEventId },
      select: { id: true, status: true },
    });
    if (!tour || tour.status === 'cancelled') {
      await db.tourGalleryExport.update({
        where: { id: job.id },
        data: { status: 'failed', error: 'tour_cancelled' },
      });
      return 'failed';
    }
    const media = await db.tourMedia.findMany({
      where: { galleryId: job.galleryId, uploadStatus: 'ready', deletedAt: null },
      orderBy: [{ capturedAt: 'asc' }, { completedAt: 'asc' }],
    });
    if (media.length === 0) throw new Error('gallery_empty');

    const names = uniqueZipNames(media.map((m) => m.originalFileName));
    async function* entries() {
      for (let i = 0; i < media.length; i += 1) {
        yield {
          name: names[i],
          size: media[i].byteSize == null ? 0 : Number(media[i].byteSize),
          modifiedAt: media[i].capturedAt || media[i].completedAt || new Date(),
          data: await storage.getObjectStream(media[i].objectKey),
        };
      }
    }

    const key = archiveKey(job.tourEventId, job.id);
    const byteSize = await storage.uploadStream({
      key,
      contentType: 'application/zip',
      body: zipStream(entries()),
    });

    const settings = await getGallerySettings(db);
    const expiresAt = new Date(Date.now() + (settings.archiveExpiryHours || 72) * 3600 * 1000);
    await db.tourGalleryExport.update({
      where: { id: job.id },
      data: {
        status: 'ready',
        archiveKey: key,
        byteSize: BigInt(byteSize),
        mediaCount: media.length,
        completedAt: new Date(),
        expiresAt,
        error: null,
      },
    });
    await emitTimelineEvent(db, {
      subjectType: 'tour_event',
      subjectId: job.tourEventId,
      kind: 'tour',
      data: { event: 'gallery_export_completed', mediaCount: media.length, byteSize },
      origin: systemOrigin(),
    });
    return 'ready';
  } catch (e) {
    const attempts = (job.attempts || 0) + 1;
    const terminal = attempts >= MAX_EXPORT_ATTEMPTS || e?.message === 'gallery_empty';
    await db.tourGalleryExport.update({
      where: { id: job.id },
      data: {
        status: terminal ? 'failed' : 'pending',
        error: String(e?.message || e).slice(0, 500),
      },
    });
    log?.warn?.('[tour-gallery] export failed', job.id, e?.message);
    return 'failed';
  }
}

// Expired archives: delete the R2 object, mark the row. Idempotent.
export async function sweepExpiredExports(deps) {
  const { db, storage } = deps;
  const stale = await db.tourGalleryExport.findMany({
    where: { status: 'ready', expiresAt: { lt: new Date() } },
    take: 20,
  });
  for (const job of stale) {
    if (storage.isConfigured() && job.archiveKey) await storage.deleteObject(job.archiveKey);
    await db.tourGalleryExport.update({
      where: { id: job.id },
      data: { status: 'expired', archiveKey: null },
    });
  }
  return stale.length;
}
