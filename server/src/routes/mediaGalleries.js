import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';
import {
  createGallery,
  ensureGalleryLink,
  externalPermissions,
  galleryMedia,
  galleryPublicText,
  getActiveLink,
  listGalleries,
  reorderGalleryMedia,
  rotateGalleryLink,
  setGalleryArchived,
  setGalleryLinkEnabled,
  updateGallery,
} from '../media/galleries.js';
import { initiateGalleryUpload } from '../media/uploads.js';
import { isGarbageCollectable, removeMediaFromGallery } from '../media/usage.js';
import { GALLERY_AUDIT_ACTIONS, recordGalleryAudit } from '../media/audit.js';
import { completeUpload, getUploadTargets } from '../tours/gallery/uploads.js';
import { publicOrigin } from '../communication/context.js';

// Operator surface for STANDALONE media galleries ("תיקיות תמונות וסרטונים").
// Mounted behind requireAdminAuth. Tour galleries are deliberately NOT managed
// here — they live inside their tour, where their identity comes from.

const router = Router();

const actorId = (req) => req.adminAuth?.userId || null;

async function loadStandalone(req, res) {
  const gallery = await prisma.tourGallery.findUnique({ where: { id: req.params.id } });
  if (!gallery || gallery.tourEventId) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return gallery;
}

// Admin-side media shape: unlike the customer serializer this DOES carry
// uploader attribution, because deciding what to keep is the operator's job.
async function mediaToAdmin(m) {
  const out = {
    id: m.id,
    mediaType: m.mediaType,
    mimeType: m.mimeType,
    originalFileName: m.originalFileName,
    byteSize: m.byteSize == null ? null : Number(m.byteSize),
    width: m.width,
    height: m.height,
    durationSeconds: m.durationSeconds,
    sortOrder: m.sortOrder,
    captionHe: m.captionHe || null,
    captionEn: m.captionEn || null,
    uploadedByType: m.uploadedByType,
    uploadedByLabel: m.uploadedByLabel || null,
    createdAt: m.createdAt,
    storageStrategy: m.storageStrategy,
    thumbUrl: null,
    posterUrl: null,
    viewUrl: null,
  };
  if (r2.isConfigured() && m.objectKey) {
    if (m.thumbKey) out.thumbUrl = await r2.presignGet({ key: m.thumbKey, expiresIn: 3600 });
    if (m.posterKey) out.posterUrl = await r2.presignGet({ key: m.posterKey, expiresIn: 3600 });
    out.viewUrl = await r2.presignGet({ key: m.objectKey, expiresIn: 3600 });
  }
  return out;
}

function publicUrlFor(link) {
  if (!link) return null;
  const origin = publicOrigin();
  return origin ? `${origin}/g/${encodeURIComponent(link.token)}` : null;
}

function linkDto(link) {
  if (!link) return null;
  return {
    token: link.token,
    status: link.status,
    url: publicUrlFor(link),
    disabledAt: link.disabledAt || null,
    createdAt: link.createdAt,
  };
}

// ---------- list / create ----------

router.get(
  '/',
  handle(async (req, res) => {
    const rows = await listGalleries(prisma, {
      includeArchived: String(req.query.includeArchived || '') === 'true',
      search: req.query.search || '',
    });
    res.json({
      galleries: rows.map((g) => ({
        id: g.id,
        internalName: g.internalName,
        titleHe: g.titleHe,
        titleEn: g.titleEn,
        status: g.status,
        imageCount: g.imageCount,
        videoCount: g.videoCount,
        permissions: g.permissions,
        link: g.link ? { ...g.link, url: publicUrlFor(g.link) } : null,
        updatedAt: g.updatedAt,
      })),
    });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const gallery = await createGallery(prisma, { ...(req.body || {}), createdById: actorId(req) });
    // A gallery without a link is not shareable, and every operator's next
    // click would be "create link". Minting it here removes a step that has no
    // decision in it.
    const { link } = await ensureGalleryLink(prisma, gallery.id, { createdById: actorId(req) });
    res.status(201).json({ id: gallery.id, link: linkDto(link) });
  }),
);

// ---------- one gallery ----------

router.get(
  '/:id',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const [media, link] = await Promise.all([
      galleryMedia(prisma, gallery.id),
      getActiveLink(prisma, gallery.id),
    ]);
    res.json({
      id: gallery.id,
      internalName: gallery.internalName,
      titleHe: gallery.titleHe,
      titleEn: gallery.titleEn,
      subtitleHe: gallery.subtitleHe,
      subtitleEn: gallery.subtitleEn,
      defaultLanguage: gallery.defaultLanguage || 'he',
      status: gallery.status,
      permissions: externalPermissions(gallery),
      link: linkDto(link),
      // What a visitor actually sees, in both languages — so the operator can
      // check the customer-facing result without opening the public page.
      preview: {
        he: galleryPublicText(gallery, { lang: 'he' }),
        en: galleryPublicText(gallery, { lang: 'en' }),
      },
      media: await Promise.all(media.map(mediaToAdmin)),
    });
  }),
);

router.patch(
  '/:id',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const updated = await updateGallery(prisma, gallery.id, req.body || {}, {
      actorId: actorId(req),
      req,
    });
    res.json({ id: updated.id, status: updated.status });
  }),
);

