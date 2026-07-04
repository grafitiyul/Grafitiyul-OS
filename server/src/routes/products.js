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

// Business invariant (permanent architecture rule): a Product is usable/sellable
// only if it has at least one Variant (Product × Location). This single helper is
// the source of truth for that check; the create flow, the last-variant delete
// guard, and the pricing layer all rely on it instead of re-implementing it.
export async function productHasVariants(productId) {
  if (!productId) return true; // no product scope (wildcard) — nothing to enforce
  const n = await prisma.productVariant.count({ where: { productId } });
  return n > 0;
}

// PURE deletion verdict (no DB) so the safety rule is unit-testable. A Product is
// blocked from HARD delete when it carries COMMERCIAL history — deals or quote
// lines referencing it (or its variants). Those relations are onDelete:SetNull,
// so a hard delete would silently detach real deals/quotes from their product;
// we refuse and steer the user to Archive instead. Catalog-only relations
// (variants, price rules) cascade and are surfaced as `cascades`, not blockers.
export function productDeletionVerdict({ deals = 0, quoteLines = 0 } = {}) {
  const blockers = [];
  if (deals > 0) blockers.push({ kind: 'deals', count: deals });
  if (quoteLines > 0) blockers.push({ kind: 'quoteLines', count: quoteLines });
  return { blockers, canHardDelete: blockers.length === 0 };
}

// Full relations audit for one product: counts + the pure verdict. Returns null
// when the product doesn't exist.
async function productDeletionAudit(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, nameHe: true, active: true, variants: { select: { id: true } } },
  });
  if (!product) return null;
  const variantIds = product.variants.map((v) => v.id);
  const inVariants = variantIds.length ? { in: variantIds } : undefined;
  const [productPriceRules, variantPriceRules, deals, quoteLines] = await Promise.all([
    prisma.priceRule.count({ where: { productId: id } }),
    inVariants ? prisma.priceRule.count({ where: { productVariantId: inVariants } }) : 0,
    prisma.deal.count({
      where: { OR: [{ productId: id }, ...(inVariants ? [{ productVariantId: inVariants }] : [])] },
    }),
    inVariants ? prisma.quoteLine.count({ where: { productVariantId: inVariants } }) : 0,
  ]);
  const priceRules = productPriceRules + variantPriceRules;
  const verdict = productDeletionVerdict({ deals, quoteLines });
  return {
    productId: id,
    nameHe: product.nameHe,
    active: product.active,
    counts: { variants: variantIds.length, priceRules, deals, quoteLines },
    // What a hard delete would permanently remove (cascade), for the confirmation UI.
    cascades: { variants: variantIds.length, priceRules },
    ...verdict,
  };
}

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
    // Invariant: a Product must have at least one Variant (Location). We require
    // an initial location and create the product + its first variant in ONE
    // transaction, so the API can never produce an unusable (zero-variant)
    // product. Callers must create a Location first (locationId_required /
    // location_not_found surface that clearly).
    const locationId = String(req.body?.locationId || '').trim();
    if (!locationId) return res.status(400).json({ error: 'locationId_required' });
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!location) return res.status(400).json({ error: 'location_not_found' });

    const last = await prisma.product.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          nameHe,
          nameEn: str(req.body?.nameEn),
          marketingDescHe: str(req.body?.marketingDescHe),
          marketingDescEn: str(req.body?.marketingDescEn),
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      await tx.productVariant.create({
        data: { productId: product.id, locationId, sortOrder: 0 },
      });
      return product;
    });
    // Return the product WITH its first variant so the client lands on a usable
    // product (and the list count is correct).
    const full = await prisma.product.findUnique({
      where: { id: created.id },
      include: {
        variants: { orderBy: { sortOrder: 'asc' }, include: VARIANT_INCLUDE },
      },
    });
    res.status(201).json(full);
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

// Preflight: what references this product, and can it be hard-deleted? The UI
// reads this BEFORE showing the delete/archive choice, so nothing is destroyed
// blindly.
router.get(
  '/:id/relations',
  handle(async (req, res) => {
    const audit = await productDeletionAudit(req.params.id);
    if (!audit) return res.status(404).json({ error: 'not_found' });
    res.json(audit);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Never delete blindly: re-run the audit server-side (the client preflight is
    // convenience, not trust). A product with commercial history (deals / quote
    // lines) is refused — the caller must Archive (PUT active:false) instead.
    const audit = await productDeletionAudit(req.params.id);
    if (!audit) return res.status(404).json({ error: 'not_found' });
    if (!audit.canHardDelete) {
      return res.status(409).json({ error: 'has_commercial_references', audit });
    }
    // Safe path: no commercial history. Variants + price rules cascade (surfaced
    // as `audit.cascades` and confirmed in the UI). MediaFiles are NOT deleted
    // here (shared metadata; R2 cleanup happens via the media-files route).
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Variants ----------

function variantData(b) {
  const data = {};
  const setStr = (k) => { if (b[k] !== undefined) data[k] = str(b[k]); };
  ['marketingDescHe','marketingDescEn','guideDescHe','guideDescEn',
   'meetingPointHe','meetingPointEn','endingPointHe','endingPointEn',
   'programHe','programEn'].forEach(setStr);
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
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId },
      select: { id: true, productId: true },
    });
    if (!variant) return res.status(404).json({ error: 'not_found' });
    // Invariant: never leave a product with zero variants. Block deleting the
    // last one — the product must be deleted instead if it's no longer needed.
    const count = await prisma.productVariant.count({
      where: { productId: variant.productId },
    });
    if (count <= 1) return res.status(409).json({ error: 'last_variant' });
    await prisma.productVariant.delete({ where: { id: variant.id } });
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
