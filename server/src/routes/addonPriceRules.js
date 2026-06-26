import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Addon Price Rules (Slice 2). Per-price-list override of an Addon's price/VAT.
// priceListId null = a global override. Admin-only.

const router = Router();

const VAT_MODES = ['included', 'excluded'];
const cleanVatMode = (v, fallback = 'included') =>
  VAT_MODES.includes(v) ? v : fallback;

function toBig(v, fallback = 0n) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? BigInt(Math.round(n)) : fallback;
}

router.get(
  '/',
  handle(async (req, res) => {
    const where = {};
    if (req.query.addonId) where.addonId = String(req.query.addonId);
    const rules = await prisma.addonPriceRule.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { priceList: { select: { id: true, nameHe: true } } },
    });
    res.json(rules);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const addonId = String(req.body?.addonId || '');
    if (!addonId) return res.status(400).json({ error: 'addonId_required' });
    const addon = await prisma.addon.findUnique({ where: { id: addonId } });
    if (!addon) return res.status(404).json({ error: 'addon_not_found' });
    const rule = await prisma.addonPriceRule.create({
      data: {
        addonId,
        priceListId: req.body?.priceListId || null,
        priceMinor: toBig(req.body?.priceMinor),
        currency: req.body?.currency ? String(req.body.currency) : 'ILS',
        vatMode: cleanVatMode(req.body?.vatMode),
        vatRate: Number.isFinite(Number(req.body?.vatRate))
          ? Number(req.body.vatRate)
          : 18,
      },
    });
    res.status(201).json(rule);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const data = {};
    if (req.body?.priceListId !== undefined)
      data.priceListId = req.body.priceListId || null;
    if (req.body?.priceMinor !== undefined)
      data.priceMinor = toBig(req.body.priceMinor);
    if (req.body?.currency !== undefined)
      data.currency = String(req.body.currency || 'ILS');
    if (req.body?.vatMode !== undefined)
      data.vatMode = cleanVatMode(req.body.vatMode);
    if (req.body?.vatRate !== undefined)
      data.vatRate = Number(req.body.vatRate) || 0;
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    const rule = await prisma.addonPriceRule.update({
      where: { id: req.params.id },
      data,
    });
    res.json(rule);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.addonPriceRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
