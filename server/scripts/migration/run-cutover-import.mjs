// CUTOVER IMPORT runner — runbook v2 Stage 4, executed on FREEZE NIGHT only.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-cutover-import.mjs \
//     --final <finalSnapshotId> --snap1 snap-20260714T125052Z-aaaa \
//     --freeze-date <YYYY-MM-DD> [--execute --expect-hash <HashB>]
//
// PLAN MODE (default): read-only. Prints Hash B + every population the owner
// must approve that evening. Run it TWICE and compare hashes (determinism).
//
// EXECUTE MODE hard gates:
//   * --expect-hash must equal Hash B from the just-approved plan run
//   * TOUR_CALENDAR_SYNC_ENABLED must be 'false' (the calendar hold) so
//     imported future tours can be verified BEFORE Google invitations fire
//   * structural gates (historical=completed only, future=scheduled>=freeze)
//
// Execution order: new deals → deal merges → conflict seeding → historical
// delta tours → future tours → duplicate redirects → imported-tour delta.
// Everything is chunk-transactional, crosswalk-first idempotent, additive.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { loadNormalizedTourLayer } from '../../src/migration/import/tourNormalize.js';
import { planTourImport, executeTourPlan } from '../../src/migration/import/tourImport.js';
import { buildStageMap, resolveFieldKeys, planDealImport, executeDealPlan } from '../../src/migration/import/dealImport.js';
import {
  planFutureTours, planImportedTourDelta, planDealDelta, buildCutoverPlan, checkCutoverGates,
  executeFutureTours, executeRedirects, executeTourDelta, executeDealMerges, seedCutoverConflicts,
  DEAL_DELTA_FIELDS,
} from '../../src/migration/import/cutoverImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const finalId = arg('--final');
const snap1Id = arg('--snap1');
const freezeDate = arg('--freeze-date');
const expectHash = arg('--expect-hash');
const EXECUTE = process.argv.includes('--execute');
if (!finalId || !snap1Id || !freezeDate) { console.error('usage: --final <id> --snap1 <id> --freeze-date <YYYY-MM-DD> [--execute --expect-hash <HashB>]'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const readerOf = (id) => createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: id });
async function streamDeals(snapshotId, visit) {
  const reader = readerOf(snapshotId);
  const man = await reader.entityManifest('pipedrive/deals');
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit({ ...r, archived: r.is_archived === true || r.archived === true }); reader._shardCache.clear(); }
}
async function streamEntity(snapshotId, key, visit) {
  const reader = readerOf(snapshotId);
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}

// ── 1) shared DB inputs ───────────────────────────────────────────────────────
const [xwalkRows, personRefs, legacyDeals, gosStages, stageConfigRows, dealDecisions] = await Promise.all([
  prisma.legacyRecord.findMany({ where: { sourceSystem: { in: ['pipedrive', 'airtable'] }, sourceType: { in: ['person', 'organization', 'deal', 'tour'] } }, select: { sourceSystem: true, sourceType: true, sourceId: true, entityType: true, entityId: true } }),
  prisma.personRef.findMany({ select: { id: true, email: true } }),
  prisma.deal.findMany({ where: { orderNo: { lt: 27000 } }, select: { id: true, orderNo: true, activityType: true, title: true, status: true, dealStageId: true, valueMinor: true, currency: true, wonAt: true, lostAt: true, lostReason: true, expectedCloseDate: true, tourDate: true, tourTime: true, participants: true } }),
  prisma.dealStage.findMany({ select: { id: true, key: true } }),
  prisma.migrationDecision.findMany({ where: { queue: 'stage_config' } }),
  prisma.migrationDecision.findMany({ where: { queue: 'deals' } }),
]);
const personXwalk = new Map(); const orgXwalk = new Map(); const existingDealXwalk = new Map(); const existingTourXwalk = new Map();
for (const r of xwalkRows) {
  if (r.sourceType === 'person') personXwalk.set(r.sourceId, r.entityType ? { entityType: r.entityType, entityId: r.entityId } : null);
  else if (r.sourceType === 'organization') orgXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'deal') existingDealXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'tour' && r.entityId) existingTourXwalk.set(r.sourceId, r.entityId);
}
const personRefByEmail = new Map(personRefs.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p.id]));
const dealMetaByLegacyId = new Map(legacyDeals.map((d) => [d.orderNo, { activityType: d.activityType }]));
const gosStageIdByKey = new Map(gosStages.map((s) => [s.key, s.id]));
const stageKeyById = new Map(gosStages.map((s) => [s.id, s.key]));
console.log(`crosswalk: deals ${existingDealXwalk.size} · tours ${existingTourXwalk.size} · freeze ${freezeDate}`);

