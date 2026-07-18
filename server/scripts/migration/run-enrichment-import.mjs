// MIGRATION CONTENT ENRICHMENT runner — additive, idempotent, hash-gated.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-enrichment-import.mjs \
//     --snapshot snap-20260714T125052Z-aaaa [--execute --expect-hash <hash>]
//
// Dry (default): full plan + populations + deterministic hash (run twice).
// Execute: gates on the hash, captures a side-effect baseline over everything
// enrichment must NOT touch, writes timeline/tasks/backfills/card merges,
// verifies, and a rerun plans zero.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import {
  planNoteImport, planActivityImport, planDealBackfill, planOrgEnrichment, planTourCardEnrichment,
  buildEnrichmentPlan, checkEnrichmentGates, executeEnrichment,
} from '../../src/migration/import/enrichmentImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot') || 'snap-20260714T125052Z-aaaa';
const expectHash = arg('--expect-hash');
const EXECUTE = process.argv.includes('--execute');

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
async function stream(key, visit) {
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}
const byName = (fields, name) => (fields || []).find((f) => f.name === name)?.key || null;
const optionMap = (fields) => {
  const m = new Map();
  for (const f of fields || []) for (const o of f.options || []) m.set(String(o.id), o.label);
  return m;
};

// ── reference + field keys ────────────────────────────────────────────────────
const ref = JSON.parse(await r2.getObjectText(`snapshots/${snapshotId}/pipedrive/reference/reference.json`));
const fieldKeys = {
  sourceText: byName(ref.dealFields, 'מקור'),
  sourceEnum: byName(ref.dealFields, 'מקור-רשימה סגורה'),
  inquiryContent: byName(ref.dealFields, 'תוכן הפנייה'),
};
const orgFieldKeys = {
  bizType: byName(ref.organizationFields, 'סוג העסק'),
  taxId: byName(ref.organizationFields, 'ח.פ/עוסק מורשה'),
  icountId: byName(ref.organizationFields, 'iCount_id'),
  payTerms: byName(ref.organizationFields, 'תנאי תשלום'),
  payMethod: byName(ref.organizationFields, 'אמצעי תשלום'),
  orderFormLink: byName(ref.organizationFields, 'קישור קבוע לטופס הזמנה'),
};
const userName = new Map((ref.users || []).map((u) => [u.id, String(u.name || '').trim()]));
const typeLabel = new Map((ref.activityTypes || []).map((x) => [x.key_string ?? x.key, x.name]));
console.log(`field keys: source ${fieldKeys.sourceText?.slice(0, 8)} · enum ${fieldKeys.sourceEnum?.slice(0, 8)} · inquiry ${fieldKeys.inquiryContent?.slice(0, 8)} · bizType ${orgFieldKeys.bizType?.slice(0, 8)} · activity types ${typeLabel.size}`);

// ── DB state ──────────────────────────────────────────────────────────────────
const [xwalkRows, gosDealsRaw, gosOrgsRaw, dealSources, orgTypes, admins, orgCardsRaw, tourCardsRaw] = await Promise.all([
  prisma.legacyRecord.findMany({ where: { OR: [
    { sourceSystem: 'pipedrive', sourceType: { in: ['person', 'organization', 'deal', 'note', 'activity', 'deal_inquiry'] } },
    { sourceSystem: 'airtable', sourceType: 'tour', entityId: { not: null } },
  ] }, select: { sourceSystem: true, sourceType: true, sourceId: true, entityType: true, entityId: true } }),
  prisma.deal.findMany({ where: { orderNo: { lt: 27000 } }, select: { id: true, orderNo: true, source: true, dealSourceId: true } }),
  prisma.organization.findMany({ select: { id: true, organizationTypeId: true, taxId: true } }),
  prisma.dealSource.findMany({ select: { id: true, label: true } }),
  prisma.organizationType.findMany({ select: { id: true, label: true } }),
  prisma.adminUser.findMany({ where: { isActive: true }, select: { id: true, username: true }, orderBy: { createdAt: 'asc' } }),
  prisma.legacyRecord.findMany({ where: { entityType: 'Organization', cardData: { not: null } }, select: { entityId: true, cardData: true } }),
  prisma.legacyRecord.findMany({ where: { entityType: 'TourEvent', cardData: { not: null } }, select: { entityId: true, cardData: true } }),
]);
const dealXwalk = new Map(); const personXwalk = new Map(); const orgXwalk = new Map();
const existingNoteXwalk = new Map(); const existingActivityXwalk = new Map(); const existingInquiryXwalk = new Map();
const tourXwalk = new Map();
for (const r of xwalkRows) {
  if (r.sourceType === 'deal') dealXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'person') personXwalk.set(r.sourceId, r.entityType ? { entityType: r.entityType, entityId: r.entityId } : null);
  else if (r.sourceType === 'organization') orgXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'note') existingNoteXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'activity') existingActivityXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'deal_inquiry') existingInquiryXwalk.set(r.sourceId, r.entityId);
  else if (r.sourceType === 'tour') tourXwalk.set(r.sourceId, r.entityId);
}
const gosDeals = new Map(gosDealsRaw.map((d) => [d.orderNo, d]));
const gosOrgs = new Map(gosOrgsRaw.map((o) => [o.id, o]));
const dealSourceIdByLabel = new Map(dealSources.map((s) => [String(s.label).trim().toLowerCase(), s.id]));
const typeIdByLabel = new Map(orgTypes.map((x) => [x.label, x.id]));
const taskOwner = admins.find((a) => a.username === 'admin') || admins[0];
if (!taskOwner) { console.error('no active AdminUser — cannot own imported tasks'); process.exit(1); }
const orgCards = new Map(orgCardsRaw.map((r) => [r.entityId, r.cardData]));
const tourCards = new Map(tourCardsRaw.map((r) => [r.entityId, r.cardData]));
console.log(`xwalk: deals ${dealXwalk.size} · persons ${personXwalk.size} · orgs ${orgXwalk.size} · tours ${tourXwalk.size} · notes done ${existingNoteXwalk.size} · activities done ${existingActivityXwalk.size}`);
console.log(`task owner: ${taskOwner.username} (${taskOwner.id})`);