router.post(
  '/:id/archive',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const archived = req.body?.archived !== false;
    const updated = await setGalleryArchived(prisma, gallery.id, archived, {
      actorId: actorId(req),
      req,
    });
    res.json({ id: updated.id, status: updated.status });
  }),
);

// ---------- public link ----------

router.post(
  '/:id/link/rotate',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const link = await rotateGalleryLink(prisma, gallery.id, { actorId: actorId(req), req });
    res.json({ link: linkDto(link) });
  }),
);

router.post(
  '/:id/link/enabled',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const enabled = req.body?.enabled !== false;
    await setGalleryLinkEnabled(prisma, gallery.id, enabled, { actorId: actorId(req), req });
    const link = await getActiveLink(prisma, gallery.id);
    res.json({ link: linkDto(link) });
  }),
);

// ---------- uploads (office) ----------

router.post(
  '/:id/uploads',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const result = await initiateGalleryUpload(prisma, {
      gallery,
      uploader: { type: 'office', userId: actorId(req), label: null },
      files: req.body?.files,
    });
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result);
  }),
);

async function galleryMediaRow(req, res, gallery) {
  const media = await prisma.tourMedia.findFirst({
    where: { id: req.params.mediaId, galleryId: gallery.id, deletedAt: null },
  });
  if (!media) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return media;
}

router.post(
  '/:id/uploads/:mediaId/urls',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const media = await galleryMediaRow(req, res, gallery);
    if (!media) return;
    const out = await getUploadTargets(prisma, media, req.body || {});
    if (out.error) return res.status(out.status || 409).json({ error: out.error });
    res.json(out);
  }),
);

router.post(
  '/:id/uploads/:mediaId/complete',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const media = await galleryMediaRow(req, res, gallery);
    if (!media) return;
    const result = await completeUpload(prisma, media, req.body || {}, {
      origin: {
        actorType: 'admin',
        actorLabel: null,
        createdBy: actorId(req),
        createdByName: null,
      },
    });
    if (result.error) return res.status(result.status || 409).json({ error: result.error });
    res.json(result);
  }),
);

// ---------- media management ----------

router.post(
  '/:id/media/reorder',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const count = await reorderGalleryMedia(prisma, gallery.id, req.body?.orderedIds || []);
    res.json({ ok: true, reordered: count });
  }),
);

router.patch(
  '/:id/media/:mediaId',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const media = await galleryMediaRow(req, res, gallery);
    if (!media) return;
    const data = {};
    for (const k of ['captionHe', 'captionEn']) {
      if (k in (req.body || {})) {
        data[k] = String(req.body[k] || '').trim().slice(0, 500) || null;
      }
    }
    if (Object.keys(data).length === 0) return res.status(422).json({ error: 'nothing_to_update' });
    await prisma.tourMedia.update({ where: { id: media.id }, data });
    res.json({ ok: true });
  }),
);

/**
 * Remove an item from the gallery.
 *
 * Removal is reference-aware by default: the membership goes, the asset
 * survives. Physically destroying the bytes requires BOTH an explicit
 * `?deleteAsset=true` and the asset being referenced nowhere else — so a
 * curator tidying a gallery can never break a quote or another gallery that
 * shares the same file.
 */
router.delete(
  '/:id/media/:mediaId',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const media = await galleryMediaRow(req, res, gallery);
    if (!media) return;

    const wantsAssetDeleted = String(req.query.deleteAsset || '') === 'true';
    const gc = await isGarbageCollectable(prisma, media.id, {
      excludeRef: { refType: 'gallery', refId: gallery.id },
    });
    await removeMediaFromGallery(prisma, {
      galleryId: gallery.id,
      mediaId: media.id,
      actorId: actorId(req),
    });

    let assetDeleted = false;
    if (wantsAssetDeleted && gc.ok && r2.isConfigured() && media.objectKey) {
      await r2.deleteObject(media.objectKey);
      if (media.thumbKey) await r2.deleteObject(media.thumbKey);
      if (media.posterKey) await r2.deleteObject(media.posterKey);
      assetDeleted = true;
    }
    await recordGalleryAudit(prisma, {
      galleryId: gallery.id,
      action: GALLERY_AUDIT_ACTIONS.delete,
      actorType: 'office',
      actorId: actorId(req),
      mediaId: media.id,
      req,
      detail: { assetDeleted, stillReferenced: !gc.ok },
    });
    res.json({
      ok: true,
      assetDeleted,
      // Told plainly rather than silently ignored: the operator asked for the
      // file to go and deserves to know why it did not.
      stillReferencedBy: gc.ok ? [] : gc.refs,
    });
  }),
);

// ---------- audit ----------

router.get(
  '/:id/audit',
  handle(async (req, res) => {
    const gallery = await loadStandalone(req, res);
    if (!gallery) return;
    const events = await prisma.galleryAudit.findMany({
      where: { galleryId: gallery.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        actorType: e.actorType,
        mediaId: e.mediaId,
        detail: e.detail,
        createdAt: e.createdAt,
      })),
    });
  }),
);

export default router;
