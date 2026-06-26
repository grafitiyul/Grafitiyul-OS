import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Product catalog + Product Variants (Product × Location) + variant gallery.
// Products own bilingual name + rich marketing descriptions (no pricing). The
// variant owns all product-location detail, guide-pay defaults (BigInt minor
// units), and per-format availability. Images reference MediaFile (R2).

const router = Router();

function toMinor(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}
function str(v) {
  return v ? String(v).trim() : null;
}

const VARIANT_INCLUDE = {
  location: { select: { id: true, nameHe: true, nameEn: true } },
  meetingPointImage: true,
  galleryImages: {
    orderBy: { sortOrder: 'asc' },
    include: { mediaFile: true },
  },
};

// ---------- Products ----------

router.get(
  '/',
  handle(async (_req, res) => {
    const products = await prisma.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: { _count: { select: { variants: true } } },
    });
    res.json(products);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: VARIANT_INCLUDE,
        },
      },
    });
    if (!product) return res.status(404).json({ error: 'not_found' });
    res.json(product);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.product.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const product = await prisma.product.create({
      data: {
        nameHe,
        nameEn: str(req.body?.nameEn),
        marketingDescHe: str(req.body?.marketingDescHe),
        marketingDescEn: str(req.body?.marketingDescEn),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(product);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) {
      const v = String(b.nameHe).trim();
      if (!v) return res.status(400).json({ error: 'nameHe_required' });
      data.nameHe = v;
    }
    if (b.nameEn !== undefined) data.nameEn = str(b.nameEn);
    if (b.marketingDescHe !== undefined) data.marketingDescHe = str(b.marketingDescHe);
    if (b.marketingDescEn !== undefined) data.marketingDescEn = str(b.marketingDescEn);
    if (b.active !== undefined) data.active = !!b.active;
    const product = await prisma.product.update({ where: { id: req.params.id }, data });
    res.json(product);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Variants cascade. MediaFiles are NOT deleted here (shared metadata; R2
    // cleanup happens via the media-files route / a future sweep).
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Variants ----------

function variantData(b) {
  const data = {};
  const setStr = (k) => { if (b[k] !== undefined) data[k] = str(b[k]); };
  ['marketingDescHe','marketingDescEn','guideDescHe','guideDescEn',
   'meetingPointHe','meetingPointEn','endingPointHe','endingPointEn'].forEach(setStr);
  if (b.durationHours !== undefined)
    data.durationHours = b.durationHours === '' || b.durationHours == null ? null : Number(b.durationHours);
  if (b.meetingPointImageId !== undefined)
    data.meetingPointImageId = b.meetingPointImageId || null;
  if (b.baseGuidePaymentMinor !== undefined)
    data.baseGuidePaymentMinor = toMinor(b.baseGuidePaymentMinor) ?? 0n;
  if (b.travelPaymentMinor !== undefined)
    data.travelPaymentMinor = toMinor(b.travelPaymentMinor);
  if (b.currency !== undefined) data.currency = String(b.currency).trim() || 'ILS';
  ['availablePublic','availablePrivate','availableBusiness','active'].forEach((k) => {
    if (b[k] !== undefined) data[k] = !!b[k];
  });
  return data;
}

router.post(
  '/:id/variants',
  handle(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ error: 'product_not_found' });
    const locationId = String(req.body?.locationId || '').trim();
    if (!locationId) return res.status(400).json({ error: 'locationId_required' });
    const last = await prisma.productVariant.findFirst({
      where: { productId: product.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    try {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          locationId,
          ...variantData(req.body || {}),
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        include: VARIANT_INCLUDE,
      });
      res.status(201).json(variant);
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'variant_exists_for_location' });
      throw e;
    }
  }),
);

router.put(
  '/variants/:variantId',
  handle(async (req, res) => {
    const variant = await prisma.productVariant.update({
      where: { id: req.params.variantId },
      data: variantData(req.body || {}),
      include: VARIANT_INCLUDE,
    });
    res.json(variant);
  }),
);

router.delete(
  '/variants/:variantId',
  handle(async (req, res) => {
    await prisma.productVariant.delete({ where: { id: req.params.variantId } });
    res.status(204).end();
  }),
);

// ---------- Variant gallery ----------

router.post(
  '/variants/:variantId/images',
  handle(async (req, res) => {
    const mediaFileId = String(req.body?.mediaFileId || '').trim();
    if (!mediaFileId) return res.status(400).json({ error: 'mediaFileId_required' });
    const last = await prisma.productVariantImage.findFirst({
      where: { productVariantId: req.params.variantId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    await prisma.productVariantImage.create({
      data: {
        productVariantId: req.params.variantId,
        mediaFileId,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId },
      include: VARIANT_INCLUDE,
    });
    res.status(201).json(variant);
  }),
);

router.delete(
  '/variants/images/:imageId',
  handle(async (req, res) => {
    const link = await prisma.productVariantImage.findUnique({
      where: { id: req.params.imageId },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    await prisma.productVariantImage.delete({ where: { id: link.id } });
    const variant = await prisma.productVariant.findUnique({
      where: { id: link.productVariantId },
      include: VARIANT_INCLUDE,
    });
    res.json(variant);
  }),
);

export default router;