// ── 2) tour layer (FINAL snapshot) + GOS tour state ───────────────────────────
const finalLayer = await loadNormalizedTourLayer(finalId);
const importedTourIds = new Set(existingTourXwalk.values());
const [gosTours, bookings, regsNoBooking, payrollEntries, activeBookings] = await Promise.all([
  prisma.tourEvent.findMany({ select: { id: true, kind: true, status: true, date: true, startTime: true, completedReason: true } }),
  prisma.booking.findMany({ where: { tourEventId: { in: [...importedTourIds] } }, select: { id: true, tourEventId: true, dealId: true, seats: true } }),
  prisma.ticketRegistration.findMany({ where: { tourEventId: { in: [...importedTourIds] }, bookingId: null }, select: { tourEventId: true, dealId: true } }),
  prisma.payrollEntry.findMany({ where: { activity: { tourEventId: { in: [...importedTourIds] } }, externalPersonId: { startsWith: 'legacy:' } }, select: { id: true, externalPersonId: true, calcSnapshot: true, activity: { select: { id: true, tourEventId: true } } } }),
  prisma.booking.findMany({ where: { status: 'active' }, select: { dealId: true } }),
]);
const tourIdToRec = new Map([...existingTourXwalk].map(([rec, id]) => [id, rec]));
const importedState = new Map();
for (const [rec, id] of existingTourXwalk) importedState.set(rec, { tourEventId: id, activityId: null, bookings: new Map(), payroll: new Map(), registrationOnlyDeals: new Set() });
for (const b of bookings) { const st = importedState.get(tourIdToRec.get(b.tourEventId)); if (st) st.bookings.set(b.dealId, { id: b.id, seats: b.seats }); }
for (const rg of regsNoBooking) { const st = importedState.get(tourIdToRec.get(rg.tourEventId)); if (st && rg.dealId) st.registrationOnlyDeals.add(rg.dealId); }
for (const e of payrollEntries) {
  const st = importedState.get(tourIdToRec.get(e.activity.tourEventId));
  if (!st) continue;
  st.activityId = e.activity.id;
  const recId = e.externalPersonId.slice('legacy:'.length);
  st.payroll.set(recId, { entryId: e.id, totalPreVatMinor: Number(e.calcSnapshot?.totalPreVatMinor ?? 0), vatMinor: Number(e.calcSnapshot?.vatMinor ?? 0) });
}
const nativeSlots = gosTours.filter((g) => g.kind === 'group_slot' && !tourIdToRec.has(g.id));
const activeBookingDealIds = new Set(activeBookings.map((b) => b.dealId));

// ── 3) tour plans ─────────────────────────────────────────────────────────────
const historical = planTourImport({ ...finalLayer, dealXwalk: new Map([...existingDealXwalk]), dealMetaByLegacyId, personRefByEmail, existingTourXwalk, today: freezeDate });
const future = planFutureTours({ masterTours: finalLayer.masterTours, coordRows: finalLayer.coordRows, dealXwalk: new Map([...existingDealXwalk]), dealMetaByLegacyId, personRefByEmail, existingTourXwalk, nativeSlots, activeBookingDealIds, freezeDate });
const tourDelta = planImportedTourDelta({ ...finalLayer, dealXwalk: new Map([...existingDealXwalk]), importedState, freezeDate });