// ── stream sources ────────────────────────────────────────────────────────────
console.log('loading snapshot streams…');
const deals = [];
await stream('pipedrive/deals', (d) => deals.push({
  id: d.id, add_time: d.add_time, status: d.status,
  archived: d.is_archived === true || d.archived === true,
  [fieldKeys.sourceText]: d[fieldKeys.sourceText],
  [fieldKeys.sourceEnum]: d[fieldKeys.sourceEnum],
  [fieldKeys.inquiryContent]: d[fieldKeys.inquiryContent],
}));
const openDealGosIds = new Set(deals.filter((d) => d.status === 'open' && !d.archived && dealXwalk.has(String(d.id))).map((d) => dealXwalk.get(String(d.id))));
const notes = [];
await stream('pipedrive/notes', (n) => notes.push({ id: n.id, content: n.content, deal_id: n.deal_id, person_id: n.person_id, org_id: n.org_id, user_id: n.user_id, add_time: n.add_time }));
const activities = [];
await stream('pipedrive/activities', (a) => activities.push({
  id: a.id, type: a.type, done: a.done, subject: a.subject, note: a.note,
  due_date: a.due_date, due_time: a.due_time, marked_as_done_time: a.marked_as_done_time,
  add_time: a.add_time, deal_id: a.deal_id, person_id: a.person_id, org_id: a.org_id,
  user_id: a.user_id, assigned_to_user_id: a.assigned_to_user_id,
}));
const orgs = [];
await stream('pipedrive/organizations', (o) => orgs.push(o));
const tourRecords = [];
await stream('airtable/main/tblTI7iaGm6qsQA4a', (r) => tourRecords.push(r));
const participantRecords = [];
await stream('airtable/main/tbl1JaGS5oKRIkJ9z', (r) => participantRecords.push(r));
console.log(`sources: deals ${deals.length} · notes ${notes.length} · activities ${activities.length} · orgs ${orgs.length} · tours ${tourRecords.length} · participants ${participantRecords.length} · open GOS deals ${openDealGosIds.size}`);

// ── plan ──────────────────────────────────────────────────────────────────────
const optLabels = optionMap([...(ref.dealFields || []), ...(ref.organizationFields || [])]);
const plan = buildEnrichmentPlan({
  notes: planNoteImport({ notes, dealXwalk, personXwalk, orgXwalk, existingNoteXwalk, userName }),
  activities: planActivityImport({ activities, dealXwalk, personXwalk, orgXwalk, openDealGosIds, existingActivityXwalk, userName, typeLabel, taskOwnerUserId: taskOwner.id }),
  dealBackfill: planDealBackfill({ deals, fieldKeys, sourceOptionLabel: optLabels, dealSourceIdByLabel, gosDeals, existingInquiryXwalk }),
  orgs: planOrgEnrichment({ orgs, orgFieldKeys, orgOptionLabel: optLabels, typeIdByLabel, orgXwalk, gosOrgs, existingCards: orgCards }),
  tourCards: planTourCardEnrichment({ tourRecords, participantRecords, tourXwalk, existingCards: tourCards }),
});

