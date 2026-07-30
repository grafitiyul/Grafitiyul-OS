// Seed the mirror's Airtable poll cursors to an explicit starting timestamp.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/seed-cursors.mjs --at <ISO> [--execute]
//
// RUN THIS BEFORE ENABLING CAPTURE. Two reasons, both measured:
//
//  1. COST. With no cursor there is no filterByFormula, so the first poll of every
//     table is a FULL READ. Four tables, thousands of records, ~100 per request.
//     Seeding makes the first poll incremental — one request per table when quiet.
//
//  2. CORRECTNESS, and this is the serious one. A full first read is bounded by
//     maxPages. The cursor it then stores is the maximum lastModified among the
//     records it HAPPENED to see, and Airtable does not return them in modified
//     order — so any record past the page bound whose lastModified is earlier than
//     that maximum falls permanently before the cursor and is never polled again.
//     Seeding a known timestamp removes the unbounded first read entirely.
//
// WHAT TIMESTAMP TO USE: the moment just BEFORE the Final Snapshot extraction
// starts. Everything earlier is in the snapshot and arrives via the cutover
// import; everything later is caught by polling. No gap, no overlap that matters
// (a replayed no-op change is harmless — the merge converges).
import { PrismaClient } from '@prisma/client';
import { CHILD_TABLES } from '../../src/mirror/sources/airtableTourChildren.js';
import { airtableCursorTargets } from '../../src/mirror/adapters.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const at = arg('--at');
const EXECUTE = process.argv.includes('--execute');
if (!at) {
  console.error('usage: --at <ISO timestamp> [--execute]');
  console.error('  e.g. --at 2026-07-30T18:00:00.000Z   (just before the Final Snapshot starts)');
  process.exit(1);
}
const when = new Date(at);
if (Number.isNaN(when.getTime())) { console.error(`not a valid timestamp: ${at}`); process.exit(1); }
// Airtable's IS_AFTER compares against an ISO string; store exactly what the
// client will interpolate so the seeded value and a polled value are the same shape.
const cursor = when.toISOString();

// A cursor in the future would silence polling entirely — every record would look
// older than the cursor and nothing would ever be picked up.
if (when.getTime() > Date.now()) {
  console.error(`\n⛔ REFUSED: ${cursor} is in the future. Polling would go permanently silent.`);
  process.exit(2);
}

// The ids are DERIVED from the real poll targets, not typed out here. A hand-written
// id that does not match what the worker registers produces the worst possible
// outcome: the script reports success, the cursor row sits unused, and capture does
// the unbounded first read anyway. airtableCursorTargets() builds them through the
// same buildPollTargets + cursorIdFor path the worker uses.
const TARGETS = airtableCursorTargets().map((t) => ({
  ...t,
  label: t.cursorKey ? `child ${t.cursorKey.split(':').pop()}` : 'master tours',
}));
if (TARGETS.length !== 1 + Object.keys(CHILD_TABLES).length) {
  console.error(`\n⛔ REFUSED: expected ${1 + Object.keys(CHILD_TABLES).length} Airtable poll targets, found ${TARGETS.length}. The target list changed — update this script.`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

console.log(`\nmirror cursor seeding — target cursor ${cursor}`);
console.log(`mode: ${EXECUTE ? 'EXECUTE' : 'PLAN (read-only)'}\n`);

const existing = await prisma.mirrorCursor.findMany({ orderBy: { id: 'asc' } });
const byId = new Map(existing.map((c) => [c.id, c]));

let toCreate = 0; let toSet = 0; let leftAlone = 0;
for (const t of TARGETS) {
  const cur = byId.get(t.id);
  if (!cur) { console.log(`  + ${t.id.padEnd(38)} create → ${cursor}   (${t.label})`); toCreate += 1; continue; }
  if (!cur.cursor) { console.log(`  ~ ${t.id.padEnd(38)} set    → ${cursor}   (was empty)`); toSet += 1; continue; }
  // NEVER rewind a live cursor: moving it backwards would re-deliver everything
  // since, and moving it forward would skip changes. An existing position is the
  // mirror's own progress and is left exactly as it is.
  console.log(`  = ${t.id.padEnd(38)} keep     ${cur.cursor}   (already polling — untouched)`);
  leftAlone += 1;
}

for (const c of existing) {
  if (!TARGETS.some((t) => t.id === c.id)) console.log(`  · ${c.id.padEnd(38)} not an Airtable target — ignored`);
}

console.log(`\n  create ${toCreate} · set ${toSet} · keep ${leftAlone}`);

if (!EXECUTE) {
  console.log('\nPLAN only — nothing written. Re-run with --execute.');
  await prisma.$disconnect();
  process.exit(0);
}

for (const t of TARGETS) {
  const cur = byId.get(t.id);
  if (cur?.cursor) continue;
  await prisma.mirrorCursor.upsert({
    where: { id: t.id },
    create: { id: t.id, system: t.system, entity: t.entity, cursor },
    update: { cursor },
  });
  console.log(`  ✓ ${t.id} = ${cursor}`);
}

const after = await prisma.mirrorCursor.findMany({ orderBy: { id: 'asc' } });
console.log('\nfinal cursor state:');
for (const c of after) console.log(`  ${c.id.padEnd(38)} ${c.cursor || '(none)'}`);
const unseeded = TARGETS.filter((t) => !after.find((c) => c.id === t.id)?.cursor);
if (unseeded.length) {
  console.error(`\n⛔ ${unseeded.length} target(s) still have no cursor — capture would do a full read. Investigate before enabling capture.`);
  await prisma.$disconnect();
  process.exit(2);
}
console.log('\nAll Airtable targets have a cursor. The first poll after capture is enabled will be incremental.');
await prisma.$disconnect();