// ── 4) deal plans: three-way delta + new-deal creates ─────────────────────────
console.log('loading deal streams (final + snapshot #1)…');
const loadDealMapped = async (snapshotId) => {
  const ref = JSON.parse(await r2.getObjectText(`snapshots/${snapshotId}/pipedrive/reference/reference.json`));
  const fieldKeys = resolveFieldKeys(ref.dealFields);
  const stageMap = buildStageMap({ stageConfigRows, pipelines: ref.pipelines, stages: ref.stages });
  const deals = [];
  await streamDeals(snapshotId, (d) => deals.push(d));
  const participantsByDeal = new Map();
  await streamEntity(snapshotId, 'pipedrive/deal_participants', (l) => {
    if (!participantsByDeal.has(l.deal_id)) participantsByDeal.set(l.deal_id, []);
    participantsByDeal.get(l.deal_id).push(l.person_id);
  }).catch(() => {});
  const inputs = { deals, participantsByDeal, dealDecisions, stageMap, fieldKeys, personXwalk, orgXwalk, gosStageIdByKey, users: ref.users };
  const full = planDealImport({ ...inputs, existingDealXwalk: new Map() });
  const exec = planDealImport({ ...inputs, existingDealXwalk });
  const byOrderNo = new Map(full.payloads.filter((p) => p.kind === 'create').map((p) => [p.orderNo, p]));
  return { full, exec, byOrderNo, sourceCount: deals.length };
};
const snap1Deals = await loadDealMapped(snap1Id);
const finalDeals = await loadDealMapped(finalId);
const gosByOrderNo = new Map(legacyDeals.map((d) => [d.orderNo, {
  title: d.title, status: d.status, dealStageKey: stageKeyById.get(d.dealStageId) ?? null,
  valueMinor: d.valueMinor == null ? null : Number(d.valueMinor), currency: d.currency,
  wonAt: d.wonAt ? d.wonAt.toISOString() : null, lostAt: d.lostAt ? d.lostAt.toISOString() : null,
  lostReason: d.lostReason, expectedCloseDate: d.expectedCloseDate ? String(d.expectedCloseDate).slice(0, 10) : null,
  tourDate: d.tourDate, tourTime: d.tourTime, participants: d.participants,
}]));
// normalize snapshot expectedCloseDate to date-only for a fair compare
for (const m of [snap1Deals.byOrderNo, finalDeals.byOrderNo]) {
  for (const p of m.values()) { if (p.expectedCloseDate) p.expectedCloseDate = String(p.expectedCloseDate).slice(0, 10); if (p.valueMinor != null) p.valueMinor = Number(p.valueMinor); }
}
const dealDeltaPlan = planDealDelta({ snap1ByOrderNo: snap1Deals.byOrderNo, finalByOrderNo: finalDeals.byOrderNo, gosByOrderNo, existingDealXwalk });
const newDealPayloads = finalDeals.exec.payloads.filter((p) => p.kind === 'create');

