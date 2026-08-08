import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import { mayModifyMedia, resolvePublicGalleryAccess } from '../media/access.js';
import { removeMediaFromGallery } from '../media/usage.js';
import { galleryPublicText } from '../media/galleries.js';
import { initiateGalleryUpload } from '../media/uploads.js';
import { GALLERY_AUDIT_ACTIONS, recordGalleryAudit } from '../media/audit.js';
import {
  buildGalleryTitle,
  galleryCustomerLabel,
  getGallerySettings,
} from '../tours/gallery/service.js';
import {
  abortUpload,
  completeUpload,
  getUploadTargets,
  initiateUploadBatch,
} from '../tours/gallery/uploads.js';
import { requestExport } from '../tours/gallery/exports.js';
import { glog, maskToken } from '../tours/gallery/log.js';
import { getQuoteTemplate } from '../quote/quoteTemplate.js';

// The ONE brand logo source (same as the Quote cover): the official asset
// uploaded in Quote Structure (hero.logo.url); null → client renders the
// bundled SVG lockup — identical precedence to the quote renderer.
async function brandLogoUrl() {
  try {
    const template = await getQuoteTemplate(prisma);
    return template?.hero?.logo?.url || null;
  } catch {
    return null; // branding must never break the gallery
  }
}

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

// ONE resolver for both gallery kinds. A tour token is delegated to the proven
// tour rules (guide/staff audiences, cancellation, portal switches); a
// standalone token resolves against the gallery's own permission matrix. Every
// refusal is the same 404 either way.
async function guard(req, res) {
  const access = await resolvePublicGalleryAccess(prisma, { token: req.params.token });
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
      // A standalone gallery is CURATED: the operator's manual arrangement is
      // the point, so sortOrder leads. Tour galleries stay chronological —
      // reordering an event's photos was never their job.
      orderBy: access.gallery.tourEventId
        ? [{ capturedAt: 'asc' }, { completedAt: 'asc' }]
        : [{ sortOrder: 'asc' }, { completedAt: 'asc' }],
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
    // ── Standalone gallery: its own bilingual text, its own permissions ─────
    // The visitor picks the language; the media is shared between them.
    if (!access.gallery.tourEventId) {
      const lang = String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'he';
      const { title, subtitle } = galleryPublicText(access.gallery, { lang });
      return res.json({
        kind: 'standalone',
        lang,
        defaultLanguage: access.defaultLanguage,
        title,
        subtitle,
        logoUrl: await brandLogoUrl(),
        brandingText: settings.publicBrandingText || null,
        canUpload: access.permissions.canUpload,
        canDownload: access.permissions.canDownload,
        canDelete: access.permissions.canDelete,
        canEdit: access.permissions.canEdit,
        coverUrl,
        media: await Promise.all(
          media.map(async (m) => ({
            ...(await mediaToClient(m)),
            captionHe: m.captionHe || null,
            captionEn: m.captionEn || null,
            // Whether THIS visitor may modify this item — computed server-side
            // so the client never has to infer ownership rules.
            mine: m.uploadedByType === 'customer' && m.uploadedByLinkId === access.link.id,
          })),
        ),
      });
    }

    // Display context for the header — the canonical customer-safe label:
    // organization name → ordering contact full name → null. NEVER Deal.title
    // (internal CRM wording must not reach a customer page).
    const customerLabel =
      access.tour.kind === 'group_slot' &&
      (access.tour.bookings || []).filter((b) => b.status === 'active').length > 1
        ? null
        : galleryCustomerLabel(access.tour);
    res.json({
      title: buildGalleryTitle(access.tour),
      logoUrl: await brandLogoUrl(),
      productName: access.tour.product?.nameHe || 'סיור',
      customerLabel,
      kind: access.tour.kind,
      date: access.tour.date,
      startTime: access.tour.startTime,
      locationName:
        access.tour.location?.nameHe || access.tour.productVariant?.location?.nameHe || null,
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
    // Attribution comes from the resolved link, never hardcoded: a customer
    // link uploads as 'לקוח', a guide's staff link uploads as the guide.
    const result = access.gallery.tourEventId
      ? await initiateUploadBatch(prisma, {
          tour: access.tour,
          uploader: access.uploader,
          files: req.body?.files,
        })
      : await initiateGalleryUpload(prisma, {
          gallery: access.gallery,
          uploader: access.uploader,
          files: req.body?.files,
        });
    if (result.error) return res.status(409).json({ error: result.error });
    await recordGalleryAudit(prisma, {
      galleryId: access.gallery.id,
      action: GALLERY_AUDIT_ACTIONS.upload,
      actorType: 'external',
      linkId: access.link.id,
      req,
      detail: { accepted: result.accepted?.length || 0, rejected: result.rejected?.length || 0 },
    });
    res.status(201).json(result);
  }),
);