console.log('\n══════ ENRICHMENT PLAN ══════');
console.log(`  HASH: ${plan.payloadHash} · ${(plan.payloadBytes / 1048576).toFixed(1)} MB`);
console.log(`  notes → timeline: ${JSON.stringify(plan.notes.stats)}`);
console.log(`  activities: ${JSON.stringify(plan.activities.stats)}`);
console.log(`  deal backfill: ${JSON.stringify({ ...plan.dealBackfill.stats, unmatchedLabels: undefined })}`);
console.log(`    unmatched source labels (top): ${JSON.stringify(plan.dealBackfill.stats.unmatchedLabels)}`);
console.log(`  orgs: ${JSON.stringify(plan.orgs.stats)}`);
console.log(`  tour cards: ${JSON.stringify(plan.tourCards.stats)}`);

const gates = checkEnrichmentGates({ plan, expectHash: EXECUTE ? expectHash : plan.payloadHash });
console.log(`\nGATES: ${gates.ok ? 'PASS ✓' : 'REFUSED'}`);
for (const f of gates.failures) console.error(`  ✗ ${f}`);
if (!EXECUTE) { console.log('\n--dry: nothing written. Re-run to confirm the hash, then --execute --expect-hash <hash>.'); await prisma.$disconnect(); process.exit(gates.ok ? 0 : 2); }
if (!gates.ok) { await prisma.$disconnect(); process.exit(2); }

// ── side-effect baseline: everything enrichment must NOT touch ────────────────
const SIDE_TABLES = ['whatsAppScheduledMessage', 'emailThread', 'paymentRequest', 'dealPaymentLink', 'icountDocument', 'quoteOffer', 'quoteDocument', 'payrollEntry', 'tourEvent', 'booking', 'ticketRegistration', 'operationalIssue'];
const baseline = {};
for (const tbl of SIDE_TABLES) baseline[tbl] = await prisma[tbl].count();
const gcalBaseline = await prisma.tourEvent.count({ where: { gcalEventId: { not: null } } });

const batchId = `enrich-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({
  data: { kind: 'import', target: 'import.enrichment', status: 'running', snapshotId, batchId, startedAt: new Date(), counters: { hash: plan.payloadHash, notes: plan.notes.stats.create, activitiesTimeline: plan.activities.stats.doneTimeline + plan.activities.stats.openTimeline, tasks: plan.activities.stats.activeTasks } },
});
console.log(`\nexecuting batch ${batchId} (run ${run.id})…`);
const t0 = Date.now();
try {
  const res = await executeEnrichment(prisma, plan, {
    batchId, snapshotId, log: (m) => console.log(m),
    checkpoint: async (c) => prisma.migrationRun.update({ where: { id: run.id }, data: { counters: { hash: plan.payloadHash, ...c } } }),
  });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { hash: plan.payloadHash, ...res } } });
  console.log(`\n✔ done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(res)}`);
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('\nFAILED:', e?.message || e);
  console.error('Everything is crosswalked/fill-null-only — rerun resumes safely.');
  process.exit(3);
}

// ── verification ──────────────────────────────────────────────────────────────
console.log('\n══════ POST-RUN VERIFICATION ══════');
console.log(`1. imported timeline entries: ${await prisma.timelineEntry.count({ where: { actorType: 'import' } })}`);
console.log(`2. imported active tasks: ${await prisma.task.count({ where: { status: 'open', deal: { orderNo: { lt: 27000 } } } })} (open tasks on legacy deals)`);
console.log(`3. note crosswalk: ${await prisma.legacyRecord.count({ where: { sourceType: 'note' } })} · activity crosswalk: ${await prisma.legacyRecord.count({ where: { sourceType: 'activity' } })} · inquiry: ${await prisma.legacyRecord.count({ where: { sourceType: 'deal_inquiry' } })}`);
console.log(`4. deals with source: ${await prisma.deal.count({ where: { orderNo: { lt: 27000 }, source: { not: null } } })} · with catalog source: ${await prisma.deal.count({ where: { orderNo: { lt: 27000 }, dealSourceId: { not: null } } })}`);
console.log(`5. orgs classified: ${await prisma.organization.count({ where: { organizationTypeId: { not: null } } })} · with taxId: ${await prisma.organization.count({ where: { taxId: { not: null } } })}`);
let sideOk = true;
for (const tbl of SIDE_TABLES) {
  const now = await prisma[tbl].count();
  if (now !== baseline[tbl]) { sideOk = false; console.error(`6. ✗ SIDE EFFECT: ${tbl} ${baseline[tbl]} → ${now}`); }
}
const gcalNow = await prisma.tourEvent.count({ where: { gcalEventId: { not: null } } });
console.log(`6. side effects: ${sideOk && gcalNow === gcalBaseline ? 'NONE ✓' : 'SEE ABOVE'} (gcal ${gcalBaseline}→${gcalNow})`);
await prisma.$disconnect();
