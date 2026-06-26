import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// CRM settings → Lost Reasons. A reusable picklist of why a Deal was lost.
// Catalog only — NOT yet wired to Deals. Hebrew name is required; English
// label is optional. Drag-orderable; `active` toggles visibility for future
// consumers without deleting history.

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const reasons = await prisma.lostReason.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
    });
    res.json(reasons);
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
        prisma.lostReason.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { nameHe, nameEn } = req.body || {};
    const cleanHe = String(nameHe || '').trim();
    if (!cleanHe) return res.status(400).json({ error: 'name_required' });
    const last = await prisma.lostReason.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const reason = await prisma.lostReason.create({
      data: {
        nameHe: cleanHe,
        nameEn: nameEn ? String(nameEn).trim() : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(reason);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { nameHe, nameEn, active, sortOrder } = req.body || {};
    const data = {};
    if (nameHe !== undefined) data.nameHe = String(nameHe).trim();
    if (nameEn !== undefined)
      data.nameEn = nameEn ? String(nameEn).trim() : null;
    if (active !== undefined) data.active = !!active;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    const reason = await prisma.lostReason.update({
      where: { id: req.params.id },
      data,
    });
    res.json(reason);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.lostReason.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
