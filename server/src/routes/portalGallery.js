import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { resolveGuideGalleryAccess } from '../tours/gallery/access.js';
import {
  buildGalleryTitle,
  ensureGallery,
  ensureGalleryLink,
  getActiveGalleryLink,
} from '../tours/gallery/service.js';
import {
  abortUpload,
  completeUpload,
  deleteMediaBatch,
  getUploadTargets,
  initiateUploadBatch,
} from '../tours/gallery/uploads.js';
import { glog, maskToken } from '../tours/gallery/log.js';

// Guide Portal → Tour Gallery. Mounted at /api/portal alongside the task
// feed router; the portal token IS the credential (same V1 model). Every
// route resolves resolveGuideGalleryAccess — a guide reaches ONLY tours they
// are assigned to, and delete/share rights come from TourGallerySettings
// (enforced HERE, not by hiding buttons).
//
// COMMERCIAL-DATA CONTRACT: nothing on this surface reads Deal/Booking
// beyond what the tours list needs operationally (product, date, time,
// location). No prices, no pipeline, no customer notes.

const router = Router();

function guideOrigin(person) {
  return {
    actorType: 'api',
    actorLabel: `מדריך · ${person.displayName}`,
    createdBy: null,
    createdByName: null,
  };
}

async function mediaToClient(m) {
  const out = {
    id: m.id,
    mediaType: m.mediaType,
    mimeType: m.mimeType,
    originalFileName: m.originalFileName,
    byteSize: m.byteSize == null ? null : Number(m.byteSize),
    width: m.width,
    height: m.height,
    durationSeconds: m.durationSeconds,
    capturedAt: m.capturedAt,
    uploadedByType: m.uploadedByType,
    uploadedByLabel: m.uploadedByLabel,
    completedAt: m.completedAt,
    thumbUrl: null,
    posterUrl: null,
    viewUrl: null,
  };
  if (r2.isConfigured()) {
    if (m.thumbKey) out.thumbUrl = await r2.presignGet({ key: m.thumbKey, expiresIn: 3600 });
    if (m.posterKey) out.posterUrl = await r2.presignGet({ key: m.posterKey, expiresIn: 3600 });
    out.viewUrl = await r2.presignGet({ key: m.objectKey, expiresIn: 3600 });
  }
  return out;
}

// Resolve access or answer the request; returns null when already answered.
async function guard(req, res) {
  const access = await resolveGuideGalleryAccess(prisma, {
    portalToken: req.params.token,
    tourEventId: req.params.tourEventId,
  });
  if (!access.ok) {
    glog('guide_access_denied', {
      token: maskToken(req.params.token),
      tourEventId: req.params.tourEventId,
      status: access.status,
      reason: access.error,
    });
    res.status(access.status).json({ error: access.error });
    return null;
  }
  res.set('Cache-Control', 'no-store');
  return access;
}

// ---------- assigned tours list ----------
// The guide's operational tours (recent past + upcoming) with gallery counts.

router.get(
  '/:token/tours',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { portalToken: String(req.params.token || '') },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    if (!person.portalEnabled || person.status === 'blocked') {
      return res.status(403).json({ error: 'portal_disabled' });
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const assignments = await prisma.tourAssignment.findMany({
      where: {
        externalPersonId: person.externalPersonId,
        tourEvent: { date: { gte: since }, status: { not: 'cancelled' } },
      },
      include: {
        tourEvent: {
          include: {
            product: { select: { nameHe: true } },
            location: { select: { nameHe: true } },
            productVariant: { select: { location: { select: { nameHe: true } } } },
          },
        },
      },
    });
    const tourIds = assignments.map((a) => a.tourEventId);
    // Gallery counts (derived, one grouped query — no stored counters).
    const counts = tourIds.length
      ? await prisma.tourMedia.groupBy({
          by: ['tourEventId'],
          where: { tourEventId: { in: tourIds }, uploadStatus: 'ready', deletedAt: null },
          _count: { id: true },
        })
      : [];
    const countByTour = Object.fromEntries(counts.map((c) => [c.tourEventId, c._count.id]));
    const tours = assignments
      .map((a) => {
        const t = a.tourEvent;
        return {
          id: t.id,
          date: t.date,
          startTime: t.startTime,
          status: t.status,
          role: a.role,
          productName: t.product?.nameHe || 'סיור',
          locationName: t.location?.nameHe || t.productVariant?.location?.nameHe || null,
          mediaCount: countByTour[t.id] || 0,
        };
      })
      .sort((x, y) => (x.date + x.startTime < y.date + y.startTime ? 1 : -1));
    res.set('Cache-Control', 'no-store');
    res.json({ tours });
  }),
);

// ---------- gallery view ----------

