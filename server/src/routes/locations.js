import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Location catalog (e.g. "תל אביב - פלורנטין"). Simple sortable list. Hebrew
// name required; English optional.

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const rows = await prisma.location.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameHe: 'asc' }],
      include: {
        meetingPointImage: true,
        _count: { select: { variants: true } },
      },
    });
    res.json(rows);
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
        prisma.location.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const nameHe = String(req.body?.nameHe || '').trim();
    if (!nameHe) return res.status(400).json({ error: 'nameHe_required' });
    const last = await prisma.location.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const row = await prisma.location.create({
      data: {
        nameHe,
        nameEn: req.body?.nameEn ? String(req.body.nameEn).trim() : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(row);
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
    if (req.body?.meetingPointHe !== undefined)
      data.meetingPointHe = req.body.meetingPointHe || null;
    if (req.body?.meetingPointEn !== undefined)
      data.meetingPointEn = req.body.meetingPointEn || null;
    // meetingPointImageId: string attaches, null detaches (R2 object is left in
    // place — orphan sweep is deferred).
    if (req.body?.meetingPointImageId !== undefined)
      data.meetingPointImageId = req.body.meetingPointImageId || null;
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    // Home Location is single-owner: setting one true unsets any other. Enforced
    // here (API), like PriceList.isDefault. No city name is hardcoded.
    let setHome = false;
    if (req.body?.isHomeLocation !== undefined) {
      data.isHomeLocation = !!req.body.isHomeLocation;
      setHome = data.isHomeLocation;
    }
    const row = await prisma.$transaction(async (tx) => {
      if (setHome) {
        await tx.location.updateMany({
          where: { isHomeLocation: true, id: { not: req.params.id } },
          data: { isHomeLocation: false },
        });
      }
      return tx.location.update({
        where: { id: req.params.id },
        data,
        include: { meetingPointImage: true },
      });
    });
    res.json(row);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    try {
      await prisma.location.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e) {
      if (e.code === 'P2003' || e.code === 'P2014') {
        return res.status(409).json({ error: 'location_in_use' });
      }
      throw e;
    }
  }),
);

export default router;
