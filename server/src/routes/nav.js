// Main-navigation configuration — mounted admin-only (requireAdminAuth) in
// index.js, per the project's mount-site convention.
//
// THIN CALLER: validation lives in nav/navPrefsCore.js (pure, unit-tested).
// This file owns only Prisma calls and HTTP translation.
//
// The configuration is ORG-WIDE: one shared navigation for every admin, like
// every other GOS settings surface. The read is normally served by
// /api/auth/status (one mount-time round-trip, no rail flash); GET here exists
// for the settings screen and for anything that needs a fresh copy.

import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { validateNavConfig, toClient } from '../nav/navPrefsCore.js';

const router = Router();

// Shared with auth.js's /status, so the shell and this screen can never read
// the configuration through two different code paths.
export async function readNavPreferences() {
  return toClient(await prisma.navPreference.findMany());
}

// GET /api/nav/config → { modules }
router.get(
  '/config',
  handle(async (_req, res) => {
    res.json({ modules: await readNavPreferences() });
  }),
);

// PUT /api/nav/config — replace-all. The settings screen always sends every
// module, so ordering is fully determined by the stored rows rather than by
// registry position. Rows absent from the payload are deleted (a module removed
// from code stops carrying a stale row forward).
router.put(
  '/config',
  handle(async (req, res) => {
    const v = validateNavConfig(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const keys = v.rows.map((r) => r.key);
    await prisma.$transaction([
      prisma.navPreference.deleteMany({ where: { key: { notIn: keys } } }),
      ...v.rows.map((r) =>
        prisma.navPreference.upsert({ where: { key: r.key }, create: r, update: r }),
      ),
    ]);
    res.json({ modules: await readNavPreferences() });
  }),
);

// DELETE /api/nav/config — drop every stored preference. The navigation falls
// back to the code defaults; nothing is lost, because the defaults are the
// registry itself.
router.delete(
  '/config',
  handle(async (_req, res) => {
    await prisma.navPreference.deleteMany({});
    res.json({ modules: [] });
  }),
);

export default router;
