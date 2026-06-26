import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Payment configuration: Payment Terms + Payment Methods, each with an optional
// default pointing at the other (Net 30 → Bank Transfer; Check → Activity Day).
// Slice 3 will auto-fill the Deal from these and allow overrides.

const router = Router();

const str = (v) => (v ? String(v).trim() : null);

// ---------- Terms ----------

router.get(
  '/terms',
  handle(async (_req, res) => {
    const rows = await prisma.paymentTerm.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: { defaultPaymentMethod: { select: { id: true, nameHe: true } } },
    });
    res.json(rows);
  }),
);

router.put(
  '/terms/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(ids.map((id, i) => prisma.paymentTerm.update({ where: { id }, data: { sortOrder: i } })));
    res.json({ ok: true });
  }),
);

router.post(
  '/terms',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.paymentTerm.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const row = await prisma.paymentTerm.create({
      data: {
        nameHe,
        nameEn: str(req.body?.nameEn),
        defaultPaymentMethodId: req.body?.defaultPaymentMethodId || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(row);
  }),
);

router.put(
  '/terms/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) {
      const v = String(b.nameHe).trim();
      if (!v) return res.status(400).json({ error: 'nameHe_required' });
      data.nameHe = v;
    }
    if (b.nameEn !== undefined) data.nameEn = str(b.nameEn);
    if (b.defaultPaymentMethodId !== undefined) data.defaultPaymentMethodId = b.defaultPaymentMethodId || null;
    if (b.active !== undefined) data.active = !!b.active;
    const row = await prisma.paymentTerm.update({ where: { id: req.params.id }, data });
    res.json(row);
  }),
);

router.delete(
  '/terms/:id',
  handle(async (req, res) => {
    await prisma.paymentTerm.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Methods ----------

router.get(
  '/methods',
  handle(async (_req, res) => {
    const rows = await prisma.paymentMethod.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: { defaultPaymentTerm: { select: { id: true, nameHe: true } } },
    });
    res.json(rows);
  }),
);

router.put(
  '/methods/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(ids.map((id, i) => prisma.paymentMethod.update({ where: { id }, data: { sortOrder: i } })));
    res.json({ ok: true });
  }),
);

router.post(
  '/methods',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.paymentMethod.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const row = await prisma.paymentMethod.create({
      data: {
        nameHe,
        nameEn: str(req.body?.nameEn),
        defaultPaymentTermId: req.body?.defaultPaymentTermId || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(row);
  }),
);

router.put(
  '/methods/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) {
      const v = String(b.nameHe).trim();
      if (!v) return res.status(400).json({ error: 'nameHe_required' });
      data.nameHe = v;
    }
    if (b.nameEn !== undefined) data.nameEn = str(b.nameEn);
    if (b.defaultPaymentTermId !== undefined) data.defaultPaymentTermId = b.defaultPaymentTermId || null;
    if (b.active !== undefined) data.active = !!b.active;
    const row = await prisma.paymentMethod.update({ where: { id: req.params.id }, data });
    res.json(row);
  }),
);

router.delete(
  '/methods/:id',
  handle(async (req, res) => {
    await prisma.paymentMethod.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
