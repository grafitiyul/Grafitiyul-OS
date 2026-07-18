import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Price Lists — pricing VERSIONS (גרסת תמחור). A named set of pricing rules
// with VAT defaults; exactly one row is the DEFAULT = the live version that
// resolution uses. Admin-only.
//
// Canonical management lives on the Pricing board's version bar (the retired
// הגדרות מתקדמות screen is NOT the consumer): rename/VAT-defaults edit,
// atomic set-default, deactivate, and a guarded delete. `sortOrder` is
// creation order (display only, no reorder endpoint). The PriceList VAT
// defaults' ONLY live pricing role is builder lines set to 'inherit' —
// card rules always carry explicit VAT (enforced in priceRuleData.js).

const router = Router();

const VAT_MODES = ['included', 'excluded'];
const cleanVatMode = (v, fallback = 'included') =>
  VAT_MODES.includes(v) ? v : fallback;

router.get(
  '/',
  handle(async (_req, res) => {
    const lists = await prisma.priceList.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: { _count: { select: { rules: true } } },
    });
    res.json(lists);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.priceList.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const list = await prisma.priceList.create({
      data: {
        nameHe,
        nameEn: req.body?.nameEn ? String(req.body.nameEn).trim() : null,
        defaultVatMode: cleanVatMode(req.body?.defaultVatMode),
        defaultVatRate: Number.isFinite(Number(req.body?.defaultVatRate))
          ? Number(req.body.defaultVatRate)
          : 18,
        currency: req.body?.currency ? String(req.body.currency) : 'ILS',
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(list);
  }),
);

// Edit a version: name, VAT defaults, active (hide from the version bar).
router.put(
  '/:id',
  handle(async (req, res) => {
    const current = await prisma.priceList.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (req.body?.nameHe !== undefined) {
      const v = String(req.body.nameHe).trim();
      if (!v) return res.status(400).json({ error: 'nameHe_required' });
      data.nameHe = v;
    }
    if (req.body?.defaultVatMode !== undefined)
      data.defaultVatMode = cleanVatMode(req.body.defaultVatMode);
    if (req.body?.defaultVatRate !== undefined) {
      const rate = Number(req.body.defaultVatRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100)
        return res.status(400).json({ error: 'invalid_vat_rate' });
      data.defaultVatRate = rate;
    }
    if (req.body?.active !== undefined) {
      // The DEFAULT (live) version can never be hidden — there must always be
      // a visible live version.
      if (current.isDefault && !req.body.active)
        return res.status(409).json({ error: 'cannot_deactivate_default' });
      data.active = !!req.body.active;
    }
    const list = await prisma.priceList.update({
      where: { id: req.params.id },
      data,
    });
    res.json(list);
  }),
);

// Make this version the single live default (unset all others). Atomic — the
// "exactly one default" invariant is enforced here, never by ad-hoc updates.
router.put(
  '/:id/default',
  handle(async (req, res) => {
    const { id } = req.params;
    const exists = await prisma.priceList.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: 'not_found' });
    if (exists.active === false)
      return res.status(409).json({ error: 'cannot_default_inactive' });
    await prisma.$transaction([
      prisma.priceList.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      }),
      prisma.priceList.update({ where: { id }, data: { isDefault: true } }),
    ]);
    res.json(await prisma.priceList.findUnique({ where: { id } }));
  }),
);

// Delete a version. Guarded twice: never the live default, and never a version
// that still holds pricing rules (the old cascade-delete of a whole rule set
// was removed on purpose — emptying a version must be an explicit act).
router.delete(
  '/:id',
  handle(async (req, res) => {
    const list = await prisma.priceList.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { rules: true } } },
    });
    if (!list) return res.status(404).json({ error: 'not_found' });
    if (list.isDefault)
      return res.status(409).json({ error: 'cannot_delete_default' });
    if (list._count.rules > 0)
      return res.status(409).json({ error: 'has_rules' });
    await prisma.priceList.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
