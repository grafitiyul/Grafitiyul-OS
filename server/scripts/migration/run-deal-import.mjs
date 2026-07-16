// PRODUCTION DEAL IMPORT — Slice: deals identity/business layer.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-deal-import.mjs \
//     --snapshot <id> [--execute] --expect-hash <sha256>
//
// HARD GATES (all refuse before any write): approved plan hash, exact totals
// (24,359 / 24,358 / 1), orderNo squatters, GOS stage keys, blocking problems.
// SIDE-EFFECT PROOF: baseline counts of every live-automation table are captured
// before and compared after — the import must change NONE of them.
// IDEMPOTENT + RESUME-SAFE: crosswalk-first; transactional 500-row chunks with
// MigrationRun checkpoints; re-running after success writes zero.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { buildStageMap, resolveFieldKeys, planDealImport, checkDealExecutionGates, executeDealPlan } from '../../src/migration/import/dealImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const expectHash = arg('--expect-hash');
const EXECUTE = process.argv.includes('--execute');
if (!snapshotId) { console.error('usage: --snapshot <id> [--execute] --expect-hash <sha256>'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
async function stream(key, visit) {
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}

// ── load sources + ledger + crosswalk (same inputs as the approved rehearsal) ─
const ref = JSON.parse(await r2.getObjectText(`snapshots/${snapshotId}/pipedrive/reference/reference.json`));
const fieldKeys = resolveFieldKeys(ref.dealFields);
const deals = [];
await stream('pipedrive/deals', (d) => deals.push({ ...d, archived: d.is_archived === true || d.archived === true }));
const participantsByDeal = new Map();
await stream('pipedrive/deal_participants', (l) => {
  if (!participantsByDeal.has(l.deal_id)) participantsByDeal.set(l.deal_id, []);
  participantsByDeal.get(l.deal_id).push(l.person_id);
});
const [stageConfigRows, dealDecisions, xwalkRows, gosStages] = await Promise.all([
  prisma.migrationDecision.findMany({ where: { queue: 'stage_config' } }),
  prisma.migrationDecision.findMany({ where: { queue: 'deals' } }),
  prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: { in: ['person', 'organization', 'deal'] } }, select: { sourceType: true, sourceId: true, entityType: true, entityId: true } }),
  prisma.dealStage.findMany({ select: { id: true, key: true } }),
]);
const personXwalk = new Map();
const orgXwalk = new Map();
const existingDealXwalk = new Map();
for (const r of xwalkRows) {
  if (r.sourceType === 'person') personXwalk.set(r.sourceId, r.entityType ? { entityType: r.entityType, entityId: r.entityId } : null);
  else if (r.sourceType === 'organization') orgXwalk.set(r.sourceId, r.entityId);
  else existingDealXwalk.set(r.sourceId, r.entityId);
}
const gosStageIdByKey = new Map(gosStages.map((s) => [s.key, s.id]));
const stageMap = buildStageMap({ stageConfigRows, pipelines: ref.pipelines, stages: ref.stages });
console.log(`sources: deals ${deals.length} · crosswalk persons ${personXwalk.size} · orgs ${orgXwalk.size} · deals done ${existingDealXwalk.size}`);

// ── plan twice: the HASH plan (empty deal crosswalk — pins the approved state)
//    and the EXECUTION plan (real crosswalk — idempotent resume) ───────────────
const baseInputs = { deals, participantsByDeal, dealDecisions, stageMap, fieldKeys, personXwalk, orgXwalk, gosStageIdByKey, users: ref.users };
const fullPlan = planDealImport({ ...baseInputs, existingDealXwalk: new Map() });
const execPlan = planDealImport({ ...baseInputs, existingDealXwalk });
console.log(`full-plan hash: ${fullPlan.payloadHash}`);
console.log(`execution plan: create ${execPlan.stats.create} · already imported ${execPlan.stats.alreadyImported} · owner-deleted ${execPlan.stats.ownerDeleted}`);

// ── HARD GATES ────────────────────────────────────────────────────────────────
const legacyRange = await prisma.deal.findMany({ where: { orderNo: { lte: 26306 } }, select: { id: true, orderNo: true } });
const ourDealIds = new Set([...existingDealXwalk.values()]);
const foreignOrderNos = legacyRange.filter((d) => !ourDealIds.has(d.id)).map((d) => d.orderNo);
const gates = checkDealExecutionGates({ fullPlan, execPlan, expectHash, gosStageIdByKey, foreignOrderNos });
console.log(`\nHARD GATES: ${gates.ok ? 'ALL PASS ✓' : 'REFUSED'}`);
for (const f of gates.failures) console.error(`  ✗ ${f}`);
if (!gates.ok) { await prisma.$disconnect(); process.exit(2); }

