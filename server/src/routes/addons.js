import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Add-ons (Slice 2). Sellable extras that are NOT Products (transport,
// insurance, materials, …). Each carries a default price + VAT behaviour;
// per-price-list overrides live in AddonPriceRule. Admin-only.

const router = Router();

// 'exempt' (פטור) is a valid addon VAT mode — splitVat handles it (net=gross,
// vat=0). null = "כמו כרטיס התמחור" — the add-on inherits the Pricing Card's VAT.
const VAT_MODES = ['included', 'excluded', 'exempt'];
const cleanVatMode = (v) => (VAT_MODES.includes(v) ? v : null);

function toBig(v, fallback = 0n) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? BigInt(Math.round(n)) : fallback;
}

router.get(
  '/',
  handle(async (_req, res) => {
    const addons = await prisma.addon.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: { priceRules: true },
    });
    res.json(addons);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.addon.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const addon = await prisma.addon.create({
      data: {
        nameHe,
        nameEn: req.body?.nameEn ? String(req.body.nameEn).trim() : null,
        defaultPriceMinor: toBig(req.body?.defaultPriceMinor),
        currency: req.body?.currency ? String(req.body.currency) : 'ILS',
        vatMode: cleanVatMode(req.body?.vatMode),
        vatRate: Number.isFinite(Number(req.body?.vatRate))
          ? Number(req.body.vatRate)
          : 18,
        defaultQuantity: Number.isFinite(Number(req.body?.defaultQuantity))
          ? Number(req.body.defaultQuantity)
          : 1,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(addon);
  }),
);

router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.addon.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const data = {};
    if (req.body?.nameHe !== undefined) {
      const v = String(req.body.nameHe).trim();
      if (!v) return res.status(400).json({ error: 'nameHe_required' });
      data.nameHe = v;
    }
    if (req.body?.nameEn !== undefined)
      data.nameEn = req.body.nameEn ? String(req.body.nameEn).trim() : null;
    if (req.body?.defaultPriceMinor !== undefined)
      data.defaultPriceMinor = toBig(req.body.defaultPriceMinor);
    if (req.body?.currency !== undefined)
      data.currency = String(req.body.currency || 'ILS');
    if (req.body?.vatMode !== undefined)
      data.vatMode = cleanVatMode(req.body.vatMode);
    if (req.body?.vatRate !== undefined)
      data.vatRate = Number(req.body.vatRate) || 0;
    if (req.body?.defaultQuantity !== undefined)
      data.defaultQuantity = Number(req.body.defaultQuantity) || 1;
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    const addon = await prisma.addon.update({
      where: { id: req.params.id },
      data,
    });
    res.json(addon);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // System add-ons (e.g. שבת/חג) are part of the engine wiring — never hard-
    // deletable. Use the active toggle (global kill-switch) instead.
    const target = await prisma.addon.findUnique({ where: { id: req.params.id }, select: { systemKey: true } });
    if (target?.systemKey) return res.status(409).json({ error: 'system_addon' });
    // Block hard delete when the add-on is configured on any pricing card —
    // deleting would silently strip it from those cards. Deactivate instead.
    const inUse = await prisma.priceRuleAddon.count({
      where: { addonId: req.params.id },
    });
    if (inUse > 0) {
      return res.status(409).json({ error: 'addon_in_use', usedBy: inUse });
    }
    // AddonPriceRule rows cascade-delete via FK.
    await prisma.addon.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
