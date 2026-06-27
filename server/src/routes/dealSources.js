import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// CRM settings → Deal Sources. An admin-managed picklist of how a lead/deal
// arrived (Facebook, website, referral, conference, …). Used by the Create Deal
// flow. Drag-orderable; `active` retires a source without deleting history.

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const sources = await prisma.dealSource.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    res.json(sources);
  }),
);

// Reorder — declared before '/:id' so "reorder" is not captured as an id.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.dealSource.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const label = String(req.body?.label || '').trim();
    if (!label) return res.status(400).json({ error: 'label_required' });
    const last = await prisma.dealSource.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const source = await prisma.dealSource.create({
      data: { label, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    res.status(201).json(source);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { label, active, sortOrder } = req.body || {};
    const data = {};
    if (label !== undefined) {
      const clean = String(label).trim();
      if (!clean) return res.status(400).json({ error: 'label_required' });
      data.label = clean;
    }
    if (active !== undefined) data.active = !!active;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    const source = await prisma.dealSource.update({
      where: { id: req.params.id },
      data,
    });
    res.json(source);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.dealSource.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
