import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Price Rules (Slice 2 + Slice A). Each rule belongs to a PriceList. Scopes
// (product, variant, activityType, organizationSubtype) are optional — null =
// wildcard. priceModel selects which price fields apply:
//   per_head      — adult/child per-person
//   tiered        — single base tier + per-additional (legacy)
//   tiered_group  — ordered PriceTier ladder + per-additional above the top tier
//   fixed         — one flat total per group
// `pricingSegmentId` / `cardGroupId` are authoring tags only (the engine ignores
// them). Admin-only.

const router = Router();

const PRICE_MODELS = ['per_head', 'tiered', 'tiered_group', 'fixed'];
const VAT_MODES = ['included', 'excluded'];

// Minor-unit → BigInt | null. Accepts numbers/strings; '' and null → null.
function toBig(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}
function toInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Build the writable data payload shared by create/update. `partial` controls
// whether absent keys are skipped (update) or defaulted (create).
function buildData(body, { partial }) {
  const data = {};
  const set = (key, val) => {
    if (partial && body[key] === undefined) return;
    data[key] = val;
  };
  // Scopes — empty/absent means wildcard (null).
  set('productId', body.productId || null);
  set('productVariantId', body.productVariantId || null);
  set('activityTypeId', body.activityTypeId || null);
  set('organizationSubtypeId', body.organizationSubtypeId || null);
  // Authoring tags (engine ignores these).
  set('pricingSegmentId', body.pricingSegmentId || null);
  set('cardGroupId', body.cardGroupId || null);
  // Price model fields.
  if (!partial || body.priceModel !== undefined)
    data.priceModel = PRICE_MODELS.includes(body.priceModel)
      ? body.priceModel
      : 'per_head';
  set('adultPriceMinor', toBig(body.adultPriceMinor));
  set('childPriceMinor', toBig(body.childPriceMinor));
  set('basePriceMinor', toBig(body.basePriceMinor));
  set('baseParticipants', toInt(body.baseParticipants));
  set('perAdditionalParticipantMinor', toBig(body.perAdditionalParticipantMinor));
  set('fixedPriceMinor', toBig(body.fixedPriceMinor));
  // VAT override — null inherits the price list defaults.
  set('vatMode', VAT_MODES.includes(body.vatMode) ? body.vatMode : null);
  set('vatRate', toInt(body.vatRate));
  set('priority', toInt(body.priority) ?? 0);
  if (!partial || body.active !== undefined) data.active = body.active !== false;
  return data;
}

// Normalize an incoming tiers array into PriceTier create rows. Skips malformed
// rows (missing/negative bound). Order is preserved via sortOrder so the engine
// reads the ladder deterministically even if uptoParticipants ties.
function buildTierRows(tiers) {
  if (!Array.isArray(tiers)) return null; // null = "caller didn't send tiers"
  return tiers
    .map((t, i) => ({
      uptoParticipants: toInt(t?.uptoParticipants),
      totalPriceMinor: toBig(t?.totalPriceMinor),
      sortOrder: toInt(t?.sortOrder) ?? i,
    }))
    .filter(
      (t) => t.uptoParticipants != null && t.uptoParticipants >= 0 && t.totalPriceMinor != null,
    );
}

router.get(
  '/',
  handle(async (req, res) => {
    const where = {};
    if (req.query.priceListId)
      where.priceListId = String(req.query.priceListId);
    const rules = await prisma.priceRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: { tiers: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json(rules);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const priceListId = String(req.body?.priceListId || '');
    if (!priceListId)
      return res.status(400).json({ error: 'priceListId_required' });
    const list = await prisma.priceList.findUnique({
      where: { id: priceListId },
    });
    if (!list) return res.status(404).json({ error: 'price_list_not_found' });
    const tierRows = buildTierRows(req.body?.tiers);
    const rule = await prisma.priceRule.create({
      data: {
        priceListId,
        ...buildData(req.body || {}, { partial: false }),
        ...(tierRows ? { tiers: { create: tierRows } } : {}),
      },
      include: { tiers: { orderBy: { sortOrder: 'asc' } } },
    });
    res.status(201).json(rule);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const id = req.params.id;
    const tierRows = buildTierRows(req.body?.tiers);
    // When `tiers` is supplied, replace the whole ladder atomically. Absent =
    // leave existing tiers untouched (partial update).
    const rule = await prisma.$transaction(async (tx) => {
      const updated = await tx.priceRule.update({
        where: { id },
        data: buildData(req.body || {}, { partial: true }),
      });
      if (tierRows) {
        await tx.priceTier.deleteMany({ where: { priceRuleId: id } });
        if (tierRows.length)
          await tx.priceTier.createMany({
            data: tierRows.map((t) => ({ ...t, priceRuleId: id })),
          });
      }
      return updated;
    });
    const withTiers = await prisma.priceRule.findUnique({
      where: { id: rule.id },
      include: { tiers: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json(withTiers);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.priceRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
