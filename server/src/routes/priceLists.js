import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Price Lists (Slice 2). A named set of pricing rules with VAT/currency
// defaults. Exactly one row is the system default (isDefault). Admin-only.

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

router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.priceList.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

// Make this list the single system default (unset all others). Atomic.
router.put(
  '/:id/default',
  handle(async (req, res) => {
    const { id } = req.params;
    const exists = await prisma.priceList.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: 'not_found' });
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
    if (req.body?.defaultVatMode !== undefined)
      data.defaultVatMode = cleanVatMode(req.body.defaultVatMode);
    if (req.body?.defaultVatRate !== undefined)
      data.defaultVatRate = Number(req.body.defaultVatRate) || 0;
    if (req.body?.currency !== undefined)
      data.currency = String(req.body.currency || 'ILS');
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    const list = await prisma.priceList.update({
      where: { id: req.params.id },
      data,
    });
    res.json(list);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const list = await prisma.priceList.findUnique({
      where: { id: req.params.id },
    });
    if (!list) return res.status(404).json({ error: 'not_found' });
    if (list.isDefault)
      return res.status(409).json({ error: 'cannot_delete_default' });
    // Rules cascade-delete via FK. Org type/subtype defaults SetNull.
    await prisma.priceList.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
