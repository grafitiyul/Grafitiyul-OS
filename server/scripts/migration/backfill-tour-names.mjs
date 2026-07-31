// One-time completion pass: imported historical tours were written with
// notes:null — the legacy tour NAME (Airtable "שם") was dropped, surviving
// only in PayrollActivity.titleHe when payroll existed. But the CANONICAL
// convention for a product-less legacy tour's identity is "name = notes first
// line" (calendar titles, guide-portal cards, admin הערות column all read
// it). This pass completes the import: it copies the snapshot name into
// TourEvent.notes for exactly those rows.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/backfill-tour-names.mjs [--execute]
//   (export MIGRATION_DB_URL=<public url> first — the injected DATABASE_URL
//    is the internal hostname; R2 creds come from the injected env)
//
// RULES:
//   * source of truth = the SAME snapshot + normalizer the import used
//     (loadNormalizedTourLayer; snapshotId read off the tour LegacyRecords);
//   * only rows whose notes are NULL/empty — an operator-written note is
//     untouchable; idempotent (after the pass notes are set, reruns skip);
//   * names stored VERBATIM (incl. trailing date tokens) — display strips a
//     same-day trailing date via stripTrailingSameDate, same as the future
//     imported tours behave.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

const links = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'airtable', sourceType: 'tour', entityType: 'TourEvent', entityId: { not: null } },
  select: { sourceId: true, entityId: true, snapshotId: true },
});
if (!links.length) {
  console.log('no imported tour crosswalks — nothing to do');
  process.exit(0);
}
const snapshotIds = [...new Set(links.map((l) => l.snapshotId).filter(Boolean))];
console.log(`tour crosswalks: ${links.length} · snapshot(s): ${snapshotIds.join(', ')}`);

const nameByRec = new Map();
for (const snapshotId of snapshotIds) {
  const { masterTours } = await loadNormalizedTourLayer(snapshotId);
  for (const m of masterTours) if (m.name) nameByRec.set(m.recId, m.name);
}
console.log(`snapshot names resolved: ${nameByRec.size}`);

const tours = await prisma.tourEvent.findMany({
  where: { id: { in: links.map((l) => l.entityId) } },
  select: { id: true, notes: true },
});
const notesById = new Map(tours.map((t) => [t.id, t.notes]));

let updated = 0, skippedHasNotes = 0, noName = 0, missingEntity = 0;
for (const l of links) {
  if (!notesById.has(l.entityId)) { missingEntity += 1; continue; }
  const existing = String(notesById.get(l.entityId) || '').trim();
  if (existing) { skippedHasNotes += 1; continue; }
  const name = nameByRec.get(l.sourceId);
  if (!name) { noName += 1; continue; }
  if (EXECUTE) {
    await prisma.tourEvent.update({ where: { id: l.entityId }, data: { notes: name } });
  }
  updated += 1;
}
console.log(`${EXECUTE ? 'updated' : 'would update'}: ${updated}`);
console.log(`skipped (already have notes): ${skippedHasNotes}`);
console.log(`no name in snapshot: ${noName}`);
console.log(`crosswalk without entity row: ${missingEntity}`);
if (!EXECUTE) console.log('\n--dry: nothing written.');
await prisma.$disconnect();
