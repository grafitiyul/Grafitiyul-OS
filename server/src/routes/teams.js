import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// TeamRef CRUD. Teams are a lightweight reference layer over the
// recruitment system's teams — `externalTeamId` is the stable upstream
// handle, `displayName` is a UI hint that can go stale without breaking
// anything that references this row.
const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    const teams = await prisma.teamRef.findMany({
      orderBy: { displayName: 'asc' },
    });
    res.json(teams);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { externalTeamId, displayName, meta = null } = req.body || {};
    if (!externalTeamId || !String(externalTeamId).trim()) {
      return res.status(400).json({ error: 'externalTeamId_required' });
    }
    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ error: 'displayName_required' });
    }
    try {
      const team = await prisma.teamRef.create({
        data: {
          externalTeamId: String(externalTeamId).trim(),
          displayName: String(displayName).trim(),
          meta: meta ?? undefined,
        },
      });
      res.status(201).json(team);
    } catch (e) {
      if (e?.code === 'P2002') {
        return res.status(409).json({ error: 'externalTeamId_already_exists' });
      }
      throw e;
    }
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { displayName, meta } = req.body || {};
    const data = {};
    if (displayName !== undefined) data.displayName = String(displayName).trim();
    if (meta !== undefined) data.meta = meta;
    const team = await prisma.teamRef.update({
      where: { id: req.params.id },
      data,
    });
    res.json(team);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.teamRef.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
