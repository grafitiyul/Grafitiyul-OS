import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as r2 from '../src/r2.js';

// Ops tool: reconcile R2 `tour-galleries/` storage against the DB.
//   node scripts/reconcile-tour-gallery.mjs           → report only
//   node scripts/reconcile-tour-gallery.mjs --delete  → purge orphan prefixes
//
// An ORPHAN prefix is a tour-galleries/<tourEventId>/ whose tourEventId has
// no TourGallery row and no pending cleanup task — storage that nothing in
// the product can ever reach again (e.g. a cleanup task that was manually
// deleted, or historical debris). Normal operation never produces these; the
// cleanup worker owns the routine paths. Run this occasionally or after
// incident recovery.

const DELETE = process.argv.includes('--delete');
const prisma = new PrismaClient();

async function main() {
  if (!r2.isConfigured()) {
    console.error('R2 is not configured (env vars missing) — nothing to reconcile.');
    process.exit(1);
  }
  const keys = await r2.listKeys('tour-galleries/');
  const byTour = new Map();
  for (const key of keys) {
    const m = /^tour-galleries\/([^/]+)\//.exec(key);
    if (!m) continue;
    if (!byTour.has(m[1])) byTour.set(m[1], []);
    byTour.get(m[1]).push(key);
  }
  console.log(`R2: ${keys.length} objects across ${byTour.size} tour prefixes`);

  const orphans = [];
  for (const [tourEventId, tourKeys] of byTour) {
    const [gallery, pendingCleanup] = await Promise.all([
      prisma.tourGallery.findUnique({ where: { tourEventId }, select: { id: true } }),
      prisma.tourGalleryCleanupTask.findFirst({
        where: { tourEventId, status: { in: ['pending', 'running'] } },
        select: { id: true },
      }),
    ]);
    if (!gallery && !pendingCleanup) orphans.push({ tourEventId, keys: tourKeys });
  }

  if (orphans.length === 0) {
    console.log('✓ No orphan prefixes — storage and DB agree.');
    return;
  }
  for (const o of orphans) {
    console.log(`ORPHAN tour-galleries/${o.tourEventId}/ — ${o.keys.length} objects`);
    if (DELETE) {
      const uploads = await r2.listMultipartUploads(`tour-galleries/${o.tourEventId}/`);
      for (const u of uploads) await r2.abortMultipartUpload(u);
      await r2.deleteObjects(o.keys);
      console.log('  → deleted');
    }
  }
  if (!DELETE) console.log('\nRe-run with --delete to purge the orphan prefixes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
