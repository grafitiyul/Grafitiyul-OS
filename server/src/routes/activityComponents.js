import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  normalizeTone,
  DEFAULT_TONE,
  DEFAULT_ACTIVITY_COMPONENTS,
  activityComponentDeletionVerdict,
} from '../tours/activityCatalog.js';

// Activity Components catalog (Tours settings → "מרכיבי פעילות"). The reusable
// building blocks a Product / TourEvent is composed of. Same catalog shape as
// task-types: sortOrder + isActive + reorder + lazy default seed. A referenced
// component (Product default or any TourEvent) is deactivated, never deleted.

const router = Router();

async function ensureSeeded() {
  const count = await prisma.activityComponent.count();
  if (count > 0) return;
  await prisma.$transaction(
    DEFAULT_ACTIVITY_COMPONENTS.map((c, i) =>
      prisma.activityComponent.create({ data: { ...c, sortOrder: i } }),
    ),
  );
}

// GET /api/activity-components?activeOnly=1 — lazy-seeds defaults on first call.
router.get(
  '/',
  handle(async (req, res) => {
    await ensureSeeded();
    const where = req.query.activeOnly === '1' ? { isActive: true } : {};
    const items = await prisma.activityComponent.findMany({
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
      ids.map((id, i) => prisma.activityComponent.update({ where: { id }, data: { sortOrder: i } })),
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
    const last = await prisma.activityComponent.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await prisma.activityComponent.create({
      data: {
        nameHe,
        nameEn: b.nameEn ? String(b.nameEn).trim().slice(0, 120) : null,
        icon: b.icon ? String(b.icon).slice(0, 16) : null,
        color: b.color ? normalizeTone(b.color) : DEFAULT_TONE,
        isWorkshop: !!b.isWorkshop,
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
    if (b.nameEn !== undefined) data.nameEn = b.nameEn ? String(b.nameEn).trim().slice(0, 120) : null;
    if (b.icon !== undefined) data.icon = b.icon ? String(b.icon).slice(0, 16) : null;
    if (b.color !== undefined) data.color = normalizeTone(b.color);
    if (b.isWorkshop !== undefined) data.isWorkshop = !!b.isWorkshop;
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    const updated = await prisma.activityComponent.update({ where: { id: req.params.id }, data });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const item = await prisma.activityComponent.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ error: 'not_found' });
    // A component that was ever used (Product default OR any TourEvent) must be
    // deactivated, not deleted, so historical tours stay readable. The FK
    // constraints (added in Slices B/C, ON DELETE RESTRICT) are the DB backstop.
    try {
      await prisma.activityComponent.delete({ where: { id: item.id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === 'P2003' || e.code === 'P2014')
        return res.status(409).json({ error: 'component_in_use' });
      throw e;
    }
  }),
);

export { activityComponentDeletionVerdict };
export default router;
