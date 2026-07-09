import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Quote Image Library — reusable presentation images for quote documents.
// An image is an independent entity (media + titles + applicable locations),
// the single source of truth. Product Variants only REFERENCE library images
// per quote position (see products.js PUT /variants/:variantId/quote-images).
// Media bytes live in R2 via MediaFile (upload through /api/media-files).

export const QUOTE_IMAGE_POSITIONS = ['hero', 'slot1', 'slot2'];

const router = Router();

const IMAGE_INCLUDE = {
  mediaFile: { select: { id: true, url: true } },
  locations: { select: { locationId: true } },
  variantLinks: { select: { productVariantId: true, position: true } },
};

function str(v) {
  return v ? String(v).trim() || null : null;
}

// API shape: flat, with locationIds + usage (who references this image) so the
// library UI can filter pickers and warn before delete.
function shape(img) {
  return {
    id: img.id,
    titleHe: img.titleHe,
    titleEn: img.titleEn,
    description: img.description,
    tags: img.tags || [],
    mediaFile: img.mediaFile ? { id: img.mediaFile.id, url: img.mediaFile.url } : null,
    locationIds: (img.locations || []).map((l) => l.locationId),
    usage: (img.variantLinks || []).map((l) => ({ variantId: l.productVariantId, position: l.position })),
    createdAt: img.createdAt,
    updatedAt: img.updatedAt,
  };
}

// Only keep location ids that actually exist (stale/foreign ids are dropped
// silently — tagging is organizational metadata, not a hard invariant).
async function validLocationIds(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((v) => typeof v === 'string' && v.trim()))];
  if (!wanted.length) return [];
  const rows = await prisma.location.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  const existing = new Set(rows.map((r) => r.id));
  return wanted.filter((id) => existing.has(id));
}

router.get(
  '/',
  handle(async (_req, res) => {
    const images = await prisma.quoteImage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: IMAGE_INCLUDE,
    });
    res.json(images.map(shape));
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const mediaFileId = String(b.mediaFileId || '').trim();
    if (!mediaFileId) return res.status(400).json({ error: 'mediaFileId_required' });
    const media = await prisma.mediaFile.findUnique({ where: { id: mediaFileId }, select: { id: true } });
    if (!media) return res.status(400).json({ error: 'media_file_not_found' });
    const locationIds = await validLocationIds(b.locationIds);
    const created = await prisma.quoteImage.create({
      data: {
        mediaFileId,
        titleHe: str(b.titleHe),
        titleEn: str(b.titleEn),
        description: str(b.description),
        locations: { create: locationIds.map((locationId) => ({ locationId })) },
      },
      include: IMAGE_INCLUDE,
    });
    res.status(201).json(shape(created));
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.quoteImage.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (b.titleHe !== undefined) data.titleHe = str(b.titleHe);
    if (b.titleEn !== undefined) data.titleEn = str(b.titleEn);
    if (b.description !== undefined) data.description = str(b.description);
    if (b.mediaFileId !== undefined) {
      const mediaFileId = String(b.mediaFileId || '').trim();
      if (!mediaFileId) return res.status(400).json({ error: 'mediaFileId_required' });
      const media = await prisma.mediaFile.findUnique({ where: { id: mediaFileId }, select: { id: true } });
      if (!media) return res.status(400).json({ error: 'media_file_not_found' });
      data.mediaFileId = mediaFileId;
    }
    if (b.locationIds !== undefined) {
      const locationIds = await validLocationIds(b.locationIds);
      data.locations = { deleteMany: {}, create: locationIds.map((locationId) => ({ locationId })) };
    }
    const updated = await prisma.quoteImage.update({
      where: { id: req.params.id },
      data,
      include: IMAGE_INCLUDE,
    });
    res.json(shape(updated));
  }),
);

// Deleting a library image cascades its variant references — affected quotes
// simply stop showing it. The client surfaces usage counts before confirming.
// The MediaFile row / R2 object are NOT touched (shared media, orphan sweep is
// a separate concern — same rule as everywhere else in GOS).
router.delete(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.quoteImage.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await prisma.quoteImage.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
