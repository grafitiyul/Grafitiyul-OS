import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import { resolveCustomerGalleryAccess } from '../tours/gallery/access.js';
import { buildGalleryTitle, getGallerySettings } from '../tours/gallery/service.js';
import {
  abortUpload,
  completeUpload,
  getUploadTargets,
  initiateUploadBatch,
} from '../tours/gallery/uploads.js';
import { requestExport } from '../tours/gallery/exports.js';
import { glog, maskToken } from '../tours/gallery/log.js';

// PUBLIC customer gallery — mounted at /api/gallery, NO admin auth. The
// capability URL is the credential (same convention as quote/questionnaire
// links): the gallery identity ALWAYS derives from the token; a
// client-supplied tour id is never read. Exposure contract:
//   * the display title (product · date · customer) and the media — nothing
//     else. No internal ids, no Deal/Booking/CRM data, no uploader identity
//     beyond "צוות/אורח" wording client-side.
//   * customers can view / upload / download. NEVER delete, NEVER manage.
//   * revoked links and cancelled tours read as 404 — indistinguishable from
//     a wrong URL.
// All responses are no-store (inherits the global /api rule; set explicitly
// on the media payloads anyway since they carry presigned URLs).

const router = Router();

async function guard(req, res) {
  const access = await resolveCustomerGalleryAccess(prisma, { token: req.params.token });
  if (!access.ok) {
    // Masked token prefix only — enough to correlate a customer report with
    // a link row, never the credential itself.
    glog('customer_access_denied', {
      token: maskToken(req.params.token),
      status: access.status,
      reason: access.error,
      path: req.path.replace(req.params.token, '<token>'),
    });
    res.status(access.status).json({ error: access.error });
    return null;
  }
  res.set('Cache-Control', 'no-store');
  return access;
}

// Customer-facing media shape — deliberately narrower than the staff/guide
// serializers: no uploader identity, no filenames of other guests beyond the
// media's own display name (needed for downloads).
async function mediaToClient(m) {
  const out = {
    id: m.id,
    mediaType: m.mediaType,
    originalFileName: m.originalFileName,
    width: m.width,
    height: m.height,
    durationSeconds: m.durationSeconds,
    isCustomerUpload: m.uploadedByType === 'customer',
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

router.get(
  '/:token',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const settings = await getGallerySettings(prisma);
    const media = await prisma.tourMedia.findMany({
      where: { galleryId: access.gallery.id, deletedAt: null, uploadStatus: 'ready' },
      orderBy: [{ capturedAt: 'asc' }, { completedAt: 'asc' }],
    });
    // Hero = explicit cover if alive, else newest image (same fallback rule
    // as everywhere; resolved inline to keep one query round).
    const cover =
      (access.gallery.coverMediaId &&
        media.find((m) => m.id === access.gallery.coverMediaId)) ||
      [...media].reverse().find((m) => m.mediaType === 'image') ||
      null;
    let coverUrl = null;
    if (cover && r2.isConfigured()) {
      const key = cover.thumbKey || cover.posterKey || cover.objectKey;
      coverUrl = await r2.presignGet({ key, expiresIn: 3600 });
    }
    res.json({
      title: buildGalleryTitle(access.tour),
      date: access.tour.date,
      brandingText: settings.publicBrandingText || null,
      canUpload: access.permissions.canUpload,
      coverUrl,
      media: await Promise.all(media.map(mediaToClient)),
    });
  }),
);

// ---------- customer uploads (attributed, appear immediately) ----------

router.post(
  '/:token/uploads',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (!access.permissions.canUpload) return res.status(403).json({ error: 'uploads_disabled' });
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const result = await initiateUploadBatch(prisma, {
      tour: access.tour,
      uploader: { type: 'customer', linkId: access.link.id, label: 'לקוח' },
      files: req.body?.files,
    });
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result);
  }),
);

// A customer may only touch PENDING rows created through THEIR link — never
// other uploads in the gallery.
async function ownPendingMedia(req, res, access) {
  const media = await prisma.tourMedia.findFirst({
    where: {
      id: req.params.mediaId,
      galleryId: access.gallery.id,
      uploadedByLinkId: access.link.id,
      deletedAt: null,
    },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return media;
}

router.post(
  '/:token/uploads/:mediaId/urls',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await ownPendingMedia(req, res, access);
    if (!media) return;
    const out = await getUploadTargets(prisma, media, req.body || {});
    if (out.error) return res.status(out.status || 409).json({ error: out.error });
    res.json(out);
  }),
);

router.post(
  '/:token/uploads/:mediaId/complete',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await ownPendingMedia(req, res, access);
    if (!media) return;
    const result = await completeUpload(prisma, media, req.body || {}, {
      origin: { actorType: 'api', actorLabel: 'לקוח (קישור גלריה)', createdBy: null, createdByName: null },
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.json(await mediaToClient(result.media));
  }),
);

router.post(
  '/:token/uploads/:mediaId/abort',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await ownPendingMedia(req, res, access);
    if (!media) return;
    const result = await abortUpload(prisma, media);
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.status(204).end();
  }),
);

// ---------- "download all" (async export, customer-facing status) ----------
// The customer sees only { id, status, expiresAt } — no counts of pending
// jobs, no errors beyond a generic failure.

function exportToCustomer(job) {
  return {
    id: job.id,
    status: ['pending', 'running'].includes(job.status)
      ? 'preparing'
      : job.status === 'ready'
        ? 'ready'
        : 'failed',
    expiresAt: job.expiresAt,
  };
}

router.post(
  '/:token/export',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const result = await requestExport(prisma, {
      tourEventId: access.tour.id,
      gallery: access.gallery,
      requestedBy: { type: 'customer', linkId: access.link.id },
      origin: { actorType: 'api', actorLabel: 'לקוח (קישור גלריה)', createdBy: null, createdByName: null },
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.status(result.reused ? 200 : 201).json(exportToCustomer(result.export));
  }),
);

router.get(
  '/:token/export/:exportId',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const job = await prisma.tourGalleryExport.findFirst({
      where: { id: req.params.exportId, galleryId: access.gallery.id },
    });
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(exportToCustomer(job));
  }),
);

router.get(
  '/:token/export/:exportId/download',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const job = await prisma.tourGalleryExport.findFirst({
      where: { id: req.params.exportId, galleryId: access.gallery.id },
    });
    if (!job || job.status !== 'ready' || !job.archiveKey) {
      return res.status(404).json({ error: 'not_ready' });
    }
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage_not_configured' });
    const url = await r2.presignGet({
      key: job.archiveKey,
      expiresIn: 600,
      downloadName: 'grafitiyul-gallery.zip',
    });
    res.redirect(302, url);
  }),
);

// ---------- downloads (individual; "download all" is the async export) ----------

router.get(
  '/:token/media/:mediaId/download',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    const media = await prisma.tourMedia.findFirst({
      where: {
        id: req.params.mediaId,
        galleryId: access.gallery.id,
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
