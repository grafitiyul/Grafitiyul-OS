// One-off BOUNDED pass: generate Contacts duplicate-cluster proposals from
// Snapshot #1 and persist them into MigrationDecision.
//
// Streams persons + deals + organizations ONCE each. Writes ONLY
// MigrationDecision. No Pipedrive/Airtable calls. No production-entity writes.
// No LegacyRecords. Re-running never overwrites an owner decision — only the
// evidence is refreshed.
//
// The queue holds CLUSTERS (~1,151), never the 32,475 contacts: a contact with no
// duplicate is not a decision.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/build-contact-proposals.mjs --snapshot <id> [--dry]
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { buildContactProposals, contactSubjectKey } from '../../src/migration/review/contactProposals.js';
import { isActiveDeal, hasFutureTour } from '../../src/migration/review/orgProposals.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const dry = process.argv.includes('--dry');
if (!snapshotId) { console.error('usage: --snapshot <id> [--dry]'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
// "Recent business" = a deal WON in the last half year. Anything older is history.
const RECENT_DAYS = 180;
const recentCut = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

async function stream(entityKey, visit) {
  const man = await reader.entityManifest(entityKey);
  let n = 0;
  for (const shard of man.shards || []) {
    const recs = await reader.readShard(shard.key);
    for (const r of recs) { visit(r); n++; }
    reader._shardCache.clear();
  }
  return n;
}

console.log(`building Contacts proposals from ${snapshotId} (today=${today})\n`);

// 1) Organizations → id → name (for "same organisation" evidence).
const orgNames = new Map();
await stream('pipedrive/organizations', (o) => orgNames.set(o.id, String(o.name || '').trim()));
console.log(`  organizations: ${orgNames.size}`);

// 2) Persons → the contact records we cluster. RAW phones/emails are kept.
const contacts = new Map();
const personCount = await stream('pipedrive/persons', (p) => {
  const orgId = p.org_id?.value ?? p.org_id ?? null;
  contacts.set(p.id, {
    legacyId: p.id,
    name: String(p.name || '').trim(),
    firstName: p.first_name || null,
    lastName: p.last_name || null,
    phones: (p.phone || []).map((x) => x?.value).filter((v) => String(v || '').trim()),
    emails: (p.email || []).map((x) => String(x?.value || '').trim()).filter(Boolean),
    orgId,
    orgName: orgId != null ? orgNames.get(orgId) || null : null,
    addTime: p.add_time || null,
    dealCount: 0,
    activeDealCount: 0,
    futureTourDeals: 0,
    openDealCount: 0,
    wonRecentDealCount: 0,
    activityCount: 0,
    noteCount: 0,
    fileCount: 0,
    participantCount: 0,
  });
});
console.log(`  persons: ${personCount}`);

// 3) Deals → operational weight per contact, split by business impact so the
//    review sections can be derived without re-reading the snapshot.
const dealCount = await stream('pipedrive/deals', (d) => {
  const personId = d.person_id?.value ?? d.person_id;
  if (personId == null) return;
  const c = contacts.get(personId);
  if (!c) return;
  c.dealCount++;
  if (isActiveDeal(d, today)) c.activeDealCount++;
  const future = hasFutureTour(d, today);
  if (future) c.futureTourDeals++;
  if (d.status === 'open') c.openDealCount++;
  else if (d.status === 'won' && !future && String(d.won_time || '').slice(0, 10) >= recentCut) c.wonRecentDealCount++;
});
console.log(`  deals scanned: ${dealCount}`);

// 3b) Activities / notes / files → does this contact have ANY history at all?
//     A contact with none is an empty shell: archived, never created in GOS, so it
//     can never duplicate anything. This is what dissolves most of the queue.
const bump = (personId, field) => { const c = contacts.get(personId?.value ?? personId); if (c) c[field]++; };
const actCount = await stream('pipedrive/activities', (a) => bump(a.person_id, 'activityCount'));
const noteCount = await stream('pipedrive/notes', (n) => bump(n.person_id, 'noteCount'));
const fileCount = await stream('pipedrive/files', (f) => bump(f.person_id, 'fileCount'));
console.log(`  activities: ${actCount} · notes: ${noteCount} · files: ${fileCount}`);

// Secondary participation on someone else's deal. Without this a contact that owns
// nothing of its own looks empty and would be silently dropped from the import.
const partCount = await stream('pipedrive/deal_participants', (l) => bump(l.person_id, 'participantCount'));
console.log(`  participant links: ${partCount === -1 ? 'ENTITY MISSING — shells cannot be excluded safely' : partCount}`);
if (partCount === -1) { console.error('ABORT: pipedrive/deal_participants is not in this snapshot.'); process.exit(1); }

// 4) Build proposals.
const { proposals, stats } = buildContactProposals({ contacts: [...contacts.values()], today });
const { ruleCounts, ...printable } = stats;
console.log('\nstats:', JSON.stringify(printable, null, 2));
console.log('\nnormalisation rules applied:', JSON.stringify(ruleCounts, null, 2));

// The M1b phone-cluster GROUPING is unchanged (1,151 clusters / 2,402 members) and
// must still reconcile. The CONFIDENCE split deliberately does not: the audits of
// 2026-07-15 fixed the corroboration bug and promoted 5 measured rules, so the old
// 647/363/141 split is superseded on purpose. Grouping is the invariant here.
console.log('\nGROUPING RECONCILIATION — phone clusters (M1b baseline, must still hold):');
const line = (label, actual, expected) => console.log(`  ${label.padEnd(34)} ${String(actual).padStart(5)}  vs audited ${String(expected).padStart(5)}  ${actual === expected ? '✓' : '(Δ ' + (actual - expected) + ')'}`);
line('phone clusters', stats.phoneClusters, 1151);
line('contacts in clusters (summed)', stats.contactsInPhoneClustersSummed, 2402);
line('New Contact spam excluded', stats.newContactSpamExcluded, 3193);
console.log(`\nAdditional exact-email duplicate clusters: ${stats.emailOnlyClusters}`);
console.log(`Role/shared mailboxes skipped (>2 contacts on one address): ${stats.roleEmailClustersSkipped}`);

console.log('\nOWNER WORKLOAD — business-impact sections:');
const S = stats.bySection;
const sline = (emoji, label, n) => console.log(`  ${emoji} ${label.padEnd(38)} ${String(n || 0).padStart(5)}`);
sline('  ', 'SAFE — merged automatically', S.safe);
sline('🔥', 'requires review BEFORE Identity Import', S.critical);
sline('🟠', 'recent business', S.recent);
sline('🟡', 'historical business', S.historical);
sline('⚪', 'low priority', S.low);
sline('⚫', 'no decision required (never queued)', S.none);
console.log(`  ${''.padEnd(41)} ${'—'.padStart(5)}`);
console.log(`  ${'total clusters'.padEnd(41)} ${String(stats.proposals).padStart(5)}`);
console.log(`\n  real decisions the owner faces: ${stats.decisionRequired}  (of ${stats.contactsConsidered} contacts considered)`);
console.log(`  dissolved by the empty-shell rule: ${stats.noDecisionRequired}`);

console.log('\n🔥 the clusters that must be reviewed before Identity Import:');
for (const p of proposals.filter((x) => x.section === 'critical')) {
  console.log(`  #${String(p.rank).padStart(4)} ${p.confidence.padEnd(9)} ${p.members.length}× ${p.members.map((m) => m.name).join(' / ').slice(0, 40).padEnd(40)} open=${p.totals.openDeals} tours=${p.totals.futureTourDeals} deals=${p.totals.deals}`);
}

if (dry) { console.log('\n--dry: nothing written'); await prisma.$disconnect(); process.exit(0); }

// 5) Persist. Evidence always refreshed; owner decisions never touched.
const existing = await prisma.migrationDecision.findMany({ where: { queue: 'contacts' } });
const bySubject = new Map(existing.map((r) => [r.subjectKey, r]));
let created = 0, refreshed = 0, decidedRefreshed = 0;
for (const p of proposals) {
  const subjectKey = contactSubjectKey(p);
  const row = bySubject.get(subjectKey);
  if (!row) {
    await prisma.migrationDecision.create({ data: { queue: 'contacts', subjectKey, proposal: p, status: 'pending' } });
    created++;
    continue;
  }
  await prisma.migrationDecision.update({ where: { id: row.id }, data: { proposal: p } });
  if (row.status === 'pending') refreshed++; else decidedRefreshed++;
}
console.log(`\n✔ persisted: ${created} created · ${refreshed} pending refreshed · ${decidedRefreshed} decided rows kept their decision (evidence refreshed only)`);
console.log(`   owner decisions intact: ${await prisma.migrationDecision.count({ where: { queue: 'contacts', status: { not: 'pending' } } })}`);
console.log(`   LegacyRecord (must be 0): ${await prisma.legacyRecord.count()}`);
await prisma.$disconnect();
