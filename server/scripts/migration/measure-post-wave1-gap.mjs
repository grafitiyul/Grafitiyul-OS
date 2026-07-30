// EXACT post-Wave-1 missing populations, measured not estimated.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/measure-post-wave1-gap.mjs
//
// Read-only. Compares the FINAL snapshot against the GOS crosswalk to find every
// activity, note and file that exists in Pipedrive but has never reached GOS —
// the interval the replay buffer cannot recover, because those records were
// created before mirror capture began.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const FINAL = process.argv[2] || 'snap-20260730T081731Z-44cb';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: FINAL });

async function streamEntity(key, visit) {
  const man = await reader.entityManifest(key);
  let n = 0;
  for (const s of man.shards || []) {
    for (const r of await reader.readShard(s.key)) { visit(r); n += 1; }
    reader._shardCache.clear();
  }
  return n;
}

const crosswalkIds = async (sourceType) => {
  const rows = await prisma.legacyRecord.findMany({
    where: { sourceSystem: 'pipedrive', sourceType },
    select: { sourceId: true, entityId: true, entityType: true },
  });
  return {
    all: new Set(rows.map((r) => r.sourceId)),
    withEntity: new Set(rows.filter((r) => r.entityId).map((r) => r.sourceId)),
    entityTypes: rows.reduce((m, r) => m.set(r.entityType || '(none)', (m.get(r.entityType || '(none)') || 0) + 1), new Map()),
  };
};

console.log(`\npost-Wave-1 gap — snapshot ${FINAL}\n${'═'.repeat(64)}`);

// ── activities ───────────────────────────────────────────────────────────────
const actX = await crosswalkIds('activity');
let actTotal = 0; const actMissing = []; const actByYear = new Map(); const actMissingOpen = [];
await streamEntity('pipedrive/activities', (a) => {
  actTotal += 1;
  const id = String(a.id);
  if (actX.all.has(id)) return;
  actMissing.push(id);
  const y = String(a.add_time || a.due_date || '').slice(0, 7) || 'unknown';
  actByYear.set(y, (actByYear.get(y) || 0) + 1);
  if (a.done === false || a.done === 0) actMissingOpen.push(id);
});
console.log(`\nACTIVITIES / TASKS`);
console.log(`  in snapshot          : ${actTotal}`);
console.log(`  crosswalked in GOS   : ${actX.all.size}  (with an entity: ${actX.withEntity.size})`);
console.log(`  MISSING from GOS     : ${actMissing.length}`);
console.log(`  of those, still OPEN : ${actMissingOpen.length}  ← operationally live work`);
console.log(`  crosswalk entityTypes: ${JSON.stringify(Object.fromEntries(actX.entityTypes))}`);
console.log(`  missing by month (top 8):`);
for (const [m, n] of [...actByYear].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8)) console.log(`     ${m}: ${n}`);

// ── notes ────────────────────────────────────────────────────────────────────
const noteX = await crosswalkIds('note');
let noteTotal = 0; const noteMissing = []; const noteByMonth = new Map();
await streamEntity('pipedrive/notes', (n) => {
  noteTotal += 1;
  const id = String(n.id);
  if (noteX.all.has(id)) return;
  noteMissing.push(id);
  const m = String(n.add_time || '').slice(0, 7) || 'unknown';
  noteByMonth.set(m, (noteByMonth.get(m) || 0) + 1);
});
console.log(`\nNOTES`);
console.log(`  in snapshot          : ${noteTotal}`);
console.log(`  crosswalked in GOS   : ${noteX.all.size}  (with an entity: ${noteX.withEntity.size})`);
console.log(`  MISSING from GOS     : ${noteMissing.length}`);
console.log(`  crosswalk entityTypes: ${JSON.stringify(Object.fromEntries(noteX.entityTypes))}`);
console.log(`  missing by month (top 8):`);
for (const [m, n] of [...noteByMonth].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8)) console.log(`     ${m}: ${n}`);

