import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Price Lists (Slice 2). A named set of pricing rules with VAT/currency
// defaults. Exactly one row is the system default (isDefault). Admin-only.
//
// Dead-code removal (הגדרות מתקדמות cleanup): the rename/VAT-edit, delete,
// reorder and set-default endpoints existed ONLY for the retired advanced
// pricing screen and were removed with it. The PriceList columns they edited
// (isDefault, defaultVatMode/Rate, sortOrder, nameEn, currency, active) are
// STILL READ by engine resolution and the business board — the storage stays;
// only the orphaned write endpoints are gone (git history has them if a
// management UI ever returns).

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

export default router;
