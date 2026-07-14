import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { buildMigrationStatus } from '../migration/status.js';

// Legacy-migration admin surface (Slice 1 — foundation only).
//
// The ONLY endpoint in this slice is read-only status/health: config readiness
// (secret-free) + table counts. There is intentionally NO mutation route yet —
// extraction, review, and imports arrive in later slices. Mounted admin-only.

const router = Router();

router.get(
  '/status',
  handle(async (_req, res) => {
    const status = await buildMigrationStatus(prisma);
    res.json(status);
  }),
);

export default router;
