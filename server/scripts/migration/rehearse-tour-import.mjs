// WAVE 1 TOUR REHEARSAL — read-only. Runs the Wave-1 planner TWICE over the
// shared normalization layer (the same one the production runner uses) and
// prints Hash A + the exclusion populations required by the runbook v2.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/rehearse-tour-import.mjs \
//     --snapshot <id> --today <YYYY-MM-DD>
//
// --today pins the wave date: Hash A is only valid for the exact date the
// production runner will also pin, so midnight cannot shift populations.
import { PrismaClient } from '@prisma/client';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { planTourImport, checkTourExecutionGates } from '../../src/migration/import/tourImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const today = arg('--today');
if (!snapshotId || !today) { console.error('usage: --snapshot <id> --today <YYYY-MM-DD>'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

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
console.log(`normalized: master ${masterTours.length} · coordination ${coordRows.length} · payroll ${payrollRows.length}`);
console.log(`GOS: deal crosswalk ${dealXwalk.size} · tours already imported ${existingTourXwalk.size} · guide emails ${personRefByEmail.size} · legacy deals ${dealMetaByLegacyId.size} · today pinned ${today}`);

// ── run the planner TWICE (determinism is a hard requirement of Hash A) ───────
const inputs = { masterTours, coordRows, payrollRows, dealXwalk, dealMetaByLegacyId, personRefByEmail, existingTourXwalk, today };
const run1 = planTourImport(inputs);
const run2 = planTourImport(inputs);
console.log('\n══════ DETERMINISM ══════');
console.log(`  run 1: ${run1.payloadHash}`);
console.log(`  run 2: ${run2.payloadHash}`);
console.log(`  identical: ${run1.payloadHash === run2.payloadHash ? '✓' : '✗ FAIL'} · bytes ${run1.payloadBytes.toLocaleString()}`);

const s = run1.stats;
console.log('\n══════ WAVE 1 POPULATIONS (runbook v2) ══════');
console.log(`  master tours            ${s.masterTours}`);
console.log(`  → Wave 1 create         ${s.create}`);
console.log(`  → already imported      ${s.alreadyImported}`);
console.log(`  → cancelled excluded    ${s.cancelledExcluded}  (Law 2 — never TourEvents)`);
console.log(`  → postponed excluded    ${s.postponedExcluded}  (never took place)`);
console.log(`  → deferred to cutover   ${s.deferredFuture}  (future at ${today})`);
const eq = s.create + s.alreadyImported + s.cancelledExcluded + s.postponedExcluded + s.deferredFuture;
console.log(`  RECONCILES: ${s.create}+${s.alreadyImported}+${s.cancelledExcluded}+${s.postponedExcluded}+${s.deferredFuture} = ${eq} vs ${s.masterTours} ${eq === s.masterTours ? '✓' : '✗ FAIL'}`);

console.log('\n══════ WAVE 1 CONTENTS ══════');
console.log(`  bookings ${s.bookings} (deal resolved) · deal missing → warning ${s.bookingsDealMissing} · orphan coordination ${s.orphanCoordRows}`);
console.log(`  registrations ${s.registrations} · seats ${s.seatsTotal}`);
console.log(`  assignments ${s.assignments} (PersonRef ${s.assignmentsPersonRef} · external ${s.assignmentsExternal})`);
console.log(`  payroll: activities ${s.payrollActivities} · entries ${s.payrollEntries}`);
console.log(`  legacy-only payroll evidence ${s.payrollLegacyOnlyRows} (cancelled-tour + unlinked rows)`);
console.log(`  legacy evidence rows total ${run1.legacyEvidence.length} · warnings ${run1.warnings.length}`);
if (run1.warnings.length) for (const w of run1.warnings.slice(0, 10)) console.log(`    ⚠ ${w.kind} · ${w.recId} · ${w.detail}`);
if (run1.warnings.length > 10) console.log(`    … +${run1.warnings.length - 10} more`);

// ── self-check the gates exactly as the production runner will apply them ─────
const expected = { masterTours: s.masterTours, wave1: s.create + s.alreadyImported, cancelled: s.cancelledExcluded, future: s.deferredFuture };
const gates = checkTourExecutionGates({ plan: run1, expectHash: run1.payloadHash, expected });
console.log(`\n══════ GATE SELF-CHECK ══════`);
console.log(`  ${gates.ok ? 'ALL GATES PASS ✓' : 'GATES FAIL'}${gates.failures.map((f) => `\n  ✗ ${f}`).join('')}`);

console.log('\n══════ HASH A ══════');
console.log(`  ${run1.payloadHash}`);
console.log(`  expected for the executor: { masterTours: ${expected.masterTours}, wave1: ${expected.wave1}, cancelled: ${expected.cancelled}, future: ${expected.future} }`);
console.log(`\nread-only rehearsal complete. Production TourEvents: ${await prisma.tourEvent.count()} (untouched).`);
await prisma.$disconnect();
process.exit(run1.payloadHash === run2.payloadHash && eq === s.masterTours && gates.ok ? 0 : 1);