// ── files: the snapshot deliberately omits pipedrive/files, so the volume is
// derived from the deals' own aggregate counters — zero extra API calls.
let dealsWithFiles = 0; let fileCountSum = 0; let dealsTotal = 0; let activeWithFiles = 0; let activeFileSum = 0;
await streamEntity('pipedrive/deals', (d) => {
  dealsTotal += 1;
  const n = Number(d.files_count || 0);
  if (!n) return;
  dealsWithFiles += 1; fileCountSum += n;
  if (d.status === 'open' || d.status === 'won') { activeWithFiles += 1; activeFileSum += n; }
});
console.log(`\nFILES (derived from deal.files_count — no files census was run)`);
console.log(`  deals in snapshot            : ${dealsTotal}`);
console.log(`  deals carrying files         : ${dealsWithFiles}`);
console.log(`  total file attachments       : ${fileCountSum}`);
console.log(`  on OPEN/WON deals            : ${activeWithFiles} deals · ${activeFileSum} files  ← the active population`);
console.log(`  currently in GOS (DealFile)  : ${await prisma.dealFile.count()}`);

// ── commercial state: deal products, quantities, pricing, discounts ─────────
// Operational data in Pipedrive AT cutover, so it must be imported; ownership
// transfers to GOS afterwards.
const dpX = await crosswalkIds('deal_product');
const activeDealIds = new Set();
await streamEntity('pipedrive/deals', (d) => { if (d.status === 'open' || d.status === 'won') activeDealIds.add(String(d.id)); });
// The snapshot stores ONE record per deal carrying a `products` array, and the
// crosswalk is keyed by the DEAL id (entityType QuoteVersion). Comparing the
// record's own id would be meaningless — this compares deal ids.
let dpTotal = 0; let dpMissing = 0; let dpActive = 0; let dpActiveMissing = 0;
let lineTotal = 0; let lineActiveMissing = 0;
let withDiscount = 0; let withComments = 0; const dpDealIds = new Set(); const dpActiveDealIds = new Set();
const missingActiveDeals = [];
const sampleFields = new Set();
await streamEntity('pipedrive/deal_products', (dp) => {
  dpTotal += 1;
  const dealId = String(dp.deal_id ?? dp.dealId ?? '');
  const lines = Array.isArray(dp.products) ? dp.products : [];
  lineTotal += lines.length;
  dpDealIds.add(dealId);
  const isActive = activeDealIds.has(dealId);
  if (isActive) { dpActive += 1; dpActiveDealIds.add(dealId); }
  const covered = dpX.all.has(dealId);
  if (!covered) {
    dpMissing += 1;
    if (isActive) { dpActiveMissing += 1; lineActiveMissing += lines.length; if (missingActiveDeals.length < 6) missingActiveDeals.push({ dealId, lines: lines.length }); }
  }
  for (const l of lines) {
    if (Number(l.discount || l.discount_percentage || 0) > 0) withDiscount += 1;
    if (String(l.comments || '').trim()) withComments += 1;
    if (sampleFields.size < 40) for (const k of Object.keys(l)) sampleFields.add(k);
  }
});
console.log(`\nCOMMERCIAL STATE (deal products / quantities / pricing / discounts)`);
console.log(`  deals with product lines      : ${dpTotal}  ·  total product LINES: ${lineTotal}`);
console.log(`  crosswalked in GOS            : ${dpX.all.size}  (with an entity: ${dpX.withEntity.size})`);
console.log(`  crosswalk entityTypes         : ${JSON.stringify(Object.fromEntries(dpX.entityTypes))}`);
console.log(`  deals with NO commercial import: ${dpMissing}`);
console.log(`  on ACTIVE (open/won) deals    : ${dpActive} lines across ${dpActiveDealIds.size} deals`);
console.log(`    of those NOT imported       : ${dpActiveMissing} deals · ${lineActiveMissing} lines  ← must be imported`);
  console.log(`  samples: ${JSON.stringify(missingActiveDeals)}`);
console.log(`  lines carrying a discount     : ${withDiscount}`);
console.log(`  lines carrying comments       : ${withComments}`);
console.log(`  available fields on a line    : ${[...sampleFields].join(', ').slice(0, 320)}`);

// ── deals / contacts / orgs already covered by the base import ───────────────
const dealX = await crosswalkIds('deal');
console.log(`\nFOR CONTEXT — entities the base import already covers`);
console.log(`  deals crosswalked: ${dealX.all.size} · snapshot ${dealsTotal} · base import creates 295`);

console.log(`\n${'═'.repeat(64)}`);
console.log('The replay buffer cannot recover any of the MISSING rows above:');
console.log('they were created before capture began and generate no new event.');
await prisma.$disconnect();
