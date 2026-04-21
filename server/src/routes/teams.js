import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { getRecruitmentSnapshot } from './recruitment.js';

// TeamRef is a read-only reference layer. Rows are NEVER created manually
// — `externalTeamId` is a system identifier that must come from the
// recruitment system. The /import endpoint upserts from the recruitment
// snapshot (mock today, real API later) and is the only creation path.
//
// Delete and update are preserved for administrative cleanup only; display
// name may drift from the upstream label between syncs, and sometimes the
// admin wants to remove a stale row. Re-importing brings it back.
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

// Import teams from the recruitment source. Upserts by externalTeamId —
// new rows are created, existing rows get their displayName refreshed.
// Returns counts so the UI can show a useful summary.
router.post(
  '/import',
  handle(async (_req, res) => {
    const snap = await getRecruitmentSnapshot();
    let created = 0;
    let updated = 0;
    for (const t of snap.teams) {
      const externalTeamId = String(t.externalTeamId || '').trim();
      const displayName = String(t.displayName || '').trim();
      if (!externalTeamId || !displayName) continue;
      const existing = await prisma.teamRef.findUnique({
        where: { externalTeamId },
      });
      if (existing) {
        await prisma.teamRef.update({
          where: { externalTeamId },
          data: { displayName },
        });
        updated += 1;
      } else {
        await prisma.teamRef.create({
          data: { externalTeamId, displayName },
        });
        created += 1;
      }
    }
    res.json({ created, updated, total: snap.teams.length });
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
