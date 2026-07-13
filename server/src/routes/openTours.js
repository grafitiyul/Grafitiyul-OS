import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { ensureTourSlots } from '../tours/openTourGeneration.js';
import { buildGroupCards } from '../pricing/groupTicketCards.js';
import {
  buildTemplatePatch,
  buildRulePatch,
  buildExceptionPatch,
  normalizeTemplateProducts,
} from '../tours/openTourValidation.js';
import {
  applyExceptionToSlots,
  setManualProduct,
  clearManualProduct,
} from '../tours/occurrenceOverrides.js';
import { markCardSlotsPending, cardTicketRows } from '../tours/woo/mapping.js';
import { deriveCardStatus } from '../tours/woo/cardStatus.js';
import { kickWooSync, markTourWooPending } from '../tours/woo/service.js';
import { woo, wooConfigured, wooSyncActive, wooSyncBulkEnabled } from '../tours/woo/wooClient.js';
import { occupancyFor } from '../tours/occupancy.js';
import { israelToday } from '../tours/slotGeneration.js';
import { suggestWooConfig } from '../tours/woo/suggestConfig.js';

// Open Tours admin API (/api/open-tours) — CRUD for recurring tour TEMPLATES
// (the "what"), their offered sellable products, weekly SCHEDULE RULES (the
// "when"), and one-off EXCEPTIONS. Nothing here encodes a product name/id:
// offered products are Pricing Cards flagged availableForGroupTickets, chosen by
// the owner. After any change that affects generation we materialize slots
// immediately (sync-on-write), mirroring the tours router's sync-on-read.

const router = Router();

const TEMPLATE_INCLUDE = {
  location: { select: { id: true, nameHe: true } },
  products: {
    orderBy: { sortOrder: 'asc' },
    include: {
      productVariant: {
        select: {
          id: true,
          durationHours: true,
          product: { select: { id: true, nameHe: true } },
          location: { select: { id: true, nameHe: true } },
        },
      },
    },
  },
  scheduleRules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
  exceptions: { orderBy: { date: 'asc' } },
};

async function regenerate() {
  try {
    await ensureTourSlots(prisma);
  } catch (e) {
    console.error('[open-tours] slot generation failed', e);
  }
}