// ── 5) Hash B + report ────────────────────────────────────────────────────────
const plan = buildCutoverPlan({
  historical, future, tourDelta,
  dealDelta: { ...dealDeltaPlan, newDeals: { count: newDealPayloads.length, hash: finalDeals.exec.payloadHash } },
});
const hs = historical.stats, fs = future.stats, ts = tourDelta.stats, ds = dealDeltaPlan.stats;
console.log('\n══════ CUTOVER PLAN (Hash B) ══════');
console.log(`  HASH B: ${plan.payloadHash}`);
console.log(`  freeze date: ${freezeDate} · final ${finalId} · baseline ${snap1Id}`);
console.log('\n── tours ──');
console.log(`  master ${hs.masterTours} · already imported ${hs.alreadyImported} · cancelled ${hs.cancelledExcluded} · postponed ${hs.postponedExcluded}`);
console.log(`  historical delta (completed since Wave 1): ${historical.payloads.length}`);
console.log(`  future operational: create ${fs.create} · redirected to native slots ${fs.redirectedToNative} (of ${fs.future} future)`);
console.log(`  future bookings ${fs.bookings} · registration-only ${fs.registrationOnly} · seats ${fs.seatsTotal} · assignments ${fs.assignments}`);
console.log(`  Wave-1 delta: tours touched ${ts.toursTouched} · +bookings ${ts.addBooking} · seat updates ${ts.updateSeats} · +payroll ${ts.addPayroll} · payroll replaced ${ts.replacePayrollAmount}`);
console.log(`  CONFLICTS for owner review: retro-cancelled ${ts.cancelledConflicts}`);
console.log('\n── deals ──');
console.log(`  final snapshot deals ${finalDeals.sourceCount} · new deals to create ${newDealPayloads.length}`);
console.log(`  compared ${ds.dealsCompared} · changed in source ${ds.dealsChangedInSource} · merges ${ds.merges} (${ds.fieldsMerged} fields) · CONFLICTS ${ds.conflicts}`);
console.log(`  reconciliation: ${hs.create}+${hs.alreadyImported}+${hs.cancelledExcluded}+${hs.postponedExcluded}+${fs.future} = ${hs.create + hs.alreadyImported + hs.cancelledExcluded + hs.postponedExcluded + fs.future} vs master ${hs.masterTours} ${hs.create + hs.alreadyImported + hs.cancelledExcluded + hs.postponedExcluded + fs.future === hs.masterTours ? '✓' : '✗ CHECK'}`);

const gates = checkCutoverGates({ plan, expectHash: EXECUTE ? expectHash : plan.payloadHash, freezeDate });
console.log(`\nGATES: ${gates.ok ? 'PASS ✓' : 'REFUSED'}`);
for (const f of gates.failures) console.error(`  ✗ ${f}`);

if (!EXECUTE) { console.log('\n--plan (default): read-only, nothing written. Approve Hash B, set the calendar hold, then rerun with --execute --expect-hash <HashB>.'); await prisma.$disconnect(); process.exit(gates.ok ? 0 : 2); }
if (!gates.ok) { await prisma.$disconnect(); process.exit(2); }

// ── EXECUTE gates beyond the plan ─────────────────────────────────────────────
if (process.env.TOUR_CALENDAR_SYNC_ENABLED !== 'false') {
  console.error('\n⛔ REFUSED: TOUR_CALENDAR_SYNC_ENABLED must be "false" during the cutover import.');
  console.error('   Otherwise Google invitations fire before the imported future tours are verified.');
  await prisma.$disconnect(); process.exit(2);
}
const component = await prisma.payrollComponent.findUnique({ where: { key: 'migration_historical' } });
if (!component) { console.error('⛔ payroll component migration_historical missing (Wave 1 created it)'); await prisma.$disconnect(); process.exit(2); }
const SIDE_TABLES = ['task', 'quoteOffer', 'quoteDocument', 'paymentRequest', 'dealPaymentLink', 'icountDocument', 'emailThread', 'whatsAppChat'];
const baseline = {};
for (const tbl of SIDE_TABLES) baseline[tbl] = await prisma[tbl].count();

