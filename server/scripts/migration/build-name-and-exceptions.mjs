// One-off BOUNDED pass: generate Name Cleanup + Exceptional Records proposals from
// Snapshot #1 and the existing decision ledger.
//
// Streams the snapshot ONCE. Writes ONLY MigrationDecision. No Pipedrive/Airtable
// calls. No production-entity writes. No LegacyRecords. Re-running never overwrites
// an owner decision — only the evidence is refreshed.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/build-name-and-exceptions.mjs --snapshot <id> [--dry]
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { isActiveDeal, hasFutureTour, DEAL_TOURDATE } from '../../src/migration/review/orgProposals.js';
import { isNewContactName } from '../../src/migration/phoneCompare.js';
import { buildNameCleanupProposals, nameSubjectKey } from '../../src/migration/review/nameCleanup.js';
import { buildExceptions, exceptionSubjectKey } from '../../src/migration/review/exceptions.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const dry = process.argv.includes('--dry');
if (!snapshotId) { console.error('usage: --snapshot <id> [--dry]'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const RECENT_DAYS = 180;
const recentCut = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const pid = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
async function stream(key, visit) {
  const man = await reader.entityManifest(key).catch(() => null);
  if (!man) return -1;
  let n = 0;
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) { visit(r); n++; } reader._shardCache.clear(); }
  return n;
}

console.log(`building Name Cleanup + Exceptions from ${snapshotId} (today=${today})\n`);

const orgNames = new Map();
await stream('pipedrive/organizations', (o) => orgNames.set(o.id, String(o.name || '').trim()));

const contacts = new Map();
await stream('pipedrive/persons', (p) => {
  const orgId = pid(p.org_id);
  contacts.set(p.id, {
    legacyId: p.id, name: String(p.name || '').trim(),
    firstName: p.first_name || null, lastName: p.last_name || null,
    phones: (p.phone || []).map((x) => x?.value).filter((v) => String(v || '').trim()),
    emails: (p.email || []).map((x) => String(x?.value || '').trim()).filter(Boolean),
    orgId, orgName: orgId != null ? orgNames.get(orgId) || null : null,
    dealCount: 0, activeDealCount: 0, futureTourDeals: 0, openDealCount: 0,
    wonRecentDealCount: 0, activityCount: 0, noteCount: 0, fileCount: 0,
    dealStatuses: [],
  });
});
const deals = [];
await stream('pipedrive/deals', (d) => {
  const personId = pid(d.person_id);
  const orgId = pid(d.org_id);
  const c = contacts.get(personId);
  const future = hasFutureTour(d, today);
  if (c) {
    c.dealCount++;
    if (isActiveDeal(d, today)) c.activeDealCount++;
    if (future) c.futureTourDeals++;
    if (d.status === 'open') c.openDealCount++;
    else if (d.status === 'won' && !future && String(d.won_time || '').slice(0, 10) >= recentCut) c.wonRecentDealCount++;
    if (c.dealStatuses.length < 8) c.dealStatuses.push(d.status);
  }
  deals.push({
    id: d.id, title: String(d.title || '').trim(), status: d.status,
    archived: d.is_archived === true || d.archived === true,
    personId, orgId, orgName: orgId != null ? orgNames.get(orgId) || null : null,
    personName: c?.name || null,
    tourDate: d[DEAL_TOURDATE] ? String(d[DEAL_TOURDATE]).slice(0, 10) : null,
    value: d.value, isActive: isActiveDeal(d, today),
  });
});
const bump = (v, f) => { const c = contacts.get(pid(v)); if (c) c[f]++; };
await stream('pipedrive/activities', (a) => bump(a.person_id, 'activityCount'));
await stream('pipedrive/notes', (n) => bump(n.person_id, 'noteCount'));
await stream('pipedrive/files', (f) => bump(f.person_id, 'fileCount'));
console.log(`  persons ${contacts.size} · deals ${deals.length} · orgs ${orgNames.size}`);

// ── Name Cleanup ─────────────────────────────────────────────────────────────
const { proposals: nameProposals, stats: nameStats } = buildNameCleanupProposals({ contacts: [...contacts.values()] });
console.log('\n══════ NAME CLEANUP ══════');
console.log(`  total persons scanned          ${nameStats.totalPersons}`);
console.log(`  "New Contact" spam excluded    ${nameStats.newContactSpamExcluded}`);
console.log(`  scanned for name issues        ${nameStats.scanned}`);
console.log(`  NO cleanup required            ${nameStats.noCleanupRequired}`);
console.log(`  proposals                      ${nameProposals.length}`);
console.log(`    requires an owner decision   ${nameStats.requiresDecision}`);
console.log(`    automatically resolvable     ${nameStats.batchApprovable}  (deterministic, identity-preserving)`);
console.log(`    needs individual review      ${nameStats.needsIndividualReview}`);
console.log(`    CRITICAL before import       ${nameStats.criticalBeforeImport}`);
console.log(`    import would FAIL validation ${nameStats.blockingValidation}`);
console.log(`    proposed exclusion           ${nameStats.proposedExclusion}`);
console.log(`    empty shells (no decision)   ${nameStats.emptyShellIssues}`);
console.log('  by section:', JSON.stringify(nameStats.bySection));
console.log('  by issue  :', JSON.stringify(nameStats.byIssue));

