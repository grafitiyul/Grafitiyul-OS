// Migration Review Center API (TEMPORARY — deleted after cutover).
//
// Mounted under /api/migration/review, which is already admin-gated by
// requireAdminAuth at the /api/migration mount in index.js.
//
// DELETION BOUNDARY: remove this file, src/migration/review/, the one mount line
// in routes/migration.js, and client/src/admin/migration/. Nothing else in GOS
// imports any of it. MigrationDecision + LegacyRecord are permanent and stay.
//
// This slice writes NOTHING except MigrationDecision rows (the ledger). No
// production entities, no LegacyRecords, no Pipedrive/Airtable calls.
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../migration/r2.js';
import { seedStageConfig, buildReviewSummary, listQueue, recordDecision } from '../migration/review/service.js';
import { buildSnapshotStatus } from '../migration/review/snapshotStatus.js';

const router = Router();

// Queue counts, progress, and the blocking gate.
router.get(
  '/summary',
  handle(async (_req, res) => {
    res.json(await buildReviewSummary(prisma));
  }),
);

// Snapshot #1 status from the real manifest (safe summary facts only).
router.get(
  '/snapshot',
  handle(async (_req, res) => {
    res.json(await buildSnapshotStatus(prisma, r2));
  }),
);

// Idempotent seeding of the frozen, owner-approved configuration.
router.post(
  '/seed',
  handle(async (_req, res) => {
    res.json(await seedStageConfig(prisma));
  }),
);

// One queue's decisions.
router.get(
  '/queues/:queue',
  handle(async (req, res) => {
    try {
      res.json(await listQueue(prisma, req.params.queue, { status: req.query.status || null }));
    } catch (e) {
      if (e.code === 'UNKNOWN_QUEUE') return res.status(404).json({ error: 'unknown_queue' });
      throw e;
    }
  }),
);

// Record a human decision (approve / reject / edit) with its audit trail.
router.post(
  '/decisions/:id/decide',
  handle(async (req, res) => {
    const userId = req.adminAuth?.userId || null;
    let userName = null;
    if (userId) {
      const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
      userName = u?.username || null;
    }
    try {
      const row = await recordDecision(prisma, {
        id: req.params.id,
        action: String(req.body?.action || ''),
        decision: req.body?.decision ?? null,
        note: typeof req.body?.note === 'string' ? req.body.note.trim() || null : null,
        userId,
        userName,
      });
      res.json({ id: row.id, status: row.status, decidedByName: row.decidedByName, decidedAt: row.decidedAt });
    } catch (e) {
      if (e.code === 'INVALID_ACTION') return res.status(400).json({ error: 'invalid_action' });
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'not_found' });
      if (e.code === 'QUEUE_FROZEN') return res.status(409).json({ error: 'queue_frozen', message: e.message });
      throw e;
    }
  }),
);

export default router;