// ── side-effect baseline: the tables live automation writes to ────────────────
const SIDE_TABLES = ['booking', 'tourEvent', 'ticketRegistration', 'task', 'quoteOffer', 'quoteDocument', 'paymentRequest', 'dealPaymentLink', 'icountDocument', 'emailThread', 'whatsAppChat', 'operationalIssue', 'payrollEntry'];
const baseline = {};
for (const tbl of SIDE_TABLES) baseline[tbl] = await prisma[tbl].count();
console.log('side-effect baseline captured:', SIDE_TABLES.length, 'tables');

if (!EXECUTE) { console.log('\n--dry: gates green, nothing written.'); await prisma.$disconnect(); process.exit(0); }

// ── EXECUTE ───────────────────────────────────────────────────────────────────
const batchId = `deals-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({
  data: { kind: 'import', target: 'import.deals', status: 'running', snapshotId, batchId, startedAt: new Date(), counters: execPlan.stats },
});
console.log(`\nexecuting batch ${batchId} (run ${run.id})…`);
const t0 = Date.now();
try {
  const res = await executeDealPlan(prisma, execPlan, {
    batchId, snapshotId, chunk: 500,
    log: (m) => console.log(m),
    checkpoint: async (c) => prisma.migrationRun.update({ where: { id: run.id }, data: { counters: { ...execPlan.stats, ...c } } }),
  });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { ...execPlan.stats, written: res.written } } });
  console.log(`\n✔ wrote ${res.written} deals in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('\nFAILED:', e?.message || e);
  console.error('Chunks are transactional and crosswalked — re-running resumes from the last completed chunk.');
  process.exit(3);
}

// ── POST-RUN RECONCILIATION ───────────────────────────────────────────────────
console.log('\n══════ POST-RUN VERIFICATION ══════');
const dealXwalkCount = await prisma.legacyRecord.count({ where: { sourceSystem: 'pipedrive', sourceType: 'deal' } });
console.log(`1. MigrationRun ${run.id} · batch ${batchId} · status done`);
console.log(`2. deal crosswalk rows: ${dealXwalkCount} (expected 24,358)`);
console.log(`3. owner-deleted: ${24359 - dealXwalkCount} (expected 1 — deal 7086)`);
const imported = { total: await prisma.deal.count({ where: { orderNo: { lte: 26306 } } }) };
for (const st of ['open', 'won', 'lost']) imported[st] = await prisma.deal.count({ where: { orderNo: { lte: 26306 }, status: st } });
console.log(`4/5. imported deals ${imported.total} · open ${imported.open} · won ${imported.won} · lost ${imported.lost}`);
const stageTotals = await prisma.deal.groupBy({ by: ['dealStageId'], where: { orderNo: { lte: 26306 } }, _count: true });
const stageKeyById = new Map(gosStages.map((s) => [s.id, s.key]));
console.log('7. stages:', stageTotals.map((s) => `${stageKeyById.get(s.dealStageId)}:${s._count}`).join(' · '));
const links = await prisma.dealContact.count({ where: { deal: { orderNo: { lte: 26306 } } } });
const primaryLinks = await prisma.dealContact.count({ where: { isPrimary: true, deal: { orderNo: { lte: 26306 } } } });
console.log(`8/10. contact links ${links} (primary ${primaryLinks}, participants ${links - primaryLinks})`);
console.log(`9. org links: ${await prisma.deal.count({ where: { orderNo: { lte: 26306 }, organizationId: { not: null } } })}`);
console.log(`11. no-contact deals: ${imported.total - primaryLinks}`);
console.log(`12. no-organization deals: ${await prisma.deal.count({ where: { orderNo: { lte: 26306 }, organizationId: null } })}`);
console.log(`13. legacy cards: ${await prisma.legacyRecord.count({ where: { sourceType: 'deal', cardData: { not: null } } })}`);
const dupes = await prisma.$queryRaw`SELECT "orderNo", COUNT(*) c FROM "Deal" GROUP BY "orderNo" HAVING COUNT(*) > 1`;
console.log(`14. duplicate orderNo values: ${dupes.length} (expected 0)`);
let sideOk = true;
for (const tbl of SIDE_TABLES) {
  const now = await prisma[tbl].count();
  if (now !== baseline[tbl]) { sideOk = false; console.error(`15. ✗ SIDE EFFECT: ${tbl} ${baseline[tbl]} → ${now}`); }
}
console.log(`15. live side effects: ${sideOk ? 'NONE — all ' + SIDE_TABLES.length + ' automation tables unchanged ✓' : 'SEE ABOVE'}`);
console.log(`16. native GOS deals (orderNo ≥ 27000): ${await prisma.deal.count({ where: { orderNo: { gte: 27000 } } })} (expected 4)`);
console.log(`    deal 7086 absent: ${(await prisma.deal.count({ where: { orderNo: 7086 } })) === 0 ? '✓' : '✗ FAIL'}`);
await prisma.$disconnect();
