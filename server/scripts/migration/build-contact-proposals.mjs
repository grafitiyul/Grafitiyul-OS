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
  });
});
console.log(`  persons: ${personCount}`);

// 3) Deals → operational weight per contact.
const dealCount = await stream('pipedrive/deals', (d) => {
  const personId = d.person_id?.value ?? d.person_id;
  if (personId == null) return;
  const c = contacts.get(personId);
  if (!c) return;
  c.dealCount++;
  if (isActiveDeal(d, today)) c.activeDealCount++;
  if (hasFutureTour(d, today)) c.futureTourDeals++;
});
console.log(`  deals scanned: ${dealCount}`);

// 4) Build proposals.
const { proposals, stats } = buildContactProposals({ contacts: [...contacts.values()], today });
const { ruleCounts, ...printable } = stats;
console.log('\nstats:', JSON.stringify(printable, null, 2));
console.log('\nnormalisation rules applied:', JSON.stringify(ruleCounts, null, 2));

// The audit measured PHONE clusters only, so reconcile against the phone-only
// breakdown. Email clusters are an addition on top (reported separately).
console.log('\nAUDIT RECONCILIATION — phone clusters only (M1b baseline):');
const line = (label, actual, expected) => console.log(`  ${label.padEnd(34)} ${String(actual).padStart(5)}  vs audited ${String(expected).padStart(5)}  ${actual === expected ? '✓' : '(Δ ' + (actual - expected) + ')'}`);
line('phone clusters', stats.phoneClusters, 1151);
line('contacts in clusters (summed)', stats.contactsInPhoneClustersSummed, 2402);
line('safe', stats.phoneByConfidence.safe || 0, 647);
line('probable', stats.phoneByConfidence.probable || 0, 363);
line('ambiguous ∪ shared', stats.auditAmbiguousBucket, 141);
line('shared (>2 on one number)', stats.phoneByConfidence.shared || 0, 87);
line('New Contact spam excluded', stats.newContactSpamExcluded, 3193);
console.log(`\nAdditional exact-email duplicate clusters (beyond the audit): ${stats.emailOnlyClusters}`);
console.log(`Role/shared mailboxes skipped (>2 contacts on one address): ${stats.roleEmailClustersSkipped}`);
console.log(`\nOWNER WORKLOAD:  ${stats.batchApprovable} batch-approvable  ·  ${stats.needsIndividualReview} need individual review  (of ${stats.contactsConsidered} contacts)`);

console.log('\ntop 8 needing individual review:');
for (const p of proposals.filter((x) => !x.batchApprovable).slice(0, 8)) {
  console.log(`  #${String(p.rank).padStart(4)} ${p.confidence.padEnd(9)} ${p.members.length}× ${p.members.map((m) => m.name).join(' / ').slice(0, 44).padEnd(44)} deals=${String(p.totals.deals).padStart(3)} active=${p.totals.activeDeals}`);
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
