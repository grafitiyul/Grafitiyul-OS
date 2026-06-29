import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { productHasVariants } from './products.js';

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

const PRICE_MODELS = ['per_head', 'tiered', 'tiered_group', 'fixed', 'ticket_types'];
// Card-level VAT. 'exempt' (פטור) is valid — the engine's splitVat handles it
// (net=gross, vat=0). Without it a card set to exempt would be silently coerced
// to null and inherit the price-list VAT (e.g. 18%). Matches ADDON_VAT_MODES.
const VAT_MODES = ['included', 'excluded', 'exempt'];

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
  // Card-level business capability — "Available for Group Ticket Sales". The card
  // is the sole authority for the Group Ticket Builder. Duplicated across siblings.
  set('availableForGroupTickets', body.availableForGroupTickets === true);
  // Card display order (business). Engine ignores it.
  set('cardSortOrder', toInt(body.cardSortOrder) ?? 0);
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

// Ticket-price rows for the ticket_types model. null = caller didn't send any.
// Drops rows missing a ticketTypeId or price; de-dupes by ticketTypeId (last wins)
// to satisfy the @@unique(priceRuleId, ticketTypeId) constraint.
function buildTicketRows(ticketPrices) {
  if (!Array.isArray(ticketPrices)) return null;
  const byType = new Map();
  for (const p of ticketPrices) {
    const ticketTypeId = p?.ticketTypeId ? String(p.ticketTypeId) : null;
    const priceMinor = toBig(p?.priceMinor);
    if (!ticketTypeId || priceMinor == null) continue;
    byType.set(ticketTypeId, { ticketTypeId, priceMinor });
  }
  return [...byType.values()];
}

const ADDON_VAT_MODES = ['included', 'excluded', 'exempt'];
// 'sabbath_holiday' defers to the שעות שבת וחג module; 'weekdays' uses the per-card
// weekday set; 'manual' is owner-toggled. Anything else falls back to 'manual'.
const ADDON_AUTO_APPLY = ['manual', 'weekdays', 'sabbath_holiday'];

// Card add-on rows. null = caller didn't send any. De-dupes by addonId; clamps
// weekdays to 0..6; vatMode null = inherit the card's VAT.
function buildAddonRows(addons) {
  if (!Array.isArray(addons)) return null;
  const seen = new Set();
  const rows = [];
  addons.forEach((a, i) => {
    const addonId = a?.addonId ? String(a.addonId) : null;
    if (!addonId || seen.has(addonId)) return;
    seen.add(addonId);
    const weekdays = Array.isArray(a?.autoApplyWeekdays)
      ? [...new Set(a.autoApplyWeekdays.map((n) => Math.max(0, Math.min(6, Math.floor(Number(n)) || 0))))]
      : [];
    rows.push({
      addonId,
      enabled: a?.enabled !== false,
      // null = inherit (system add-on inherits the catalog default price).
      priceMinor: toBig(a?.priceMinor),
      vatMode: ADDON_VAT_MODES.includes(a?.vatMode) ? a.vatMode : null,
      vatRate: toInt(a?.vatRate),
      autoApply: ADDON_AUTO_APPLY.includes(a?.autoApply) ? a.autoApply : 'manual',
      // weekdays only meaningful for the 'weekdays' mode; clear otherwise.
      autoApplyWeekdays: a?.autoApply === 'weekdays' ? weekdays : [],
      sortOrder: toInt(a?.sortOrder) ?? i,
    });
  });
  return rows;
}

const RULE_CHILDREN = {
  tiers: { orderBy: { sortOrder: 'asc' } },
  ticketPrices: true,
  addons: { orderBy: { sortOrder: 'asc' } },
};

router.get(
  '/',
  handle(async (req, res) => {
    const where = {};
    if (req.query.priceListId)
      where.priceListId = String(req.query.priceListId);
    const rules = await prisma.priceRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: RULE_CHILDREN,
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
    // A sellable product must have at least one variant. Guards legacy/zero-variant
    // products from being used in a pricing card via the API (UI also filters them).
    if (req.body?.productId && !(await productHasVariants(String(req.body.productId))))
      return res.status(400).json({ error: 'product_not_usable' });
    const tierRows = buildTierRows(req.body?.tiers);
    const ticketRows = buildTicketRows(req.body?.ticketPrices);
    const addonRows = buildAddonRows(req.body?.addons);
    const rule = await prisma.priceRule.create({
      data: {
        priceListId,
        ...buildData(req.body || {}, { partial: false }),
        ...(tierRows ? { tiers: { create: tierRows } } : {}),
        ...(ticketRows ? { ticketPrices: { create: ticketRows } } : {}),
        ...(addonRows ? { addons: { create: addonRows } } : {}),
      },
      include: RULE_CHILDREN,
    });
    res.status(201).json(rule);
  }),
);

// Reorder CARDS within a tab. Body: { cardGroupIds: [...] } in the desired
// order. Sets cardSortOrder = index on EVERY sibling rule of each cardGroupId, so
// a whole card moves together. Only the supplied cardGroupIds are touched, so
// other tabs are unaffected. Declared before '/:id' so it isn't read as an id.
router.put(
  '/card-order',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.cardGroupIds)
      ? req.body.cardGroupIds.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((cardGroupId, i) =>
        prisma.priceRule.updateMany({
          where: { cardGroupId },
          data: { cardSortOrder: i },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const id = req.params.id;
    // Same usability guard on update — only when productId is being (re)assigned.
    if (req.body?.productId && !(await productHasVariants(String(req.body.productId))))
      return res.status(400).json({ error: 'product_not_usable' });
    const tierRows = buildTierRows(req.body?.tiers);
    const ticketRows = buildTicketRows(req.body?.ticketPrices);
    const addonRows = buildAddonRows(req.body?.addons);
    // When tiers/ticketPrices/addons are supplied, replace that set atomically.
    // Absent = leave the existing rows untouched (partial update).
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
      if (ticketRows) {
        await tx.priceRuleTicketPrice.deleteMany({ where: { priceRuleId: id } });
        if (ticketRows.length)
          await tx.priceRuleTicketPrice.createMany({
            data: ticketRows.map((t) => ({ ...t, priceRuleId: id })),
          });
      }
      if (addonRows) {
        await tx.priceRuleAddon.deleteMany({ where: { priceRuleId: id } });
        if (addonRows.length)
          await tx.priceRuleAddon.createMany({
            data: addonRows.map((a) => ({ ...a, priceRuleId: id })),
          });
      }
      return updated;
    });
    const full = await prisma.priceRule.findUnique({
      where: { id: rule.id },
      include: RULE_CHILDREN,
    });
    res.json(full);
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
