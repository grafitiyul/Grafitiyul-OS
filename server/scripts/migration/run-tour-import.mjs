// WAVE 1 TOUR IMPORT — completed historical tours only (runbook v2).
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-tour-import.mjs \
//     --snapshot <id> [--execute] --expect-hash <HashA> --today <YYYY-MM-DD> \
//     --expect-master N --expect-wave1 N --expect-cancelled N --expect-future N
//
// --today pins the wave date so the plan (and Hash A) cannot drift across
// midnight between rehearsal and execution.
// HARD GATES: Hash A, population equation, expected populations, Law 1+2
// structural assertions, side-effect baseline proof. Idempotent + resume-safe.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { planTourImport, checkTourExecutionGates, executeTourPlan } from '../../src/migration/import/tourImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const expectHash = arg('--expect-hash');
const today = arg('--today');
const EXECUTE = process.argv.includes('--execute');
if (!snapshotId || !today) { console.error('usage: --snapshot <id> [--execute] --expect-hash <sha256> --today <YYYY-MM-DD>'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

// ── inputs (identical to the rehearsal via the shared normalizer) ─────────────
const { masterTours, coordRows, payrollRows } = await loadNormalizedTourLayer(snapshotId);
const [xwalk, personRefs, legacyDeals] = await Promise.all([
  prisma.legacyRecord.findMany({ where: { OR: [{ sourceSystem: 'pipedrive', sourceType: 'deal' }, { sourceSystem: 'airtable', sourceType: 'tour' }] }, select: { sourceSystem: true, sourceType: true, sourceId: true, entityId: true } }),
  prisma.personRef.findMany({ select: { id: true, email: true } }),
  prisma.deal.findMany({ where: { orderNo: { lt: 27000 } }, select: { orderNo: true, activityType: true } }),
]);
const dealXwalk = new Map(xwalk.filter((x) => x.sourceType === 'deal').map((x) => [x.sourceId, x.entityId]));
const existingTourXwalk = new Map(xwalk.filter((x) => x.sourceType === 'tour' && x.entityId).map((x) => [x.sourceId, x.entityId]));
const personRefByEmail = new Map(personRefs.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p.id]));
const dealMetaByLegacyId = new Map(legacyDeals.map((d) => [d.orderNo, { activityType: d.activityType }]));
console.log(`inputs: master ${masterTours.length} · coord ${coordRows.length} · payroll ${payrollRows.length} · deal xwalk ${dealXwalk.size} · tours done ${existingTourXwalk.size} · today pinned ${today}`);

// ── plan + gates ──────────────────────────────────────────────────────────────
const plan = planTourImport({ masterTours, coordRows, payrollRows, dealXwalk, dealMetaByLegacyId, personRefByEmail, existingTourXwalk, today });
console.log(`plan hash: ${plan.payloadHash}`);
const s = plan.stats;
console.log(`create ${s.create} · already ${s.alreadyImported} · cancelled-excluded ${s.cancelledExcluded} · postponed-excluded ${s.postponedExcluded} · deferred-future ${s.deferredFuture}`);

// Expected populations come from the approved rehearsal output — never stale
// constants (the future/completed split moves with the pinned date).
const expected = {
  masterTours: Number(arg('--expect-master')),
  wave1: Number(arg('--expect-wave1')),
  cancelled: Number(arg('--expect-cancelled')),
  future: Number(arg('--expect-future')),
};
if (Object.values(expected).some((v) => !Number.isFinite(v))) {
  console.error('missing --expect-master/--expect-wave1/--expect-cancelled/--expect-future (from the rehearsal output)');
  await prisma.$disconnect(); process.exit(1);
}
const gates = checkTourExecutionGates({ plan, expectHash, expected });
console.log(`\nHARD GATES: ${gates.ok ? 'ALL PASS ✓' : 'REFUSED'}`);
for (const f of gates.failures) console.error(`  ✗ ${f}`);
if (!gates.ok) { await prisma.$disconnect(); process.exit(2); }

// ── side-effect baseline: everything Wave 1 must NOT touch ────────────────────
const SIDE_TABLES = ['task', 'quoteOffer', 'quoteDocument', 'paymentRequest', 'dealPaymentLink', 'icountDocument', 'emailThread', 'whatsAppChat', 'operationalIssue'];
const baseline = {};
for (const tbl of SIDE_TABLES) baseline[tbl] = await prisma[tbl].count();
const gcalBaseline = await prisma.tourEvent.count({ where: { gcalEventId: { not: null } } });
const wooBaseline = await prisma.tourEvent.count({ where: { wooSyncStatus: { not: null } } });
console.log(`side-effect baseline: ${SIDE_TABLES.length} tables · gcal-linked ${gcalBaseline} · woo-flagged ${wooBaseline}`);

if (!EXECUTE) { console.log('\n--dry: gates green, nothing written.'); await prisma.$disconnect(); process.exit(0); }