// Timeline origin for link-authenticated actions — labeled by who the link
// belongs to, so a guide's upload never reads as a customer action.
function linkOrigin(access) {
  const label = access.uploader.type === 'guide'
    ? `מדריך · ${access.uploader.label}`
    : 'לקוח (קישור גלריה)';
  return { actorType: 'api', actorLabel: label, createdBy: null, createdByName: null };
}

// A link holder may only touch PENDING rows created through THEIR link — never
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
      origin: linkOrigin(access),
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
    if (!access.permissions.canDownload) return res.status(403).json({ error: 'not_allowed' });
    // "Download all" builds a ZIP into the gallery's R2 prefix, and the archive
    // is purged by the cleanup worker keyed on tourEventId. A standalone
    // gallery has no such key, so enabling this today would write archives that
    // nothing ever expires — a silent storage leak. Refused honestly until the
    // export pipeline is re-keyed on galleryId; the client hides the button on
    // this signal rather than offering an action that fails.
    if (!access.gallery.tourEventId) {
      return res.status(409).json({ error: 'export_not_supported_for_gallery' });
    }
    const result = await requestExport(prisma, {
      tourEventId: access.tour.id,
      gallery: access.gallery,
      requestedBy: { type: access.uploader.type, linkId: access.link.id },
      origin: linkOrigin(access),
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
    // Download permission is enforced HERE, not by hiding the button. A tour
    // gallery always permits it; a standalone gallery may not, and this route
    // is the only thing standing between a guessed URL and the bytes.
    if (!access.permissions.canDownload) return res.status(403).json({ error: 'not_allowed' });
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage_not_configured' });
    const url = await r2.presignGet({
      key: media.objectKey,
      expiresIn: 300,
      downloadName: media.originalFileName,
    });
    res.redirect(302, url);
  }),
);

// ---------- external delete / edit (standalone galleries only) ----------
//
// Both are deliberately narrow: a visitor may act on media THEIR OWN link
// uploaded, and nothing else. Deleting removes the visitor's contribution from
// the gallery; it never destroys an asset that is used elsewhere, because the
// removal goes through the reference-aware path.

async function ownMedia(req, res, access) {
  const media = await prisma.tourMedia.findFirst({
    where: { id: req.params.mediaId, galleryId: access.gallery.id, deletedAt: null },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (!mayModifyMedia(access, media)) {
    // Reached a real gallery, may not touch this item → 403, distinct from the
    // 404 that hides a gallery's existence.
    res.status(403).json({ error: 'not_allowed' });
    return null;
  }
  return media;
}

router.delete(
  '/:token/media/:mediaId',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (access.gallery.tourEventId) return res.status(403).json({ error: 'not_allowed' });
    if (!access.permissions.canDelete) return res.status(403).json({ error: 'not_allowed' });
    const media = await ownMedia(req, res, access);
    if (!media) return;
    await removeMediaFromGallery(prisma, {
      galleryId: access.gallery.id,
      mediaId: media.id,
      actorId: null,
    });
    await recordGalleryAudit(prisma, {
      galleryId: access.gallery.id,
      action: GALLERY_AUDIT_ACTIONS.delete,
      actorType: 'external',
      linkId: access.link.id,
      mediaId: media.id,
      req,
    });
    res.json({ ok: true });
  }),
);

router.patch(
  '/:token/media/:mediaId',
  handle(async (req, res) => {
    const access = await guard(req, res);
    if (!access) return;
    if (access.gallery.tourEventId) return res.status(403).json({ error: 'not_allowed' });
    if (!access.permissions.canEdit) return res.status(403).json({ error: 'not_allowed' });
    const media = await ownMedia(req, res, access);
    if (!media) return;
    // The ONLY fields an external editor may touch. Captions are text the
    // visitor authored about their own upload — nothing structural, nothing
    // that could re-point the row at other storage.
    const data = {};
    if ('captionHe' in (req.body || {})) {
      data.captionHe = String(req.body.captionHe || '').trim().slice(0, 500) || null;
    }
    if ('captionEn' in (req.body || {})) {
      data.captionEn = String(req.body.captionEn || '').trim().slice(0, 500) || null;
    }
    if (Object.keys(data).length === 0) return res.status(422).json({ error: 'nothing_to_update' });
    const updated = await prisma.tourMedia.update({ where: { id: media.id }, data });
    await recordGalleryAudit(prisma, {
      galleryId: access.gallery.id,
      action: GALLERY_AUDIT_ACTIONS.edit,
      actorType: 'external',
      linkId: access.link.id,
      mediaId: media.id,
      req,
      detail: { fields: Object.keys(data) },
    });
    res.json({ captionHe: updated.captionHe, captionEn: updated.captionEn });
  }),
);

export default router;
