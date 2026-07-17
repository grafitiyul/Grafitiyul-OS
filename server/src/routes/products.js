import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { QUOTE_IMAGE_POSITIONS } from './quoteImages.js';
import { sanitizeComponentSelection } from '../tours/activityCatalog.js';
import { kickPayrollReconcile } from '../payroll/service.js';

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
  location: {
    select: {
      id: true,
      nameHe: true,
      nameEn: true,
      // The agent-form section shows the resolved commercial city
      // (parentLocation ?? location) so the owner sees what agents will see.
      parentLocation: { select: { id: true, nameHe: true } },
    },
  },
  meetingPointImage: true,
  galleryImages: {
    orderBy: { sortOrder: 'asc' },
    include: { mediaFile: true },
  },
  // Quote Image Library references (hero | slot1 | slot2) — the variant does
  // not own images; it points at shared library entries.
  quoteImageLinks: {
    orderBy: [{ position: 'asc' }, { sortOrder: 'asc' }],
    include: { quoteImage: { include: { mediaFile: { select: { id: true, url: true } } } } },
  },
  // Default Activity Components this variant delivers (ordered). Seeded onto a
  // TourEvent at creation from the SELECTED variant.
  activityComponents: {
    orderBy: { sortOrder: 'asc' },
    include: { activityComponent: true },
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

// Flat list of every Product Variant with product + location labels — used by the
// Quote Structure → Video tab to pick which variants a video is shown for.
// Registered BEFORE '/:id' so the literal path is not swallowed as a product id.
router.get(
  '/variant-options',
  handle(async (_req, res) => {
    const variants = await prisma.productVariant.findMany({
      orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        product: { select: { nameHe: true, nameEn: true } },
        location: { select: { nameHe: true, nameEn: true } },
      },
    });
    res.json(
      variants.map((v) => ({
        id: v.id,
        productNameHe: v.product?.nameHe || '',
        productNameEn: v.product?.nameEn || '',
        locationNameHe: v.location?.nameHe || '',
        locationNameEn: v.location?.nameEn || '',
      })),
    );
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
  // Agent-form presentation ("מוצג בטופס סוכנים") — presentation only.
  if (b.agentVisible !== undefined) data.agentVisible = !!b.agentVisible;
  ['agentDisplayName','agentDisplayNameEn','agentDescription'].forEach(setStr);
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
    const data = variantData(req.body || {});
    // A variant shown on the agent form MUST carry an agent display name —
    // an internal name can never leak to agents. Effective check across
    // partial updates (incoming value if sent, else the stored one).
    if (data.agentVisible !== undefined || data.agentDisplayName !== undefined) {
      const existing = await prisma.productVariant.findUnique({
        where: { id: req.params.variantId },
        select: { agentVisible: true, agentDisplayName: true },
      });
      if (!existing) return res.status(404).json({ error: 'not_found' });
      const effVisible = data.agentVisible ?? existing.agentVisible;
      const effName = data.agentDisplayName !== undefined ? data.agentDisplayName : existing.agentDisplayName;
      if (effVisible && !effName) {
        return res.status(422).json({ error: 'agent_display_name_required' });
      }
    }
    const variant = await prisma.productVariant.update({
      where: { id: req.params.variantId },
      data,
      include: VARIANT_INCLUDE,
    });
    // Pay rates (baseGuidePayment/travelPayment) may have moved — DRAFT
    // payroll activities on this variant's tours reconcile in the background.
    kickPayrollReconcile('variant', variant.id);
    res.json(variant);
  }),
);

// Replace a ProductVariant's ORDERED default activity components. Idempotent
// full-set write: body { componentIds: [...] } in the desired order. The set is
// sanitized against the catalog (dedupe, drop unknown, block newly-adding an
// inactive component — but keep an already-linked inactive one). Returns the
// resulting ordered links.
router.put(
  '/variants/:variantId/activity-components',
  handle(async (req, res) => {
    const variantId = req.params.variantId;
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) return res.status(404).json({ error: 'not_found' });

    const requested = Array.isArray(req.body?.componentIds) ? req.body.componentIds : [];
    const [catalog, existing] = await Promise.all([
      prisma.activityComponent.findMany({ select: { id: true, isActive: true } }),
      prisma.productVariantActivityComponent.findMany({
        where: { productVariantId: variantId },
        select: { activityComponentId: true },
      }),
    ]);
    const { ids } = sanitizeComponentSelection(requested, {
      validIds: catalog.map((c) => c.id),
      activeIds: catalog.filter((c) => c.isActive).map((c) => c.id),
      existingIds: existing.map((e) => e.activityComponentId),
    });

    await prisma.$transaction(async (tx) => {
      await tx.productVariantActivityComponent.deleteMany({ where: { productVariantId: variantId } });
      for (let i = 0; i < ids.length; i++) {
        await tx.productVariantActivityComponent.create({
          data: { productVariantId: variantId, activityComponentId: ids[i], sortOrder: i },
        });
      }
    });

    const links = await prisma.productVariantActivityComponent.findMany({
      where: { productVariantId: variantId },
      orderBy: { sortOrder: 'asc' },
      include: { activityComponent: true },
    });
    res.json(links);
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

// ---------- Variant quote images (library references) ----------

// Replace-all write of the variant's Quote Image Library references.
// Body: { positions: { hero: [quoteImageId…], slot1: […], slot2: […] } }.
// Array order IS the display order. Unknown positions are ignored, stale
// library ids are dropped silently (the library is the source of truth).
router.put(
  '/variants/:variantId/quote-images',
  handle(async (req, res) => {
    const variantId = req.params.variantId;
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) return res.status(404).json({ error: 'not_found' });
    const positions = req.body?.positions;
    if (!positions || typeof positions !== 'object')
      return res.status(400).json({ error: 'positions_required' });

    const rows = [];
    for (const position of QUOTE_IMAGE_POSITIONS) {
      const ids = Array.isArray(positions[position]) ? positions[position] : [];
      const seen = new Set();
      let sortOrder = 0;
      for (const raw of ids) {
        const quoteImageId = typeof raw === 'string' ? raw.trim() : '';
        if (!quoteImageId || seen.has(quoteImageId)) continue;
        seen.add(quoteImageId);
        rows.push({ productVariantId: variantId, quoteImageId, position, sortOrder: sortOrder++ });
      }
    }
    const wanted = [...new Set(rows.map((r) => r.quoteImageId))];
    const existing = wanted.length
      ? new Set(
          (await prisma.quoteImage.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((x) => x.id),
        )
      : new Set();
    const valid = rows.filter((r) => existing.has(r.quoteImageId));

    await prisma.$transaction([
      prisma.productVariantQuoteImage.deleteMany({ where: { productVariantId: variantId } }),
      ...(valid.length ? [prisma.productVariantQuoteImage.createMany({ data: valid })] : []),
    ]);
    const updated = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: VARIANT_INCLUDE,
    });
    res.json(updated);
  }),
);

// ---------- Variant gallery ----------
// LEGACY: uploads are no longer offered in the UI (the Quote Image Library
// replaced per-variant uploads). Endpoints kept for the remaining legacy data
// (hero fallback still reads galleryImages) until a dedicated cleanup slice.

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
