import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import {
  buildGalleryTitle,
  ensureGallery,
  ensureGalleryLink,
  gallerySummary,
  getActiveGalleryLink,
  getGallerySettings,
  resolveCoverMedia,
  rotateGalleryLink,
  revokeGalleryLinks,
} from '../tours/gallery/service.js';
import {
  abortUpload,
  completeUpload,
  deleteMediaBatch,
  getUploadTargets,
  initiateUploadBatch,
} from '../tours/gallery/uploads.js';

// Staff/office Tour Gallery API — mounted at /api/tour-gallery behind
// requireAdminAuth. Objects are PRIVATE (same contract as DealFile): no public
// URLs; every view/download mints a short-lived presigned GET. The public
// customer surface lives in routes/publicGallery.js and derives everything
// from the link token.

const router = Router();

const TITLE_INCLUDE = {
  product: { select: { nameHe: true, nameEn: true } },
  bookings: {
    where: { status: 'active' },
    select: {
      status: true,
      deal: { select: { title: true, organization: { select: { name: true } } } },
    },
  },
};

async function ensureTour(req, res) {
  const tour = await prisma.tourEvent.findUnique({
    where: { id: req.params.tourEventId },
    include: TITLE_INCLUDE,
  });
  if (!tour) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return tour;
}

// Presigned, short-lived view URLs for a media row (thumb for the grid,
// poster for videos). Original URLs are minted only by the download route.
async function mediaToClient(m, { withUrls = true } = {}) {
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
    uploadStatus: m.uploadStatus,
    uploadedByType: m.uploadedByType,
    uploadedByLabel: m.uploadedByLabel,
    batchId: m.batchId,
    createdAt: m.createdAt,
    completedAt: m.completedAt,
    thumbUrl: null,
    posterUrl: null,
    viewUrl: null,
  };
  if (withUrls && r2.isConfigured()) {
    if (m.thumbKey) out.thumbUrl = await r2.presignGet({ key: m.thumbKey, expiresIn: 3600 });
    if (m.posterKey) out.posterUrl = await r2.presignGet({ key: m.posterKey, expiresIn: 3600 });
    // Original view URL — used ONLY by the lightbox/player on demand; the
    // grid renders thumbs. Same 1h lifetime as the rest of the payload.
    out.viewUrl = await r2.presignGet({ key: m.objectKey, expiresIn: 3600 });
  }
  return out;
}

// ---------- settings (singleton) ----------

router.get(
  '/settings',
  handle(async (_req, res) => {
    res.json(await getGallerySettings(prisma));
  }),
);

router.put(
  '/settings',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    for (const k of ['guideCanDelete', 'guideCanShareCustomerLink', 'customerUploadEnabled']) {
      if (b[k] !== undefined) data[k] = !!b[k];
    }
    if (b.publicBrandingText !== undefined) {
      data.publicBrandingText = b.publicBrandingText
        ? String(b.publicBrandingText).slice(0, 200)
        : null;
    }
    if (b.archiveExpiryHours !== undefined) {
      const n = Number(b.archiveExpiryHours);
      if (!Number.isInteger(n) || n < 1 || n > 720) {
        return res.status(400).json({ error: 'invalid_archive_expiry' });
      }
      data.archiveExpiryHours = n;
    }
    await getGallerySettings(prisma); // seed row if missing
    const updated = await prisma.tourGallerySettings.update({
      where: { id: 'singleton' },
      data,
    });
    res.json(updated);
  }),
);

// ---------- summary (tour modal card / deal read-through) ----------

router.get(
  '/:tourEventId/summary',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    const summary = await gallerySummary(prisma, tour.id);
    const gallery = summary.exists
      ? await prisma.tourGallery.findUnique({ where: { tourEventId: tour.id } })
      : null;
    let coverThumbUrl = null;
    if (gallery && summary.coverMediaId && r2.isConfigured()) {
      const cover = await resolveCoverMedia(prisma, gallery);
      const key = cover?.thumbKey || cover?.posterKey || null;
      if (key) coverThumbUrl = await r2.presignGet({ key, expiresIn: 3600 });
    }
    const link = gallery ? await getActiveGalleryLink(prisma, gallery.id) : null;
    res.json({
      ...summary,
      title: buildGalleryTitle(tour),
      tourStatus: tour.status,
      coverThumbUrl,
      link: link ? { id: link.id, token: link.token, createdAt: link.createdAt } : null,
    });
  }),
);

// ---------- full gallery (staff workspace) ----------

router.get(
  '/:tourEventId',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    const gallery = await prisma.tourGallery.findUnique({ where: { tourEventId: tour.id } });
    const media = gallery
      ? await prisma.tourMedia.findMany({
          where: { galleryId: gallery.id, deletedAt: null, uploadStatus: 'ready' },
          orderBy: [{ capturedAt: 'asc' }, { completedAt: 'asc' }],
        })
      : [];
    const link = gallery ? await getActiveGalleryLink(prisma, gallery.id) : null;
    const summary = await gallerySummary(prisma, tour.id);
    res.json({
      ...summary,
      title: buildGalleryTitle(tour),
      tourStatus: tour.status,
      coverMediaId: summary.coverMediaId,
      link: link ? { id: link.id, token: link.token, createdAt: link.createdAt } : null,
      media: await Promise.all(media.map((m) => mediaToClient(m))),
    });
  }),
);