// ── Sellable products picker (Pricing Cards flagged for group tickets) ───────
router.get(
  '/sellable-products',
  handle(async (_req, res) => {
    const rules = await prisma.priceRule.findMany({
      where: { availableForGroupTickets: true, active: true },
      orderBy: [{ cardSortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: { select: { nameHe: true } },
        ticketPrices: { include: { ticketType: { select: { nameHe: true, sortOrder: true } } } },
      },
    });
    // Attach the representative rule id per card so the UI can persist a loose
    // pricing ref alongside cardGroupId + productVariantId.
    const repByGroup = new Map();
    for (const r of rules) if (r.cardGroupId && !repByGroup.has(r.cardGroupId)) repByGroup.set(r.cardGroupId, r.id);
    const { cards, unconfigured } = buildGroupCards(rules);
    res.json({
      cards: cards.map((c) => ({ ...c, priceRuleId: repByGroup.get(c.cardGroupId) || null })),
      unconfigured,
    });
  }),
);

// ── Templates ────────────────────────────────────────────────────────────────
router.get(
  '/',
  handle(async (_req, res) => {
    const templates = await prisma.openTourTemplate.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      include: TEMPLATE_INCLUDE,
    });
    res.json(templates);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({
      where: { id: req.params.id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) return res.status(404).json({ error: 'not_found' });
    res.json(template);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { data, error } = buildTemplatePatch(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    // Optional nested products on create.
    let productRows = [];
    if (req.body?.products !== undefined) {
      const norm = normalizeTemplateProducts(req.body.products);
      if (norm.error) return res.status(400).json({ error: norm.error });
      productRows = norm.rows;
    }
    const template = await prisma.openTourTemplate.create({
      data: { ...data, products: productRows.length ? { create: productRows } : undefined },
      include: TEMPLATE_INCLUDE,
    });
    res.status(201).json(template);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildTemplatePatch(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const template = await prisma.openTourTemplate.update({
      where: { id: existing.id },
      data,
      include: TEMPLATE_INCLUDE,
    });
    await regenerate(); // capacity/language/etc. affect FUTURE slots only
    res.json(template);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Already-generated slots survive (loose openTourTemplateId ref) — deleting
    // a template (cascades its rules/exceptions/products) only stops FUTURE
    // generation, exactly like deleting a schedule rule.
    await prisma.openTourTemplate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Offered products (replace-sync) ─────────────────────────────────────────
router.put(
  '/:id/products',
  handle(async (req, res) => {
    const existing = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const norm = normalizeTemplateProducts(req.body?.products);
    if (norm.error) return res.status(400).json({ error: norm.error });
    await prisma.$transaction([
      prisma.openTourTemplateProduct.deleteMany({ where: { templateId: existing.id } }),
      ...(norm.rows.length
        ? [
            prisma.openTourTemplateProduct.createMany({
              data: norm.rows.map((r) => ({ ...r, templateId: existing.id })),
            }),
          ]
        : []),
    ]);
    await regenerate(); // base product change affects the zero-registration state
    const template = await prisma.openTourTemplate.findUnique({
      where: { id: existing.id },
      include: TEMPLATE_INCLUDE,
    });
    res.json(template);
  }),
);

// ── Schedule rules ───────────────────────────────────────────────────────────
router.post(
  '/:id/rules',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildRulePatch(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    const rule = await prisma.openTourScheduleRule.create({
      data: { ...data, templateId: template.id },
    });
    await regenerate();
    res.status(201).json(rule);
  }),
);

router.put(
  '/rules/:ruleId',
  handle(async (req, res) => {
    const existing = await prisma.openTourScheduleRule.findUnique({ where: { id: req.params.ruleId } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildRulePatch(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    // Recipe changes apply to FUTURE generation only — already-created slots are
    // real TourEvents and stay as they are (edited individually if needed).
    const rule = await prisma.openTourScheduleRule.update({ where: { id: existing.id }, data });
    await regenerate();
    res.json(rule);
  }),
);

router.delete(
  '/rules/:ruleId',
  handle(async (req, res) => {
    await prisma.openTourScheduleRule.delete({ where: { id: req.params.ruleId } });
    res.status(204).end();
  }),
);

// ── Exceptions ───────────────────────────────────────────────────────────────
router.post(
  '/:id/exceptions',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildExceptionPatch(req.body);
    if (error) return res.status(400).json({ error });
    // Upsert on the (templateId, date, type) unique — re-adding the same
    // exception updates its time/note instead of failing.
    const exception = await prisma.openTourScheduleException.upsert({
      where: { templateId_date_type: { templateId: template.id, date: data.date, type: data.type } },
      create: { ...data, templateId: template.id },
      update: { time: data.time, note: data.note },
    });
    // Two effects: generation materializes an 'add' occurrence (sync-on-write),
    // and cancel/time_override reconcile ALREADY-materialized slots (the cursor
    // only shapes future dates). `applied` reports what changed on live slots
    // (e.g. slots with registrations are skipped, not silently cancelled).
    await regenerate();
    const applied = await applyExceptionToSlots(prisma, template.id, exception);
    res.status(201).json({ ...exception, applied });
  }),
);

// ── Occurrence-level manual product override ─────────────────────────────────
// Pin a generated slot's operational product against the registration-driven
// derivation, or release the pin to re-derive. This is the "change product
// manually if really necessary" override.
router.post(
  '/occurrences/:tourEventId/product',
  handle(async (req, res) => {
    const productVariantId = req.body?.productVariantId;
    if (!productVariantId) return res.status(400).json({ error: 'missing_product_variant' });
    try {
      await setManualProduct(prisma, req.params.tourEventId, productVariantId);
    } catch (e) {
      if (e.code === 'invalid_product_variant' || e.code === 'not_a_group_slot') {
        return res.status(400).json({ error: e.code });
      }
      throw e;
    }
    res.json({ ok: true, productManualOverride: true });
  }),
);

router.delete(
  '/occurrences/:tourEventId/product',
  handle(async (req, res) => {
    await clearManualProduct(prisma, req.params.tourEventId);
    res.json({ ok: true, productManualOverride: false });
  }),
);

router.delete(
  '/exceptions/:exceptionId',
  handle(async (req, res) => {
    await prisma.openTourScheduleException.delete({ where: { id: req.params.exceptionId } });
    res.status(204).end();
  }),
);

// ── WooCommerce product mappings (sellable card → Woo Variable Product) ───────
// The canonical card→product mapping lives in GOS; business logic never
// hardcodes a Woo product id. Changing a mapping re-syncs the card's future
// sellable slots so their variations refresh in place.
router.get(
  '/woo/mappings',
  handle(async (_req, res) => {
    const mappings = await prisma.wooProductMapping.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(mappings);
  }),
);

// Validate the per-product compatibility descriptor (WooProductMapping.config).
// Lenient by design (products differ), but a GLOBAL config must at least name a
// date attribute id, and any declared attribute id must be a positive integer.
function validateWooConfig(config) {
  if (config == null) return { value: null };
  if (typeof config !== 'object' || Array.isArray(config)) return { error: 'invalid_config' };
  const okId = (v) => v == null || (Number.isInteger(v) && v > 0);
  for (const key of ['date', 'time', 'activity', 'age']) {
    const node = config[key];
    if (node != null && (typeof node !== 'object' || !okId(node.attrId))) {
      return { error: `invalid_config_${key}` };
    }
  }
  if ((config.taxonomyMode || 'global') === 'global' && !(config.date && Number.isInteger(config.date.attrId))) {
    return { error: 'config_missing_date_attr' };
  }
  if (config.ticketAge != null && (typeof config.ticketAge !== 'object' || Array.isArray(config.ticketAge))) {
    return { error: 'invalid_config_ticketAge' };
  }
  return { value: config };
}

router.put(
  '/woo/mappings/:cardGroupId',
  handle(async (req, res) => {
    const cardGroupId = String(req.params.cardGroupId || '');
    if (!cardGroupId) return res.status(400).json({ error: 'invalid_card' });
    const b = req.body || {};
    const wooProductId = Number(b.wooProductId);
    if (!Number.isInteger(wooProductId) || wooProductId <= 0) {
      return res.status(400).json({ error: 'invalid_woo_product_id' });
    }
    const { value: config, error: configError } = validateWooConfig(b.config);
    if (configError) return res.status(400).json({ error: configError });

    // Phase 7 safety: if an ACTIVE mapping already has future linked variations
    // and the target product changes, moving is not silent — report the impact.
    const prev = await prisma.wooProductMapping.findUnique({ where: { cardGroupId } });
    let moved = 0;
    if (prev && prev.wooProductId !== wooProductId) {
      moved = await prisma.wooVariationLink.count({
        where: { cardGroupId, wooProductId: prev.wooProductId, status: { not: 'disabled' } },
      });
      // Guard: require an explicit confirm flag when it would move live links.
      if (moved > 0 && b.confirmMove !== true) {
        return res.status(409).json({ error: 'mapping_move_requires_confirm', moved, fromProductId: prev.wooProductId });
      }
    }

    const data = {
      wooProductId,
      dateAttribute: b.dateAttribute ? String(b.dateAttribute).trim() : null,
      config: config ?? undefined,
      active: b.active !== false,
    };
    const mapping = await prisma.wooProductMapping.upsert({
      where: { cardGroupId },
      create: { cardGroupId, ...data, config: config ?? null },
      update: data,
    });
    // Refresh the card's future sellable slots in Woo. On a product move the
    // reconciler disables the old-product variations and (re)creates on the new.
    try {
      await markCardSlotsPending(prisma, cardGroupId);
      kickWooSync();
    } catch (e) {
      console.error('[open-tours] woo resync failed', e);
    }
    res.json({ ...mapping, moved });
  }),
);

router.delete(
  '/woo/mappings/:cardGroupId',
  handle(async (req, res) => {
    const cardGroupId = String(req.params.cardGroupId || '');
    await prisma.wooProductMapping.deleteMany({ where: { cardGroupId } });
    res.status(204).end();
  }),
);

// ── Woo product structure discovery (READ-ONLY) ──────────────────────────────
// Inspect a live product's attributes + terms so the operator can build a
// mapping config without hardcoding ids anywhere. Read-only: needs credentials
// but is INDEPENDENT of the WOO_SYNC_ENABLED write gate. No secrets/customer
// data are returned. This is how the corrected model is configured before any
// activation.
router.get(
  '/woo/products/:productId/structure',
  handle(async (req, res) => {
    if (!wooConfigured()) return res.status(503).json({ error: 'woo_not_configured' });
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ error: 'invalid_product_id' });
    let product;
    try {
      product = await woo.getProduct(productId);
    } catch (e) {
      return res.status(e.status === 404 ? 404 : 502).json({ error: 'woo_fetch_failed', detail: e.message });
    }
    const attributes = [];
    for (const a of product.attributes || []) {
      const global = Boolean(a.id); // global taxonomy attributes have a numeric id
      let terms = [];
      if (global) {
        try {
          terms = (await woo.listAttributeTerms(a.id)).map((t) => ({ name: t.name, slug: t.slug }));
        } catch {
          terms = [];
        }
      }
      attributes.push({
        id: a.id || null,
        name: a.name,
        slug: a.slug || null,
        taxonomy: global ? 'global' : 'local',
        variation: Boolean(a.variation),
        options: a.options || [],
        terms,
      });
    }
    res.json({ productId, name: product.name, type: product.type, status: product.status, attributes });
  }),
);

// ── Controlled sync: gate status + candidates + single-occurrence trigger ────
// Operational visibility for the corrected Woo model. `gate` reports the two
// switches so the admin can see why nothing is syncing. `candidates` lists the
// nearest FUTURE sellable slots of a card with their live sync status + links.
router.get(
  '/woo/gate',
  handle(async (_req, res) => {
    res.json({
      configured: wooConfigured(),
      writeEnabled: wooSyncActive(), // creds AND WOO_SYNC_ENABLED
      bulkEnabled: wooSyncBulkEnabled(), // WOO_SYNC_BULK_ENABLED (sweep)
    });
  }),
);

// Auto-build the mapping config for a card + product: resolves the REAL GOS
// ticketTypeIds and the store's EXACT option encoding (from the product's live
// variations) so the admin gets ready-to-save JSON with no placeholders.
router.get(
  '/woo/suggest-config/:cardGroupId',
  handle(async (req, res) => {
    if (!wooConfigured()) return res.status(503).json({ error: 'woo_not_configured' });
    const cardGroupId = String(req.params.cardGroupId || '');
    const productId = Number(req.query.productId);
    if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ error: 'invalid_product_id' });
    const activity = req.query.activity ? String(req.query.activity) : null;
    // The card title drives the workshop-vs-tour activity inference.
    const rep = await prisma.priceRule.findFirst({
      where: { cardGroupId },
      orderBy: { createdAt: 'asc' },
      include: { product: { select: { nameHe: true } } },
    });
    const cardTitle = rep?.product?.nameHe || '';
    let result;
    try {
      result = await suggestWooConfig({ db: prisma, woo }, { cardGroupId, productId, cardTitle, activity });
    } catch (e) {
      return res.status(e.status === 404 ? 404 : 502).json({ error: 'woo_fetch_failed', detail: e.message });
    }
    res.json(result);
  }),
);

router.get(
  '/woo/candidates/:cardGroupId',
  handle(async (req, res) => {
    const cardGroupId = String(req.params.cardGroupId || '');
    const take = Math.min(Number(req.query.limit) || 20, 100);
    // Card-level facts: which templates offer it, whether it's mapped, and how
    // many variations it SHOULD have (its priced ticket rows = adult/child).
    const [products, mapping, ticketRows] = await Promise.all([
      prisma.openTourTemplateProduct.findMany({ where: { cardGroupId }, select: { templateId: true } }),
      prisma.wooProductMapping.findUnique({ where: { cardGroupId } }),
      cardTicketRows(prisma, cardGroupId),
    ]);
    const templateIds = [...new Set(products.map((p) => p.templateId))];
    const mapped = Boolean(mapping && mapping.active);
    const expected = ticketRows.length;
    const offered = templateIds.length > 0;
    const head = { offered, mapped, expected, wooProductId: mapping?.wooProductId ?? null };
    if (!offered) return res.json({ ...head, candidates: [] });

    const tours = await prisma.tourEvent.findMany({
      where: { openTourTemplateId: { in: templateIds }, kind: 'group_slot', date: { gte: israelToday() } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take,
      select: {
        id: true, date: true, startTime: true, capacity: true, status: true,
        wooSyncStatus: true, wooSyncError: true, wooSyncedAt: true,
        wooVariationLinks: {
          where: { cardGroupId },
          select: { variantKey: true, ticketTypeId: true, wooProductId: true, wooVariationId: true, status: true, lastError: true },
        },
      },
    });
    const occ = await occupancyFor(prisma, tours.map((t) => t.id));
    res.json({
      ...head,
      candidates: tours.map((t) => {
        const links = t.wooVariationLinks || [];
        // Count DISTINCT variant keys actually synced (id present + status synced).
        const syncedKeys = new Set(links.filter((l) => l.wooVariationId && l.status === 'synced').map((l) => l.variantKey));
        const failed = links.some((l) => l.status === 'failed');
        const cardStatus = deriveCardStatus({
          offered: true,
          mapped,
          expected,
          syncedCount: syncedKeys.size,
          failed,
          tourStatus: t.wooSyncStatus,
        });
        return {
          ...t,
          activeSeats: occ[t.id]?.activeSeats || 0,
          remaining: t.capacity == null ? null : Math.max(0, t.capacity - (occ[t.id]?.activeSeats || 0)),
          expected,
          syncedCount: syncedKeys.size,
          cardStatus,
        };
      }),
    });
  }),
);

// Mark EXACTLY ONE tour pending (never a sweep). Safe regardless of the gate: it
// only writes GOS state; the worker syncs it iff WOO_SYNC_ENABLED is set. This is
// the controlled single-occurrence trigger.
router.post(
  '/woo/sync-one/:tourEventId',
  handle(async (req, res) => {
    const tourEventId = String(req.params.tourEventId || '');
    const tour = await prisma.tourEvent.findUnique({
      where: { id: tourEventId },
      select: { id: true, kind: true },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    if (tour.kind !== 'group_slot') return res.status(400).json({ error: 'not_a_group_slot' });
    await markTourWooPending(prisma, tourEventId);
    res.json({ ok: true, tourEventId, writeEnabled: wooSyncActive() });
  }),
);

export default router;
