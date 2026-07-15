import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildMigrationStatus } from '../migration/status.js';
import migrationReviewRouter from './migrationReview.js';

// Legacy-migration admin surface. Mounted admin-only.
//
//   /status  — read-only config readiness (secret-free) + table counts + the
//              latest run's request usage / pause reason.
//   /review  — the TEMPORARY Migration Review Center API (Slice 3). It writes
//              only MigrationDecision rows; no production entities, no imports.
//
// Extraction is NOT exposed over HTTP: it is a one-off CLI, gated by
// MIGRATION_EXTRACTION_ENABLED, so no request can trigger a Pipedrive call.

const router = Router();

router.get(
  '/status',
  handle(async (_req, res) => {
    const status = await buildMigrationStatus(prisma);
    res.json(status);
  }),
);

// DELETION BOUNDARY: drop this line + routes/migrationReview.js +
// src/migration/review/ + client/src/admin/migration/ to remove the Center.
router.use('/review', migrationReviewRouter);

export default router;