// ---------- customer link management ----------

router.post(
  '/:tourEventId/link',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    if (tour.status === 'cancelled') return res.status(409).json({ error: 'tour_cancelled' });
    const { link, created } = await ensureGalleryLink(prisma, tour.id, {
      createdById: req.adminAuth?.userId,
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.status(created ? 201 : 200).json({ id: link.id, token: link.token, createdAt: link.createdAt });
  }),
);

router.post(
  '/:tourEventId/link/rotate',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    if (tour.status === 'cancelled') return res.status(409).json({ error: 'tour_cancelled' });
    const link = await rotateGalleryLink(prisma, tour.id, {
      createdById: req.adminAuth?.userId,
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.status(201).json({ id: link.id, token: link.token, createdAt: link.createdAt });
  }),
);

router.delete(
  '/:tourEventId/link',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    const gallery = await prisma.tourGallery.findUnique({ where: { tourEventId: tour.id } });
    if (!gallery) return res.status(404).json({ error: 'not_found' });
    const count = await revokeGalleryLinks(prisma, gallery.id, 'manual');
    if (count > 0) {
      await emitTimelineEvent(prisma, {
        subjectType: 'tour_event',
        subjectId: tour.id,
        kind: 'tour',
        data: { event: 'gallery_link_revoked' },
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }
    res.status(204).end();
  }),
);

// ---------- cover ----------

router.put(
  '/:tourEventId/cover',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    const gallery = await ensureGallery(prisma, tour.id);
    const mediaId = req.body?.mediaId ? String(req.body.mediaId) : null;
    if (mediaId) {
      const media = await prisma.tourMedia.findFirst({
        where: { id: mediaId, galleryId: gallery.id, deletedAt: null, uploadStatus: 'ready' },
        select: { id: true },
      });
      if (!media) return res.status(400).json({ error: 'invalid_media' });
    }
    await prisma.tourGallery.update({
      where: { id: gallery.id },
      data: { coverMediaId: mediaId },
    });
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: tour.id,
      kind: 'tour',
      data: { event: 'gallery_cover_changed', mediaId },
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.json({ coverMediaId: mediaId });
  }),
);

// ---------- direct-to-R2 uploads (office actor) ----------
// Same engine the guide/customer surfaces use — only the resolved uploader
// identity differs. Bytes never pass through this server.

async function officeUploader(req) {
  const u = await prisma.adminUser.findUnique({
    where: { id: req.adminAuth?.userId || '' },
    select: { username: true },
  });
  return { type: 'office', userId: req.adminAuth?.userId || null, label: u?.username || 'משרד' };
}

// POST /:tourEventId/uploads — { files: [{ clientKey, fileName, mimeType,
// byteSize, capturedAt? }] } → pending rows + per-file upload plan.
router.post(
  '/:tourEventId/uploads',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const result = await initiateUploadBatch(prisma, {
      tour,
      uploader: await officeUploader(req),
      files: req.body?.files,
    });
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result);
  }),
);

async function ensurePendingMedia(req, res) {
  const media = await prisma.tourMedia.findFirst({
    where: { id: req.params.mediaId, tourEventId: req.params.tourEventId, deletedAt: null },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return media;
}

// POST /:tourEventId/uploads/:mediaId/urls — fresh presigned target(s).
router.post(
  '/:tourEventId/uploads/:mediaId/urls',
  handle(async (req, res) => {
    const media = await ensurePendingMedia(req, res);
    if (!media) return;
    const out = await getUploadTargets(prisma, media, req.body || {});
    if (out.error) return res.status(out.status || 409).json({ error: out.error });
    res.set('Cache-Control', 'no-store');
    res.json(out);
  }),
);

// POST /:tourEventId/uploads/:mediaId/complete — verify + flip to ready.
router.post(
  '/:tourEventId/uploads/:mediaId/complete',
  handle(async (req, res) => {
    const media = await ensurePendingMedia(req, res);
    if (!media) return;
    const result = await completeUpload(prisma, media, req.body || {}, {
      origin: await userOrigin(req.adminAuth?.userId),
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.json(await mediaToClient(result.media));
  }),
);

// POST /:tourEventId/uploads/:mediaId/abort — drop a pending upload.
router.post(
  '/:tourEventId/uploads/:mediaId/abort',
  handle(async (req, res) => {
    const media = await ensurePendingMedia(req, res);
    if (!media) return;
    const result = await abortUpload(prisma, media);
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.status(204).end();
  }),
);

// POST /:tourEventId/media/delete — bulk soft-delete + R2 removal.
router.post(
  '/:tourEventId/media/delete',
  handle(async (req, res) => {
    const tour = await ensureTour(req, res);
    if (!tour) return;
    const u = await officeUploader(req);
    const result = await deleteMediaBatch(prisma, {
      tourEventId: tour.id,
      ids: req.body?.ids,
      deletedById: req.adminAuth?.userId || null,
      deletedByLabel: u.label,
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.json(result);
  }),
);

// ---------- single download (presigned redirect, friendly filename) ----------

router.get(
  '/:tourEventId/media/:mediaId/download',
  handle(async (req, res) => {
    const media = await prisma.tourMedia.findFirst({
      where: {
        id: req.params.mediaId,
        tourEventId: req.params.tourEventId,
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
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  }),
);

export default router;