// ── Exceptions ───────────────────────────────────────────────────────────────
const spamPersonIds = new Set([...contacts.values()].filter((c) => isNewContactName(`${c.firstName || ''} ${c.name || ''}`)).map((c) => c.legacyId));
const orgRows = await prisma.migrationDecision.findMany({ where: { queue: 'organizations' } });
const excludedOrgIds = new Set();
for (const r of orgRows) {
  for (const [legacyId, d] of Object.entries(r.decision?.dispositions || {})) {
    if (d.disposition === 'excluded') excludedOrgIds.add(Number(legacyId));
  }
}
const idRows = await prisma.migrationDecision.findMany({ where: { queue: 'contact_identity' } });
const strippedContacts = idRows
  .filter((r) => !r.decision.effective.phones.length && !r.decision.effective.emails.length)
  .map((r) => {
    const legacyId = Number(r.subjectKey.split(':')[1]);
    return { legacyId, name: r.proposal.name, activeDealCount: contacts.get(legacyId)?.activeDealCount || 0 };
  });

const dealIds = new Set(deals.map((d) => d.id));
const num = (v) => { const m = /(\d{2,})/.exec(String(Array.isArray(v) ? v[0] : v ?? '')); return m ? Number(m[1]) : null; };
const brokenTourLinks = [];
await stream('airtable/main/tbl1JaGS5oKRIkJ9z', (r) => {
  const f = r.fields || r;
  const id = num(f['פייפ דיל ID']);
  if (id == null || dealIds.has(id)) return;
  brokenTourLinks.push({ airtableId: r.id, entity: 'airtable/main/tbl1JaGS5oKRIkJ9z', dealId: id, name: String(f.Name || '').slice(0, 60), date: f['T.date'] || null });
});
const brokenCollectionLinks = [];
await stream('airtable/main/tblQIivZgMbF6J68i', (r) => {
  const f = r.fields || r;
  const id = num(f.Deal_id);
  if (id == null || dealIds.has(id)) return;
  brokenCollectionLinks.push({ airtableId: r.id, entity: 'airtable/main/tblQIivZgMbF6J68i', dealId: id, name: String(f.Name || '').slice(0, 60), date: f['תאריך סיור'] || null });
});

const nameExclusions = nameProposals
  .filter((p) => p.treatment === 'exclude' && p.importable)
  .map((p) => ({
    legacyId: p.legacyId, displayName: p.displayName,
    openDealCount: p.context.openDealCount, futureTourDeals: p.context.futureTourDeals,
    operationallyActive: p.context.operationallyActive,
  }));

const { exceptions, stats: excStats } = buildExceptions({
  deals, today,
  personIds: new Set(contacts.keys()),
  excludedOrgIds, spamPersonIds,
  spamContactsWithDeals: [...contacts.values()]
    .filter((c) => spamPersonIds.has(c.legacyId) && c.dealCount > 0)
    .map((c) => ({ legacyId: c.legacyId, name: c.name, dealCount: c.dealCount, dealStatuses: c.dealStatuses, hasActiveDeal: c.activeDealCount > 0 })),
  strippedContacts, nameExclusions, brokenTourLinks, brokenCollectionLinks,
});
console.log('\n══════ EXCEPTIONAL RECORDS ══════');
console.log(`  total                       ${excStats.total}`);
console.log(`  BLOCKS Identity Import      ${excStats.blocksIdentity}`);
console.log(`  does NOT block identity     ${excStats.nonBlocking}`);
console.log('  by kind:', JSON.stringify(excStats.byKind, null, 2));
console.log('  checked and CLEAN (0 found):', excStats.checkedAndClean.join(', ') || '—');

if (dry) { console.log('\n--dry: nothing written'); await prisma.$disconnect(); process.exit(0); }

// ── Persist ──────────────────────────────────────────────────────────────────
async function persist(queue, rows, keyOf) {
  const existing = await prisma.migrationDecision.findMany({ where: { queue } });
  const bySubject = new Map(existing.map((r) => [r.subjectKey, r]));
  let created = 0, refreshed = 0, kept = 0;
  const live = new Set();
  for (const p of rows) {
    const subjectKey = keyOf(p);
    live.add(subjectKey);
    const row = bySubject.get(subjectKey);
    if (!row) { await prisma.migrationDecision.create({ data: { queue, subjectKey, proposal: p, status: 'pending' } }); created++; continue; }
    await prisma.migrationDecision.update({ where: { id: row.id }, data: { proposal: p } });
    if (row.status === 'pending') refreshed++; else kept++;
  }
  // A proposal that no longer applies is removed ONLY if the owner never decided it.
  let removed = 0;
  for (const r of existing) {
    if (live.has(r.subjectKey)) continue;
    if (r.status !== 'pending' || r.decision) continue; // never delete a decision
    await prisma.migrationDecision.delete({ where: { id: r.id } });
    removed++;
  }
  console.log(`  ${queue}: ${created} created · ${refreshed} refreshed · ${kept} decided rows kept · ${removed} stale removed`);
}
console.log('\n── persisting ──');
await persist('name_cleanup', nameProposals, (p) => nameSubjectKey(p.legacyId));
await persist('exceptional', exceptions, (e) => exceptionSubjectKey(e.exceptionKind, e.subjectId));
console.log(`\n   LegacyRecord (must be 0): ${await prisma.legacyRecord.count()}`);
console.log(`   GOS Contacts (untouched): ${await prisma.contact.count()}`);
await prisma.$disconnect();
