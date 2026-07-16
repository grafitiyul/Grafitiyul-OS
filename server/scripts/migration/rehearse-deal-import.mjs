// DEAL IMPORT REHEARSAL — fully read-only against production entities.
// Runs the canonical planner TWICE and proves deterministic identical output.
// The only writes are MigrationDecision rows for the FOCUSED review sections
// (--seed), never Deals, never anything live.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/rehearse-deal-import.mjs --snapshot <id> [--seed]
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { buildStageMap, resolveFieldKeys, planDealImport } from '../../src/migration/import/dealImport.js';
import { getDeadDealIds } from '../../src/migration/review/service.js';
import { isActiveDeal, DEAL_TOURDATE } from '../../src/migration/review/orgProposals.js';
import { dealSubjectKey } from '../../src/migration/review/dealImpact.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const SEED = process.argv.includes('--seed');
if (!snapshotId) { console.error('usage: --snapshot <id> [--seed]'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
async function stream(key, visit) {
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}

// ── sources ───────────────────────────────────────────────────────────────────
const ref = JSON.parse(await r2.getObjectText(`snapshots/${snapshotId}/pipedrive/reference/reference.json`));
const fieldKeys = resolveFieldKeys(ref.dealFields);
const deals = [];
await stream('pipedrive/deals', (d) => deals.push({ ...d, archived: d.is_archived === true || d.archived === true }));
const participantsByDeal = new Map();
await stream('pipedrive/deal_participants', (l) => {
  if (!participantsByDeal.has(l.deal_id)) participantsByDeal.set(l.deal_id, []);
  participantsByDeal.get(l.deal_id).push(l.person_id);
});
console.log(`snapshot: ${deals.length} deals · reference stages ${ref.stages.length}`);

// ── ledger + crosswalk + GOS config ──────────────────────────────────────────
const [stageConfigRows, dealDecisions, xwalkRows, gosStages, deadDeals] = await Promise.all([
  prisma.migrationDecision.findMany({ where: { queue: 'stage_config' } }),
  prisma.migrationDecision.findMany({ where: { queue: 'deals' } }),
  prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: { in: ['person', 'organization', 'deal'] } }, select: { sourceType: true, sourceId: true, entityType: true, entityId: true } }),
  prisma.dealStage.findMany({ select: { id: true, key: true } }),
  getDeadDealIds(prisma),
]);
const personXwalk = new Map();
const orgXwalk = new Map();
const existingDealXwalk = new Map();
// A person crosswalked to a survivor contact = merged resolution.
const contactSources = new Map();
for (const r of xwalkRows) {
  if (r.sourceType === 'person') {
    personXwalk.set(r.sourceId, r.entityType ? { entityType: r.entityType, entityId: r.entityId } : null);
    if (r.entityType === 'Contact') contactSources.set(r.entityId, (contactSources.get(r.entityId) || 0) + 1);
  } else if (r.sourceType === 'organization') orgXwalk.set(r.sourceId, r.entityId);
  else existingDealXwalk.set(r.sourceId, r.entityId);
}
for (const [sid, hit] of personXwalk) {
  if (hit?.entityType === 'Contact' && contactSources.get(hit.entityId) > 1) hit.merged = true;
}
const gosStageIdByKey = new Map(gosStages.map((s) => [s.key, s.id]));
console.log(`crosswalk: persons ${personXwalk.size} · orgs ${orgXwalk.size} · deals already imported ${existingDealXwalk.size}`);
console.log(`GOS stages: ${[...gosStageIdByKey.keys()].join(', ')}`);

const stageMap = buildStageMap({ stageConfigRows, pipelines: ref.pipelines, stages: ref.stages });
console.log(`stage map: ${stageMap.byStageId.size}/${ref.stages.length} stages mapped · unmapped: ${stageMap.unmapped.map((u) => `${u.pipeline}/${u.stage}`).join(' · ') || 'none'}`);

// ── run the planner TWICE — determinism is proven, not assumed ────────────────
const inputs = { deals, participantsByDeal, dealDecisions, stageMap, fieldKeys, personXwalk, orgXwalk, gosStageIdByKey, users: ref.users, existingDealXwalk };
const run1 = planDealImport(inputs);
const run2 = planDealImport(inputs);
console.log('\n══════ DETERMINISM ══════');
console.log(`  run 1 hash: ${run1.payloadHash}`);
console.log(`  run 2 hash: ${run2.payloadHash}`);
console.log(`  identical: ${run1.payloadHash === run2.payloadHash ? '✓' : '✗ FAIL'} · payload bytes: ${run1.payloadBytes.toLocaleString()}`);

