import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { emitTimelineEvent, systemOrigin, userOrigin } from '../../timeline/events.js';
import { buildGalleryTitle } from '../../tours/gallery/service.js';
import { requestExport } from '../../tours/gallery/exports.js';

// Gallery cleanup approval — the בקרה side of the gallery safety invariant:
// a cancelled/deleted tour whose gallery still holds live media parks its
// cleanup task as 'awaiting_approval'; this file raises the matching issue,
// keeps it truthful on every sweep, and owns the explicit-approval actions.
// NOTHING is purged until the admin presses "אשר מחיקה סופית".

const TYPE = 'gallery_cleanup_approval';
const MEDIA_LIVE = { deletedAt: null, uploadStatus: 'ready' };

const dedupeKey = (tourEventId) => `${TYPE}:${tourEventId}`;

const TOUR_TITLE_INCLUDE = {
  product: true,
  bookings: { include: { deal: { include: { organization: true } } } },
};

// Build the raiseIssue payload for one awaiting-approval task. Exported for
// the inline call site (scheduleGalleryCleanup) so the gate and the sweep
// produce the IDENTICAL issue.
export async function galleryIssuePayload(client, { tourEventId, task, liveCount }) {
  const tour = await client.tourEvent
    .findUnique({ where: { id: tourEventId }, include: TOUR_TITLE_INCLUDE })
    .catch(() => null);
  const title = buildGalleryTitle(tour);
  const reasonHe = task.reason === 'tour_deleted' ? 'הסיור נמחק' : 'הסיור בוטל';
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'gallery',
    dedupeKey: dedupeKey(tourEventId),
    title: `גלריה ממתינה לאישור ניקוי — ${title}`,
    explanation:
      `${reasonHe}, אך בגלריה שלו נשארו ${liveCount} פריטי מדיה. ` +
      'שום דבר לא יימחק ללא אישור מפורש: אפשר לפתוח את הגלריה, להוריד ארכיון, ' +
      'לשמור לתמיד, לחבר מחדש לסיור פעיל — או לאשר מחיקה סופית.',
    entityRefs: [{ type: 'tour_event', id: tourEventId, label: title }],
    data: { taskId: task.id, tourEventId, reason: task.reason, mediaCount: liveCount },
  };
}

// Assess ONE awaiting-approval task against live state and apply the safe
// transitions. Returns true when the task still needs approval (issue stays).
async function assessTask(client, task) {
  // Tour un-cancelled (accidental cancel reverted) → the media belongs to a
  // live tour again; the cleanup is moot.
  const tour = await client.tourEvent.findUnique({
    where: { id: task.tourEventId },
    select: { id: true, status: true },
  });
  if (task.reason === 'tour_cancelled' && tour && tour.status !== 'cancelled') {
    await client.tourGalleryCleanupTask.updateMany({
      where: { id: task.id, status: 'awaiting_approval' },
      data: { status: 'skipped', completedAt: new Date() },
    });
    await emitTimelineEvent(client, {
      subjectType: 'tour_event',
      subjectId: task.tourEventId,
      kind: 'tour',
      data: { event: 'gallery_cleanup_skipped', reason: 'tour_no_longer_cancelled' },
      origin: systemOrigin(),
    });
    return false;
  }
  // Gallery emptied by hand (operator deleted the media) → nothing needs
  // approval anymore; the leftover prefix may purge automatically.
  const liveCount = await client.tourMedia.count({
    where: { tourEventId: task.tourEventId, ...MEDIA_LIVE },
  });
  if (liveCount === 0) {
    await client.tourGalleryCleanupTask.updateMany({
      where: { id: task.id, status: 'awaiting_approval' },
      data: { status: 'pending', notBefore: new Date() },
    });
    return false;
  }
  await raiseIssue(client, await galleryIssuePayload(client, { tourEventId: task.tourEventId, task, liveCount }));
  return true;
}

registerDetector({
  key: 'gallery-cleanup-approval',
  async run(client) {
    const tasks = await client.tourGalleryCleanupTask.findMany({
      where: { status: 'awaiting_approval' },
    });
    const present = new Set();
    for (const task of tasks) {
      if (await assessTask(client, task)) present.add(dedupeKey(task.tourEventId));
    }
    await resolveMissing(client, TYPE, present);
  },
});

