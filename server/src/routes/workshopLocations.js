import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Workshop Locations catalog (Tours settings → "מיקומי סדנה"). Physical places a
// workshop component can take place in; referenced per TourEvent component row
// (Slice C). Same catalog shape as the others: sortOrder + isActive + reorder.
// A referenced location is deactivated, never hard-deleted.

const router = Router();

router.get(
  '/',
  handle(async (req, res) => {
    const where = req.query.activeOnly === '1' ? { isActive: true } : {};
    const items = await prisma.workshopLocation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
    });
    res.json(items);
  }),
);

// Reorder — registered BEFORE '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) => prisma.workshopLocation.update({ where: { id }, data: { sortOrder: i } })),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const nameHe = String(b.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'name_required' });
    const last = await prisma.workshopLocation.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await prisma.workshopLocation.create({
      data: {
        nameHe,
        address: b.address ? String(b.address).trim().slice(0, 300) : null,
        instructions: b.instructions ? String(b.instructions).trim().slice(0, 2000) : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(created);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nameHe !== undefined) {
      const n = String(b.nameHe).trim();
      if (!n) return res.status(400).json({ error: 'name_required' });
      data.nameHe = n;
    }
    if (b.address !== undefined) data.address = b.address ? String(b.address).trim().slice(0, 300) : null;
    if (b.instructions !== undefined)
      data.instructions = b.instructions ? String(b.instructions).trim().slice(0, 2000) : null;
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const updated = await prisma.workshopLocation.update({ where: { id: req.params.id }, data });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const item = await prisma.workshopLocation.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ error: 'not_found' });
    try {
      await prisma.workshopLocation.delete({ where: { id: item.id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === 'P2003' || e.code === 'P2014')
        return res.status(409).json({ error: 'location_in_use' });
      throw e;
    }
  }),
);

export default router;