// ── the frozen-evidence payroll component (find-or-create, idempotent) ────────
const component = await prisma.payrollComponent.upsert({
  where: { key: 'migration_historical' },
  create: {
    key: 'migration_historical', nameHe: 'שכר היסטורי — מערכת קודמת',
    kind: 'manual', sign: 1, vatMode: 'net', scope: 'tour',
    officeAlways: false, guideVisible: true, isSystem: true,
    // inactive: renders on existing lines, never offered for NEW entries.
    active: false,
  },
  update: {},
});
console.log(`frozen-evidence payroll component: ${component.id} (key migration_historical, active:false)`);

// ── execute ───────────────────────────────────────────────────────────────────
const batchId = `tours-w1-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({
  data: { kind: 'import', target: 'import.tours.wave1', status: 'running', snapshotId, batchId, startedAt: new Date(), counters: { ...s, exclusionRule: 'cancelled_tour_not_migrated', hashA: plan.payloadHash } },
});
console.log(`\nexecuting batch ${batchId} (run ${run.id})…`);
const t0 = Date.now();
try {
  const res = await executeTourPlan(prisma, plan, {
    batchId, snapshotId, historicalComponentId: component.id, chunk: 500,
    log: (m) => console.log(m),
    checkpoint: async (c) => prisma.migrationRun.update({ where: { id: run.id }, data: { counters: { ...s, ...c, hashA: plan.payloadHash } } }),
  });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { ...s, written: res.written, evidence: res.evidence, hashA: plan.payloadHash } } });
  console.log(`\n✔ wrote ${res.written} tours + ${res.evidence} evidence rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('\nFAILED:', e?.message || e);
  console.error('Chunks are transactional and crosswalked — re-running resumes from the last completed chunk.');
  process.exit(3);
}

// ── post-run verification ─────────────────────────────────────────────────────
console.log('\n══════ POST-RUN VERIFICATION ══════');
const tourXwalkCount = await prisma.legacyRecord.count({ where: { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } } });
const evidenceCount = await prisma.legacyRecord.count({ where: { sourceSystem: 'airtable', entityId: null } });
console.log(`1. MigrationRun ${run.id} · ${batchId} · done`);
console.log(`2. tour crosswalk rows (with entity): ${tourXwalkCount}`);
console.log(`   legacy-evidence rows (no entity): ${evidenceCount}`);
const migTours = { total: await prisma.tourEvent.count({ where: { completedReason: 'migration' } }) };
for (const k of ['group_slot', 'private', 'business']) migTours[k] = await prisma.tourEvent.count({ where: { completedReason: 'migration', kind: k } });
console.log(`3. imported tours ${migTours.total} · kinds ${JSON.stringify(migTours)}`);
console.log(`4. NO future imported tour: ${await prisma.tourEvent.count({ where: { completedReason: 'migration', date: { gte: today } } })} (expected 0)`);
console.log(`   NO cancelled imported tour: ${await prisma.tourEvent.count({ where: { completedReason: 'migration', status: { not: 'completed' } } })} (expected 0)`);
console.log(`5. bookings on imported tours: ${await prisma.booking.count({ where: { tourEvent: { completedReason: 'migration' } } })}`);
console.log(`6. registrations (source=migration): ${await prisma.ticketRegistration.count({ where: { source: 'migration' } })}`);
console.log(`7. assignments on imported tours: ${await prisma.tourAssignment.count({ where: { tourEvent: { completedReason: 'migration' } } })}`);
console.log(`8. payroll activities on imported tours: ${await prisma.payrollActivity.count({ where: { tourEvent: { completedReason: 'migration' } } })}`);
console.log(`   payroll entries (frozen): ${await prisma.payrollEntry.count({ where: { activity: { tourEvent: { completedReason: 'migration' } } } })}`);
let sideOk = true;
for (const tbl of SIDE_TABLES) {
  const now = await prisma[tbl].count();
  if (now !== baseline[tbl]) { sideOk = false; console.error(`9. ✗ SIDE EFFECT: ${tbl} ${baseline[tbl]} → ${now}`); }
}
const gcalNow = await prisma.tourEvent.count({ where: { gcalEventId: { not: null } } });
const wooNow = await prisma.tourEvent.count({ where: { wooSyncStatus: { not: null } } });
console.log(`9. side effects: ${sideOk && gcalNow === gcalBaseline && wooNow === wooBaseline ? 'NONE ✓' : 'SEE ABOVE'} (gcal ${gcalBaseline}→${gcalNow} · woo ${wooBaseline}→${wooNow})`);
console.log(`10. imported tours pending gcal sync: ${await prisma.tourEvent.count({ where: { completedReason: 'migration', gcalSyncStatus: { not: null } } })} (expected 0 — never considered)`);
await prisma.$disconnect();
