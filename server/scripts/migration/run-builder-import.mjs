// Historical product-lines import runner (Slice B). Additive, idempotent.
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-builder-import.mjs [--execute]
//
// Writes QuoteVersion(sourceKind='pipedrive_import', isWorking=false) + frozen
// QuoteLine rows directly (no route → no Woo/iCount/calendar/quote/payment/
// registration side effects). Never touches Deal.valueMinor.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { planBuilderImport, executeBuilderImport } from '../../src/migration/import/builderImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const SNAP = arg('--snapshot') || 'snap-20260714T125052Z-aaaa';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
async function stream(key, visit) { const m = await reader.entityManifest(key); for (const s of m.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); } }

// deal crosswalk (pipedrive deal id → GOS deal) + valueMinor
const dealXw = await prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'deal' }, select: { sourceId: true, entityId: true } });
const dealIds = dealXw.map((r) => r.entityId);
const dealRows = await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, valueMinor: true } });
const valueById = new Map(dealRows.map((d) => [d.id, d.valueMinor == null ? null : Number(d.valueMinor)]));
const dealByLegacyId = new Map(dealXw.map((r) => [r.sourceId, { id: r.entityId, valueMinor: valueById.get(r.entityId) ?? null }]));

// already-imported crosswalk (idempotency)
const existing = new Set((await prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'deal_product' }, select: { sourceId: true } })).map((r) => r.sourceId));

// source docs
const docs = [];
await stream('pipedrive/deal_products', (d) => docs.push({ dealId: d.deal_id, products: Array.isArray(d.products) ? d.products : [] }));
console.log(`docs ${docs.length} · deal xwalk ${dealByLegacyId.size} · already imported ${existing.size}`);

const plan = planBuilderImport(docs, dealByLegacyId, existing);
const s = plan.stats;
console.log('\n══ PLAN ══');
console.log(`plan ${s.plan} · already ${s.alreadyImported} · no-deal ${s.noDeal} · empty ${s.emptyProducts}`);
console.log(`lines ${s.lines} (discount ${s.discountLines} · placeholder ${s.placeholderLines} · html-notes ${s.htmlNotes})`);
console.log(`reconciliation: A(match) ${s.classA} · B(zero-value) ${s.classB} · C(discrepancy) ${s.classC}`);

if (!EXECUTE) { console.log('\n--dry: nothing written.'); await prisma.$disconnect(); process.exit(0); }

// side-effect baseline — everything the import must NOT touch
const SIDE = ['quoteDocument', 'quoteOffer', 'paymentRequest', 'dealPaymentLink', 'icountDocument', 'booking', 'ticketRegistration', 'tourEvent', 'whatsAppScheduledMessage', 'emailThread'];
const baseline = {};
for (const tbl of SIDE) baseline[tbl] = await prisma[tbl].count();
const dealValueBefore = await prisma.deal.aggregate({ _sum: { valueMinor: true } });

const batchId = `builder-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({ data: { kind: 'import', target: 'import.builder', status: 'running', snapshotId: SNAP, batchId, startedAt: new Date(), counters: s } });
console.log(`\nexecuting ${batchId} (run ${run.id})…`);
const t0 = Date.now();
try {
  const res = await executeBuilderImport(prisma, plan, { batchId, snapshotId: SNAP, log: (m) => console.log(m), checkpoint: async (c) => prisma.migrationRun.update({ where: { id: run.id }, data: { counters: { ...s, ...c } } }) });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { ...s, ...res } } });
  console.log(`\n✔ ${res.written} versions · ${res.linesWritten} lines in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('FAILED:', e?.message || e); process.exit(3);
}

console.log('\n══ VERIFY ══');
console.log(`imported historical versions: ${await prisma.quoteVersion.count({ where: { sourceKind: 'pipedrive_import' } })}`);
console.log(`  isWorking among them: ${await prisma.quoteVersion.count({ where: { sourceKind: 'pipedrive_import', isWorking: true } })} (must be 0)`);
console.log(`historical quote lines: ${await prisma.quoteLine.count({ where: { quoteVersion: { sourceKind: 'pipedrive_import' } } })}`);
console.log(`crosswalk rows: ${await prisma.legacyRecord.count({ where: { sourceType: 'deal_product' } })}`);
const dealValueAfter = await prisma.deal.aggregate({ _sum: { valueMinor: true } });
console.log(`Deal.valueMinor Σ unchanged: ${String(dealValueBefore._sum.valueMinor) === String(dealValueAfter._sum.valueMinor) ? '✓' : '✗ CHANGED'}`);
let sideOk = true;
for (const tbl of SIDE) { const now = await prisma[tbl].count(); if (now !== baseline[tbl]) { sideOk = false; console.error(`  ✗ SIDE EFFECT ${tbl}: ${baseline[tbl]} → ${now}`); } }
console.log(`side effects: ${sideOk ? 'NONE ✓' : 'SEE ABOVE'}`);
await prisma.$disconnect();