const s = run1.stats;
console.log('\n══════ REHEARSAL TOTALS ══════');
console.log(`  source deals              ${s.sourceDeals}`);
console.log(`  planned create            ${s.create}  (of which corrected ${s.corrected})`);
console.log(`  planned merge             ${s.merged}`);
console.log(`  planned exclude           ${s.excluded}`);
console.log(`  owner-deleted             ${s.ownerDeleted}`);
console.log(`  already imported          ${s.alreadyImported}`);
console.log(`  RECONCILES: ${s.create + s.merged + s.excluded + s.ownerDeleted + s.alreadyImported + run1.problems.length} + problems? source=${s.sourceDeals}`);
console.log(`  by status: open ${s.byStatus.open} · won ${s.byStatus.won} · lost ${s.byStatus.lost} · other ${s.byStatus.other} · archived ${s.archived}`);
console.log(`  contacts: primary resolved ${s.contactsResolvedPrimary} (merged-resolution ${s.contactsMergedResolution}) · identity excluded/deleted ${s.identityExcludedOrDeleted} · dangling ${s.danglingPersonRefs} · NO contact ${s.noContact}`);
console.log(`  participants linked       ${s.participantLinks}`);
console.log(`  organizations resolved    ${s.orgsResolved} · units ${s.unitsResolved} · NO organization ${s.noOrganization} · dangling org refs ${s.danglingOrgRefs}`);
console.log(`  stage: mapped ${s.stageMapped} · unmapped-with-deals ${s.stageUnmappedWithDeals} · status/stage contradictions ${s.statusStageContradictions}`);
console.log(`  legacy cards              ${s.legacyCards}`);
console.log(`  blocking problems         ${run1.problems.length}`);
console.log(`  non-blocking warnings     ${run1.warnings.length}`);
const byKind = (list) => Object.entries(list.reduce((a, x) => ({ ...a, [x.kind]: (a[x.kind] || 0) + 1 }), {})).map(([k, n]) => `${k}:${n}`).join(' · ');
console.log(`    problems by kind: ${byKind(run1.problems) || '—'}`);
console.log(`    warnings by kind: ${byKind(run1.warnings) || '—'}`);

// ── focused review sections (the owner workload) ─────────────────────────────
const num = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
const dealById = new Map(deals.map((d) => [d.id, d]));
const sections = new Map(); // dealId → section
const put = (id, sec) => { if (!sections.has(id)) sections.set(id, sec); };
for (const p of run1.problems) put(p.dealId, 'blocking');
for (const d of deals) {
  if (deadDeals.has(d.id)) { put(d.id, 'owner_deleted'); continue; }
  if (d.status === 'open' && d.archived) put(d.id, 'archived_open');
  else if (d.status === 'open' && d[DEAL_TOURDATE] && String(d[DEAL_TOURDATE]).slice(0, 10) < today) put(d.id, 'open_past_tour');
  else if (isActiveDeal(d, today)) put(d.id, 'open_active');
}
for (const w of run1.warnings) {
  if (w.kind === 'person_dangling') put(w.dealId, 'identity_problem');
  if (w.kind === 'status_stage') put(w.dealId, 'stage_anomaly');
}
// Broken Airtable links (already measured in the exceptional queue) ride along.
const excRows = await prisma.migrationDecision.findMany({ where: { queue: 'exceptional' } });
let airtableBroken = 0;
for (const r of excRows) {
  if (['broken_tour_link', 'broken_collection_link'].includes(r.proposal?.exceptionKind)) airtableBroken++;
  if (r.proposal?.exceptionKind === 'spam_contact_with_deal') {
    for (const rec of r.proposal.records || []) if (rec.entity === 'pipedrive/deals') put(rec.id, 'identity_problem');
  }
}
// Suspicious zero-value WON deals (historical) — shown, never mandatory.
for (const d of deals) {
  if (d.status === 'won' && Number(d.value || 0) === 0 && !sections.has(d.id) && !deadDeals.has(d.id)) put(d.id, 'zero_value_won');
}
const secCounts = {};
for (const v of sections.values()) secCounts[v] = (secCounts[v] || 0) + 1;
console.log('\n══════ OWNER WORKLOAD SECTIONS ══════');
for (const [k, n] of Object.entries(secCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${n}`);
console.log(`  no_decision_required ${deals.length - sections.size}`);

if (SEED) {
  let created = 0, kept = 0;
  for (const [dealId, section] of sections) {
    const d = dealById.get(dealId);
    if (!d) continue;
    const subjectKey = dealSubjectKey(dealId);
    const existing = await prisma.migrationDecision.findUnique({ where: { queue_subjectKey: { queue: 'deals', subjectKey } } });
    const proposal = {
      kind: 'deal', dealId, section,
      title: String(d.title || '').trim(), status: d.status, archived: !!d.archived,
      value: Number(d.value || 0), currency: d.currency || 'ILS',
      wonTime: d.won_time ? String(d.won_time).slice(0, 10) : null,
      tourDate: d[DEAL_TOURDATE] ? String(d[DEAL_TOURDATE]).slice(0, 10) : null,
      personSourceId: num(d.person_id), orgSourceId: num(d.org_id),
      stage: stageMap.byStageId.get(d.stage_id) || null,
      source: { entity: 'pipedrive/deals', id: dealId },
    };
    if (existing) { await prisma.migrationDecision.update({ where: { id: existing.id }, data: { proposal } }); kept++; }
    else { await prisma.migrationDecision.create({ data: { queue: 'deals', subjectKey, status: 'pending', proposal } }); created++; }
  }
  console.log(`\nseeded deals queue: ${created} created · ${kept} refreshed (decisions preserved)`);
}
console.log(`\nread-only rehearsal complete. Production Deals: ${await prisma.deal.count()} (untouched).`);
await prisma.$disconnect();