router.get(
  '/:token/tours/:tourEventId/gallery',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const tour = await prisma.tourEvent.findUnique({
      where: { id: access.tour.id },
      include: {
        product: { select: { nameHe: true, nameEn: true } },
        bookings: {
          where: { status: 'active' },
          select: {
            status: true,
            deal: { select: { title: true, organization: { select: { name: true } } } },
          },
        },
      },
    });
    const gallery = await prisma.tourGallery.findUnique({ where: { tourEventId: tour.id } });
    const media = gallery
      ? await prisma.tourMedia.findMany({
          where: { galleryId: gallery.id, deletedAt: null, uploadStatus: 'ready' },
          orderBy: [{ capturedAt: 'asc' }, { completedAt: 'asc' }],
        })
      : [];
    let linkToken = null;
    if (access.permissions.canShareCustomerLink && gallery) {
      const link = await getActiveGalleryLink(prisma, gallery.id);
      linkToken = link?.token || null;
    }
    res.json({
      tourEventId: tour.id,
      title: buildGalleryTitle(tour),
      tourStatus: tour.status,
      date: tour.date,
      startTime: tour.startTime,
      coverMediaId: gallery?.coverMediaId || null,
      permissions: access.permissions,
      linkToken,
      media: await Promise.all(media.map(mediaToClient)),
    });
  }),
);

// Share link — guides may CREATE the permanent link only when the settings
// switch allows sharing (rotation/revocation stay office-only).
router.post(
  '/:token/tours/:tourEventId/gallery/link',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (!access.permissions.canShareCustomerLink) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    if (access.tour.status === 'cancelled') return res.status(409).json({ error: 'tour_cancelled' });
    const { link } = await ensureGalleryLink(prisma, access.tour.id, {
      createdById: null,
      origin: guideOrigin(access.person),
    });
    res.json({ token: link.token });
  }),
);

// ---------- uploads (guide actor — same engine as the office surface) ----------

router.post(
  '/:token/tours/:tourEventId/gallery/uploads',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const result = await initiateUploadBatch(prisma, {
      tour: access.tour,
      uploader: {
        type: 'guide',
        personRefId: access.person.id,
        label: access.person.displayName,
      },
      files: req.body?.files,
    });
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result);
  }),
);

async function pendingMedia(req, res) {
  const media = await prisma.tourMedia.findFirst({
    where: { id: req.params.mediaId, tourEventId: req.params.tourEventId, deletedAt: null },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return media;
}

router.post(
  '/:token/tours/:tourEventId/gallery/uploads/:mediaId/urls',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await pendingMedia(req, res);
    if (!media) return;
    const out = await getUploadTargets(prisma, media, req.body || {});
    if (out.error) return res.status(out.status || 409).json({ error: out.error });
    res.json(out);
  }),
);

router.post(
  '/:token/tours/:tourEventId/gallery/uploads/:mediaId/complete',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await pendingMedia(req, res);
    if (!media) return;
    const result = await completeUpload(prisma, media, req.body || {}, {
      origin: guideOrigin(access.person),
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.json(await mediaToClient(result.media));
  }),
);

router.post(
  '/:token/tours/:tourEventId/gallery/uploads/:mediaId/abort',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await pendingMedia(req, res);
    if (!media) return;
    const result = await abortUpload(prisma, media);
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.status(204).end();
  }),
);

// ---------- delete / cover (settings-gated, SERVER-side) ----------

router.post(
  '/:token/tours/:tourEventId/gallery/media/delete',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (!access.permissions.canDelete) return res.status(403).json({ error: 'not_allowed' });
    const result = await deleteMediaBatch(prisma, {
      tourEventId: access.tour.id,
      ids: req.body?.ids,
      deletedById: null,
      deletedByLabel: `מדריך · ${access.person.displayName}`,
      origin: guideOrigin(access.person),
    });
    res.json(result);
  }),
);

router.put(
  '/:token/tours/:tourEventId/gallery/cover',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (!access.permissions.canSetCover) return res.status(403).json({ error: 'not_allowed' });
    const gallery = await ensureGallery(prisma, access.tour.id);
    const mediaId = req.body?.mediaId ? String(req.body.mediaId) : null;
    if (mediaId) {
      const media = await prisma.tourMedia.findFirst({
        where: { id: mediaId, galleryId: gallery.id, deletedAt: null, uploadStatus: 'ready' },
        select: { id: true },
      });
      if (!media) return res.status(400).json({ error: 'invalid_media' });
    }
    await prisma.tourGallery.update({ where: { id: gallery.id }, data: { coverMediaId: mediaId } });
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: access.tour.id,
      kind: 'tour',
      data: { event: 'gallery_cover_changed', mediaId },
      origin: guideOrigin(access.person),
    });
    res.json({ coverMediaId: mediaId });
  }),
);

// ---------- download ----------

router.get(
  '/:token/tours/:tourEventId/gallery/media/:mediaId/download',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await prisma.tourMedia.findFirst({
      where: {
        id: req.params.mediaId,
        tourEventId: access.tour.id,
        deletedAt: null,
        uploadStatus: 'ready',
      },
    });
    if (!media) return res.status(404).json({ error: 'not_found' });
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage_not_configured' });
    const url = await r2.presignGet({
      key: media.objectKey,
      expiresIn: 300,
      downloadName: media.originalFileName,
    });
    res.redirect(302, url);
  }),
);

export default router;
