import { prisma } from '../../db.js';
import * as r2 from '../../r2.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';

// Async R2 purge for cancelled/deleted tour galleries + the abandoned-upload
// sweep. Same conventions as the WhatsApp/email workers: 60s tick inside the
// GOS server process, claim-based (safe if two instances ever run), and every
// step idempotent — purging a prefix twice is harmless.
//
// Honesty contract: a task is marked done ONLY after re-listing the prefix
// shows zero objects and zero in-flight multipart uploads. Partial failures
// keep the task pending with lastError + backoff; the gallery summary exposes
// that state to operations instead of silently claiming success.

const TICK_MS = 60_000;
const MAX_TASKS_PER_TICK = 3;
const STALE_RUNNING_MS = 15 * 60 * 1000;
// Pending upload rows older than this are abandoned: multipart aborted,
// objects deleted, row removed. Long-haul mobile batches re-request URLs per
// file, so a genuinely active upload keeps its row fresh (updatedAt bumps).
export const ABANDONED_UPLOAD_MS = Number(
  process.env.TOUR_GALLERY_ABANDONED_UPLOAD_MS || 24 * 60 * 60 * 1000,
);

function backoffMs(attempts) {
  return Math.min(attempts * 10 * 60 * 1000, 6 * 60 * 60 * 1000);
}

// Purge everything under the task's prefix. Exported with injectable deps for
// tests; the worker wires the real prisma + r2.
export async function processCleanupTask(deps, task) {
  const { db, storage, log, now = () => new Date() } = deps;

  // Claim (pending → running); losing the race means another pass owns it.
  const claimed = await db.tourGalleryCleanupTask.updateMany({
    where: { id: task.id, status: 'pending' },
    data: { status: 'running', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'not_claimed';

  try {
    // Re-check: a cancellation reverted within the grace window keeps its
    // media. (Deletion tasks have no tour row left — always proceed.)
    const tour = await db.tourEvent.findUnique({
      where: { id: task.tourEventId },
      select: { id: true, status: true },
    });
    if (task.reason === 'tour_cancelled' && tour && tour.status !== 'cancelled') {
      await db.tourGalleryCleanupTask.update({
        where: { id: task.id },
        data: { status: 'skipped', completedAt: now() },
      });
      await emitTimelineEvent(db, {
        subjectType: 'tour_event',
        subjectId: task.tourEventId,
        kind: 'tour',
        data: { event: 'gallery_cleanup_skipped', reason: 'tour_no_longer_cancelled' },
        origin: systemOrigin(),
      });
      return 'skipped';
    }

    let deletedObjects = 0;
    if (storage.isConfigured()) {
      // Abort in-flight multipart uploads first so their parts don't linger.
      const uploads = await storage.listMultipartUploads(task.prefix);
      for (const u of uploads) await storage.abortMultipartUpload(u);

      const keys = await storage.listKeys(task.prefix);
      if (keys.length) await storage.deleteObjects(keys);
      deletedObjects = keys.length;

      // Verify — done means EMPTY, not "we tried".
      const remaining = await storage.listKeys(task.prefix);
      if (remaining.length > 0) {
        throw new Error(`cleanup_incomplete: ${remaining.length} objects remain`);
      }
    }

    // Mark media rows deleted (rows may already be gone if the tour row was
    // deleted — cascade — so this is best-effort bookkeeping).
    await db.tourMedia.updateMany({
      where: { tourEventId: task.tourEventId, deletedAt: null },
      data: { deletedAt: now() },
    });

    await db.tourGalleryCleanupTask.update({
      where: { id: task.id },
      data: { status: 'done', completedAt: now(), deletedObjects, lastError: null },
    });
    await emitTimelineEvent(db, {
      subjectType: 'tour_event',
      subjectId: task.tourEventId,
      kind: 'tour',
      data: { event: 'gallery_cleanup_completed', deletedObjects, reason: task.reason },
      origin: systemOrigin(),
    });
    return 'done';
  } catch (e) {
    const attempts = (task.attempts || 0) + 1;
    await db.tourGalleryCleanupTask.update({
      where: { id: task.id },
      data: {
        status: 'pending',
        lastError: String(e?.message || e).slice(0, 500),
        notBefore: new Date(now().getTime() + backoffMs(attempts)),
      },
    });
    log?.warn?.('[tour-gallery] cleanup task failed', task.id, e?.message);
    return 'failed';
  }
}

// Abandoned pending uploads: initiated but never completed (browser closed,
// battery died). Abort the multipart, best-effort delete any partial object,
// and remove the row so it can never surface as media.
export async function sweepAbandonedUploads(deps) {
  const { db, storage, log, now = () => new Date() } = deps;
  const cutoff = new Date(now().getTime() - ABANDONED_UPLOAD_MS);
  const stale = await db.tourMedia.findMany({
    where: { uploadStatus: 'pending', updatedAt: { lt: cutoff } },
    take: 50,
  });
  for (const m of stale) {
    try {
      if (storage.isConfigured()) {
        if (m.uploadId) {
          await storage.abortMultipartUpload({ key: m.objectKey, uploadId: m.uploadId });
        }
        await storage.deleteObject(m.objectKey);
        if (m.thumbKey) await storage.deleteObject(m.thumbKey);
        if (m.posterKey) await storage.deleteObject(m.posterKey);
      }
      await db.tourMedia.delete({ where: { id: m.id } });
    } catch (e) {
      log?.warn?.('[tour-gallery] abandoned-upload sweep failed for', m.id, e?.message);
    }
  }
  return stale.length;
}

let started = false;

export function startTourGalleryCleanupWorker(log = console) {
  if (started) return;
  started = true;
  const deps = { db: prisma, storage: r2, log };
  const tick = async () => {
    try {
      // Requeue tasks stuck in 'running' (process died mid-purge).
      await prisma.tourGalleryCleanupTask.updateMany({
        where: { status: 'running', updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
        data: { status: 'pending' },
      });
      const tasks = await prisma.tourGalleryCleanupTask.findMany({
        where: { status: 'pending', notBefore: { lte: new Date() } },
        orderBy: { notBefore: 'asc' },
        take: MAX_TASKS_PER_TICK,
      });
      for (const task of tasks) await processCleanupTask(deps, task);
      await sweepAbandonedUploads(deps);
    } catch (e) {
      log?.warn?.('[tour-gallery] worker tick failed:', e?.message);
    }
  };
  setInterval(tick, TICK_MS).unref?.();
  log?.log?.('[tour-gallery] cleanup worker started');
}