const batchId = `cutover-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({
  data: { kind: 'import', target: 'import.cutover', status: 'running', snapshotId: finalId, batchId, startedAt: new Date(), counters: { hashB: plan.payloadHash, freezeDate, ...{ historical: historical.payloads.length, future: fs.create, redirects: fs.redirectedToNative, tourDeltaOps: ts.toursTouched, dealMerges: ds.merges, newDeals: newDealPayloads.length } } },
});
console.log(`\nexecuting cutover batch ${batchId} (run ${run.id})…`);
try {
  if (newDealPayloads.length) {
    console.log(`→ new deals (${newDealPayloads.length})…`);
    await executeDealPlan(prisma, finalDeals.exec, { batchId, snapshotId: finalId, log: (m) => console.log(m) });
  }
  if (dealDeltaPlan.merges.length) {
    console.log(`→ deal merges (${dealDeltaPlan.merges.length})…`);
    await executeDealMerges(prisma, dealDeltaPlan.merges, { gosStageIdByKey, log: (m) => console.log(m) });
  }
  const seeded = await seedCutoverConflicts(prisma, { tourConflicts: tourDelta.conflicts, dealConflicts: dealDeltaPlan.conflicts });
  console.log(`→ conflicts seeded for review: ${seeded.created} new · ${seeded.kept} refreshed`);
  if (historical.payloads.length || historical.legacyEvidence.length) {
    console.log(`→ historical delta tours (${historical.payloads.length})…`);
    await executeTourPlan(prisma, historical, { batchId, snapshotId: finalId, historicalComponentId: component.id, log: (m) => console.log(m) });
  }
  console.log(`→ future tours (${future.payloads.length})…`);
  await executeFutureTours(prisma, future.payloads, { batchId, snapshotId: finalId, log: (m) => console.log(m) });
  console.log(`→ duplicate redirects (${future.redirects.length})…`);
  await executeRedirects(prisma, future.redirects, { batchId, snapshotId: finalId, log: (m) => console.log(m) });
  console.log(`→ Wave-1 tour delta (${tourDelta.deltas.length})…`);
  const dc = await executeTourDelta(prisma, tourDelta.deltas, { historicalComponentId: component.id, log: (m) => console.log(m) });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { hashB: plan.payloadHash, freezeDate, deltaApplied: dc, historical: historical.payloads.length, future: fs.create, redirects: fs.redirectedToNative, dealMerges: ds.merges, newDeals: newDealPayloads.length, conflicts: seeded } } });
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('\nFAILED:', e?.message || e);
  console.error('All sections are additive + crosswalk/presence idempotent — rerun resumes safely.');
  process.exit(3);
}

// ── POST-RUN VERIFICATION ─────────────────────────────────────────────────────
console.log('\n══════ POST-RUN VERIFICATION ══════');
console.log(`1. scheduled migration-owned tours: ${await prisma.tourEvent.count({ where: { status: 'scheduled', id: { in: [...(await prisma.legacyRecord.findMany({ where: { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } }, select: { entityId: true } })).map((x) => x.entityId)] } } })}`);
console.log(`2. tours pending calendar (held): ${await prisma.tourEvent.count({ where: { gcalSyncStatus: 'pending' } })} · null (pre-sweep): ${await prisma.tourEvent.count({ where: { gcalSyncStatus: null, status: 'scheduled', date: { gte: freezeDate } } })}`);
console.log(`3. total tour crosswalk: ${await prisma.legacyRecord.count({ where: { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } } })}`);
console.log(`4. active-booking invariant: ${(await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM (SELECT "dealId" FROM "Booking" WHERE status='active' GROUP BY "dealId" HAVING COUNT(*)>1) d`)[0].n} duplicate-active deals (expected 0)`);
console.log(`5. pending cutover conflicts: ${await prisma.migrationDecision.count({ where: { queue: 'exceptional', subjectKey: { startsWith: 'cutover:' }, status: 'pending' } })}`);
let sideOk = true;
for (const tbl of SIDE_TABLES) {
  const now = await prisma[tbl].count();
  if (now !== baseline[tbl]) { sideOk = false; console.error(`6. ✗ SIDE EFFECT: ${tbl} ${baseline[tbl]} → ${now}`); }
}
console.log(`6. non-import side effects: ${sideOk ? 'NONE ✓' : 'SEE ABOVE'} (operationalIssue excluded — detectors may legitimately react to new future tours)`);
console.log('\n✔ Cutover import complete. NEXT: verify tours in the UI, then lift the calendar hold (unset TOUR_CALENDAR_SYNC_ENABLED) to create events + invitations ONCE.');
await prisma.$disconnect();