async function loadTask(client, issue) {
  const taskId = issue.data?.taskId;
  if (taskId) {
    const task = await client.tourGalleryCleanupTask.findUnique({ where: { id: taskId } });
    if (task) return task;
  }
  const tourEventId = issue.data?.tourEventId;
  if (!tourEventId) return null;
  return client.tourGalleryCleanupTask.findFirst({
    where: { tourEventId, status: 'awaiting_approval' },
  });
}

registerIssueType(TYPE, {
  sourceModule: 'gallery',

  buildActions(issue) {
    return [
      {
        key: 'open_gallery',
        label: 'פתח גלריה',
        kind: 'link',
        target: { type: 'tour_event', id: issue.data?.tourEventId },
      },
      { key: 'download_archive', label: 'הורד ארכיון', kind: 'server' },
      { key: 'reconnect', label: 'חבר מחדש לסיור פעיל', kind: 'server' },
      {
        key: 'keep_forever',
        label: 'שמור לתמיד',
        kind: 'server',
        confirm: 'לשמור את הגלריה לתמיד? משימת הניקוי תבוטל והמדיה תישאר בשלמותה.',
      },
      {
        key: 'approve_delete',
        label: 'אשר מחיקה סופית',
        kind: 'server',
        style: 'danger',
        confirm: 'למחוק לצמיתות את כל המדיה בגלריה הזו? הפעולה בלתי הפיכה.',
      },
    ];
  },

  async recheck(client, issue) {
    const task = await loadTask(client, issue);
    if (!task || task.status !== 'awaiting_approval') return false;
    return assessTask(client, task);
  },

  serverActions: {
    // THE explicit admin approval — the only path that lets the worker purge
    // a media-holding gallery.
    approve_delete: async (client, issue, { userId }) => {
      const task = await loadTask(client, issue);
      if (!task) return { ok: false, error: 'task_missing', status: 404 };
      const updated = await client.tourGalleryCleanupTask.updateMany({
        where: { id: task.id, status: 'awaiting_approval' },
        data: { status: 'pending', approvedAt: new Date(), approvedBy: userId, notBefore: new Date() },
      });
      if (updated.count === 0) return { ok: false, error: 'task_not_awaiting' };
      await emitTimelineEvent(client, {
        subjectType: 'tour_event',
        subjectId: task.tourEventId,
        kind: 'tour',
        data: { event: 'gallery_cleanup_approved', taskId: task.id },
        origin: await userOrigin(userId),
      });
      return { ok: true, resolve: { resolution: 'approve_delete' } };
    },

    keep_forever: async (client, issue, { userId }) => {
      const task = await loadTask(client, issue);
      if (!task) return { ok: false, error: 'task_missing', status: 404 };
      const updated = await client.tourGalleryCleanupTask.updateMany({
        where: { id: task.id, status: 'awaiting_approval' },
        data: { status: 'skipped', completedAt: new Date() },
      });
      if (updated.count === 0) return { ok: false, error: 'task_not_awaiting' };
      await emitTimelineEvent(client, {
        subjectType: 'tour_event',
        subjectId: task.tourEventId,
        kind: 'tour',
        data: { event: 'gallery_cleanup_kept_forever', taskId: task.id },
        origin: await userOrigin(userId),
      });
      return { ok: true, resolve: { resolution: 'keep_forever' } };
    },

    // Valid only when the tour is no longer cancelled (someone restored it) —
    // then the gallery simply belongs to the live tour again.
    reconnect: async (client, issue) => {
      const task = await loadTask(client, issue);
      if (!task) return { ok: false, error: 'task_missing', status: 404 };
      const stillPresent = await assessTask(client, task);
      if (stillPresent) return { ok: false, error: 'tour_still_cancelled' };
      return { ok: true, resolve: { resolution: 'reconnect' } };
    },

    // Async ZIP via the existing export pipeline; the archive lands in the
    // tour's gallery workspace (does NOT resolve the issue).
    download_archive: async (client, issue, { userId }) => {
      const tourEventId = issue.data?.tourEventId;
      const gallery = await client.tourGallery.findUnique({ where: { tourEventId } });
      if (!gallery) return { ok: false, error: 'gallery_missing', status: 404 };
      const result = await requestExport(client, {
        tourEventId,
        gallery,
        requestedBy: { type: 'office' },
        origin: await userOrigin(userId),
      });
      if (result.error) return { ok: false, error: result.error, status: result.status || 409 };
      return {
        ok: true,
        payload: {
          exportId: result.export.id,
          message: 'הארכיון נבנה ברקע — ההורדה תהיה זמינה מתוך גלריית הסיור.',
        },
      };
    },
  },
});
