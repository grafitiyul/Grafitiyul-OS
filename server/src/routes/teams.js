import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Team CRUD. Teams are managed natively in this system — the recruitment
// system does NOT model teams, so there is no import path and no external
// id column. Admins create teams by display name; the cuid `id` is the
// stable handle referenced by PersonRef.teamRefId and FlowTargetTeam.

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
    const { displayName, meta = null } = req.body || {};
    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ error: 'displayName_required' });
    }
    const team = await prisma.teamRef.create({
      data: {
        displayName: String(displayName).trim(),
        meta: meta ?? undefined,
      },
    });
    res.status(201).json(team);
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
