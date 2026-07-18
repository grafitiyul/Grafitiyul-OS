import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { productHasVariants } from './products.js';
import {
  buildData,
  buildTierRows,
  buildTicketRows,
  buildAddonRows,
  PriceRulePayloadError,
} from './priceRuleData.js';

// Price Rules (Slice 2 + Slice A). Each rule belongs to a PriceList. Scopes
// (product, variant, activityType, organizationSubtype) are optional — null =
// wildcard. priceModel selects which price fields apply:
//   per_head      — adult/child per-person
//   tiered        — single base tier + per-additional (legacy)
//   tiered_group  — ordered PriceTier ladder + per-additional above the top tier
//   fixed         — one flat total per group
// `pricingSegmentId` / `cardGroupId` are authoring tags only (the engine ignores
// them). Payload construction + card-authoring invariants (explicit VAT,
// priority not writable) live in priceRuleData.js. Admin-only.

const router = Router();

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
    let data;
    try {
      data = buildData(req.body || {}, { partial: false });
    } catch (e) {
      if (e instanceof PriceRulePayloadError) return res.status(400).json({ error: e.code });
      throw e;
    }
    const rule = await prisma.priceRule.create({
      data: {
        priceListId,
        ...data,
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
    let data;
    try {
      data = buildData(req.body || {}, { partial: true });
    } catch (e) {
      if (e instanceof PriceRulePayloadError) return res.status(400).json({ error: e.code });
      throw e;
    }
    // When tiers/ticketPrices/addons are supplied, replace that set atomically.
    // Absent = leave the existing rows untouched (partial update).
    const rule = await prisma.$transaction(async (tx) => {
      const updated = await tx.priceRule.update({
        where: { id },
        data,
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
