import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { emitTimelineEvent } from '../../timeline/events.js';
import { galleryPrefix } from './keys.js';

// Tour Gallery domain service. Single source of truth rules:
//   * the gallery belongs to the TourEvent (one lazy row, unique tourEventId);
//   * counts/status are DERIVED from TourMedia rows on every read;
//   * the display title is computed live from current TourEvent data;
//   * cancellation cleanup goes through ONE path (scheduleGalleryCleanup),
//     called from both the auto-cancel flow and the manual status change.
// Every function takes the prisma client (or tx) first so tests can stub it.

// Grace window between "tour cancelled" and actually purging R2 — an
// accidental cancel that is reverted within the window loses nothing (the
// worker re-checks tour status before deleting).
export const CLEANUP_GRACE_MS = Number(
  process.env.TOUR_GALLERY_CLEANUP_GRACE_MS || 10 * 60 * 1000,
);

const SETTINGS_ID = 'singleton';

export async function getGallerySettings(client = prisma) {
  const existing = await client.tourGallerySettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  // First read seeds the defaults row (same pattern as TourSettings).
  return client.tourGallerySettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

// Lazy get-or-create. No R2 object is ever created for an empty gallery — R2
// prefixes are virtual, so "empty" costs nothing.
export async function ensureGallery(client, tourEventId) {
  const existing = await client.tourGallery.findUnique({ where: { tourEventId } });
  if (existing) return existing;
  const settings = await getGallerySettings(client);
  try {
    return await client.tourGallery.create({
      data: { tourEventId, customerUploadEnabled: settings.customerUploadEnabled },
    });
  } catch (e) {
    // Unique race: two first-touches at once — the loser reads the winner's row.
    if (e?.code === 'P2002') {
      return client.tourGallery.findUnique({ where: { tourEventId } });
    }
    throw e;
  }
}

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// Live display title — "סיור גרפיטי · 14.07.2026 · חברת ABC". Pure function of
// current TourEvent data; changing product/date/customer updates the title
// immediately and never touches storage keys.
export function buildGalleryTitle(tour) {
  if (!tour) return 'גלריית סיור';
  const productName = tour.product?.nameHe || null;
  const date = fmtDate(tour.date);
  let customer = null;
  const active = (tour.bookings || []).filter((b) => b.status === 'active');
  if (tour.kind === 'group_slot') {
    customer = active.length > 1 ? 'סיור קבוצתי' : active[0]?.deal?.title || null;
  } else {
    customer = active[0]?.deal?.organization?.name || active[0]?.deal?.title || null;
  }
  const parts = [productName || 'סיור', date, customer].filter(Boolean);
  return parts.join(' · ');
}

const MEDIA_LIVE = { deletedAt: null, uploadStatus: 'ready' };

// Derived summary — the ONE shape every surface (tour modal, deal popover,
// guide portal) reads. Never stores counts anywhere.
export async function gallerySummary(client, tourEventId) {
  const gallery = await client.tourGallery.findUnique({ where: { tourEventId } });
  if (!gallery) {
    return {
      tourEventId,
      exists: false,
      status: 'empty',
      imageCount: 0,
      videoCount: 0,
      pendingCount: 0,
      lastUploadAt: null,
      coverMediaId: null,
      customerUploadEnabled: null,
      cleanup: null,
    };
  }
  const [imageCount, videoCount, pendingCount, latest, cleanupTask] = await Promise.all([
    client.tourMedia.count({ where: { galleryId: gallery.id, ...MEDIA_LIVE, mediaType: 'image' } }),
    client.tourMedia.count({ where: { galleryId: gallery.id, ...MEDIA_LIVE, mediaType: 'video' } }),
    client.tourMedia.count({
      where: { galleryId: gallery.id, deletedAt: null, uploadStatus: 'pending' },
    }),
    client.tourMedia.findFirst({
      where: { galleryId: gallery.id, ...MEDIA_LIVE },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
    client.tourGalleryCleanupTask.findFirst({
      where: { tourEventId, status: { in: ['awaiting_approval', 'pending', 'running'] } },
      select: { status: true, attempts: true, lastError: true, notBefore: true },
    }),
  ]);
  const total = imageCount + videoCount;
  const status = cleanupTask
    ? 'cleanup_pending'
    : total === 0
      ? pendingCount > 0
        ? 'uploading'
        : 'empty'
      : pendingCount > 0
        ? 'uploading'
        : 'ready';
  const cover = await resolveCoverMedia(client, gallery);
  return {
    tourEventId,
    exists: true,
    status,
    imageCount,
    videoCount,
    pendingCount,
    lastUploadAt: latest?.completedAt || null,
    coverMediaId: cover?.id || null,
    customerUploadEnabled: gallery.customerUploadEnabled,
    cleanup: cleanupTask
      ? {
          status: cleanupTask.status,
          attempts: cleanupTask.attempts,
          lastError: cleanupTask.lastError || null,
        }
      : null,
  };
}

// Cover = the explicitly chosen media if it is still live, else the newest
// ready image, else the newest ready video (poster). Loose ref by design.
export async function resolveCoverMedia(client, gallery) {
  if (gallery.coverMediaId) {
    const chosen = await client.tourMedia.findFirst({
      where: { id: gallery.coverMediaId, galleryId: gallery.id, ...MEDIA_LIVE },
    });
    if (chosen) return chosen;
  }
  const image = await client.tourMedia.findFirst({
    where: { galleryId: gallery.id, ...MEDIA_LIVE, mediaType: 'image' },
    orderBy: { completedAt: 'desc' },
  });
  if (image) return image;
  return client.tourMedia.findFirst({
    where: { galleryId: gallery.id, ...MEDIA_LIVE, mediaType: 'video' },
    orderBy: { completedAt: 'desc' },
  });
}

export function newGalleryToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export async function getActiveGalleryLink(client, galleryId) {
  return client.tourGalleryLink.findFirst({
    where: { galleryId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
}

// Get-or-create the permanent customer link. One active link at a time.
export async function ensureGalleryLink(client, tourEventId, { createdById, origin }) {
  const gallery = await ensureGallery(client, tourEventId);
  const existing = await getActiveGalleryLink(client, gallery.id);
  if (existing) return { link: existing, created: false };
  const link = await client.tourGalleryLink.create({
    data: { galleryId: gallery.id, token: newGalleryToken(), createdById: createdById || null },
  });
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    data: { event: 'gallery_link_created' },
    origin,
  });
  return { link, created: true };
}

// Rotation: revoke every active link, mint a fresh token. Old URLs die.
export async function rotateGalleryLink(client, tourEventId, { createdById, origin }) {
  const gallery = await ensureGallery(client, tourEventId);
  await client.tourGalleryLink.updateMany({
    where: { galleryId: gallery.id, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date(), revokedReason: 'rotated' },
  });
  const link = await client.tourGalleryLink.create({
    data: { galleryId: gallery.id, token: newGalleryToken(), createdById: createdById || null },
  });
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    data: { event: 'gallery_link_rotated' },
    origin,
  });
  return link;
}

export async function revokeGalleryLinks(client, galleryId, reason) {
  const res = await client.tourGalleryLink.updateMany({
    where: { galleryId, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date(), revokedReason: reason },
  });
  return res.count;
}

// THE cancellation hook — called from BOTH tour-cancel paths (auto-cancel when
// the last booking leaves, and the manual status change) and from tour
// deletion. Idempotent: safe to call repeatedly. Immediate effects (link
// revocation, upload rejection via tour status) happen here; R2 purge happens
// in the async worker after the grace window.
//
// SAFETY INVARIANT (בקרה): a gallery with LIVE media never purges
// automatically — the task is created as 'awaiting_approval' and an
// OperationalIssue asks the admin to decide (approve / keep / archive).
// Only an empty gallery (no ready, undeleted media) gets an auto 'pending'
// task. The worker enforces the same check on claim, so even a legacy or
// mis-created pending task can never silently delete media.
export async function scheduleGalleryCleanup(client, tourEventId, { reason, origin }) {
  const gallery = await client.tourGallery.findUnique({
    where: { tourEventId },
    select: { id: true },
  });
  if (!gallery) return null; // gallery never touched — nothing in R2 either

  const revoked = await revokeGalleryLinks(
    client,
    gallery.id,
    reason === 'tour_deleted' ? 'tour_deleted' : 'tour_cancelled',
  );

  const mediaCount = await client.tourMedia.count({ where: { galleryId: gallery.id } });
  let task = null;
  if (mediaCount > 0) {
    const liveCount = await client.tourMedia.count({
      where: { galleryId: gallery.id, ...MEDIA_LIVE },
    });
    task = await client.tourGalleryCleanupTask.findFirst({
      where: { tourEventId, status: { in: ['awaiting_approval', 'pending', 'running'] } },
    });
    if (!task) {
      const needsApproval = liveCount > 0;
      task = await client.tourGalleryCleanupTask.create({
        data: {
          tourEventId,
          prefix: galleryPrefix(tourEventId),
          reason,
          status: needsApproval ? 'awaiting_approval' : 'pending',
          // Deletion (tour row gone) leaves nothing to revert to — purge asap.
          notBefore: new Date(Date.now() + (reason === 'tour_deleted' ? 0 : CLEANUP_GRACE_MS)),
        },
      });
      await emitTimelineEvent(client, {
        subjectType: 'tour_event',
        subjectId: tourEventId,
        kind: 'tour',
        data: {
          event: needsApproval ? 'gallery_cleanup_awaiting_approval' : 'gallery_cleanup_scheduled',
          reason,
          mediaCount,
          revokedLinks: revoked,
        },
        origin,
      });
      if (needsApproval) {
        await raiseGalleryCleanupIssue(client, { tourEventId, task, liveCount });
      }
    }
  }
  return { revokedLinks: revoked, task };
}

// Raise the canonical OperationalIssue for a media-holding gallery whose tour
// was cancelled/deleted. Kept here (next to the ONE cleanup path) so the gate
// and its report can never drift; the בקרה detector re-derives the same key
// on every sweep, which also auto-resolves it when the task leaves
// awaiting_approval.
export async function raiseGalleryCleanupIssue(client, { tourEventId, task, liveCount }) {
  const { raiseIssue } = await import('../../control/issueService.js');
  const { galleryIssuePayload } = await import('../../control/detectors/gallery.js');
  const payload = await galleryIssuePayload(client, { tourEventId, task, liveCount });
  return raiseIssue(client, payload);
}
