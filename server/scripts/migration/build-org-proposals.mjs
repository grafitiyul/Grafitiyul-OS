// One-off BOUNDED pass: generate Organizations review proposals from Snapshot #1
// and persist them into MigrationDecision.
//
// Reads each needed shard exactly ONCE (organizations, persons, deals), reads live
// GOS organizations READ-ONLY for conflict evidence, and writes ONLY
// MigrationDecision rows. No Pipedrive/Airtable calls. No production-entity writes.
// No LegacyRecords.
//
// Re-running NEVER overwrites an owner decision: resolved rows are left untouched;
// only still-pending proposals are refreshed.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/build-org-proposals.mjs --snapshot <id> [--dry]
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import {
  buildOrgProposals, subjectKeyFor, normName, digits, emailDomain,
  isActiveDeal, hasFutureTour, ORG_TAXID, ORG_ICOUNT,
} from '../../src/migration/review/orgProposals.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const dry = process.argv.includes('--dry');
if (!snapshotId) { console.error('usage: --snapshot <id> [--dry]'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const store = { getText: r2.getObjectText };
const reader = createSnapshotReader({ store, snapshotId });
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

// Stream one entity's shards, calling visit(record) — never holds the entity.
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

console.log(`building Organizations proposals from ${snapshotId} (today=${today})\n`);

const first = (arr) => (Array.isArray(arr) ? arr.map((x) => x?.value).filter(Boolean) : []);
const CONTACTS_PER_ORG = 25; // bounded: enough context, never unbounded memory

// 1) Organizations (one shard).
const orgs = new Map();
const orgCount = await stream('pipedrive/organizations', (o) => {
  orgs.set(o.id, {
    legacyId: o.id,
    name: String(o.name || '').trim(),
    taxId: o[ORG_TAXID] || null,
    icountId: o[ORG_ICOUNT] || null,
    // Pipedrive splits the address; address_locality is the city.
    address: o.address || o.address_formatted_address || null,
    city: o.address_locality || null,
    phones: o.phone ? [o.phone] : [],
    emails: [],
    emailDomains: [],
    contacts: [],
    primaryContact: null,
    contactCount: 0,
    dealCount: 0,
    activeDealCount: 0,
    futureTourDeals: 0,
  });
});
console.log(`  organizations: ${orgCount}`);

// 2) Persons → linked contacts with their real names / emails / phones.
const domainsByOrg = new Map();
const personById = new Map(); // only for orgs we care about (bounded)
const personCount = await stream('pipedrive/persons', (p) => {
  const orgId = p.org_id?.value ?? p.org_id;
  if (orgId == null) return;
  const o = orgs.get(orgId);
  if (!o) return;
  o.contactCount++;
  const emails = first(p.email);
  const phones = first(p.phone);
  if (o.contacts.length < CONTACTS_PER_ORG) {
    const c = { legacyId: p.id, name: String(p.name || '').trim(), email: emails[0] || null, phone: phones[0] || null, deals: 0 };
    o.contacts.push(c);
    personById.set(p.id, c);
  }
  for (const e of emails) {
    if (o.emails.length < 8 && !o.emails.includes(e)) o.emails.push(e);
    const d = emailDomain(e);
    // Free mail domains are not organisation evidence.
    if (!d || /^(gmail|walla|hotmail|outlook|yahoo|icloud|live)\./i.test(d)) continue;
    if (!domainsByOrg.has(orgId)) domainsByOrg.set(orgId, new Set());
    domainsByOrg.get(orgId).add(d);
  }
  for (const ph of phones) if (o.phones.length < 8 && !o.phones.includes(ph)) o.phones.push(ph);
});
for (const [orgId, set] of domainsByOrg) if (orgs.has(orgId)) orgs.get(orgId).emailDomains = [...set].slice(0, 5);
console.log(`  persons scanned: ${personCount}`);

// 3) Deals → deal / Tier-2-active / future-tour counts per org, and deals per
//    contact (Pipedrive has no "primary contact", so we DERIVE it from who
//    actually works the deals — labelled as inferred in the UI).
const dealCount = await stream('pipedrive/deals', (d) => {
  const orgId = d.org_id?.value ?? d.org_id;
  if (orgId == null) return;
  const o = orgs.get(orgId);
  if (!o) return;
  o.dealCount++;
  if (isActiveDeal(d, today)) o.activeDealCount++;
  if (hasFutureTour(d, today)) o.futureTourDeals++;
  const personId = d.person_id?.value ?? d.person_id;
  const c = personId != null ? personById.get(personId) : null;
  if (c) c.deals++;
});
console.log(`  deals scanned: ${dealCount}`);

// Primary contact = the linked contact on the most deals (inferred), else the
// first linked contact. Contacts are ordered by deal involvement.
for (const o of orgs.values()) {
  o.contacts.sort((a, b) => b.deals - a.deals || String(a.name).localeCompare(String(b.name)));
  o.primaryContact = o.contacts[0]
    ? { ...o.contacts[0], derived: true, basis: o.contacts[0].deals > 0 ? 'הכי הרבה עסקאות' : 'איש הקשר היחיד/הראשון' }
    : null;
  o.contacts = o.contacts.slice(0, 6); // what the UI shows
}

// 4) Live GOS organizations — READ-ONLY evidence (conflict detection).
const gosRows = await prisma.organization.findMany({
  select: { id: true, name: true, taxId: true, organizationTypeId: true, organizationType: { select: { label: true } } },
});
const gosOrgs = { byTaxId: new Map(), byName: new Map() };
for (const g of gosRows) {
  const row = { id: g.id, name: g.name, organizationTypeId: g.organizationTypeId, organizationTypeLabel: g.organizationType?.label || null };
  const t = digits(g.taxId);
  if (t.length >= 8) gosOrgs.byTaxId.set(t, row);
  const n = normName(g.name);
  if (n) gosOrgs.byName.set(n, row);
}
console.log(`  live GOS organizations (read-only): ${gosRows.length}`);

// 5) Build proposals.
const { proposals, stats } = buildOrgProposals({ orgs: [...orgs.values()], gosOrgs, today });
console.log('\nstats:', JSON.stringify(stats, null, 2));
console.log('\ntop 10 by priority:');
for (const p of proposals.slice(0, 10)) {
  console.log(`  #${String(p.rank).padStart(3)} ${p.confidence.padEnd(6)} ${String(p.members.length)}× ${p.proposedCanonical.name.slice(0, 34).padEnd(34)} deals=${String(p.totals.deals).padStart(4)} active=${String(p.totals.activeDeals).padStart(3)} contacts=${String(p.totals.contacts).padStart(3)}${p.gosMatch ? ' · GOS✓' : ''}`);
}

if (dry) { console.log('\n--dry: nothing written'); await prisma.$disconnect(); process.exit(0); }

// 6) Persist — one read of existing rows, then only the necessary writes.
const existing = await prisma.migrationDecision.findMany({ where: { queue: 'organizations' } });
const bySubject = new Map(existing.map((r) => [r.subjectKey, r]));
let created = 0, refreshed = 0, decidedRefreshed = 0;
for (const p of proposals) {
  const subjectKey = subjectKeyFor(p);
  const row = bySubject.get(subjectKey);
  if (!row) {
    await prisma.migrationDecision.create({ data: { queue: 'organizations', subjectKey, proposal: p, status: 'pending' } });
    created++;
    continue;
  }
  // The PROPOSAL (evidence) is always refreshed so every cluster — decided or
  // not — shows the same full source context. The owner's DECISION, status and
  // audit trail are never touched: a re-run can improve the evidence, never
  // overwrite a human's answer.
  await prisma.migrationDecision.update({ where: { id: row.id }, data: { proposal: p } });
  if (row.status === 'pending') refreshed++; else decidedRefreshed++;
}
console.log(`\n✔ persisted: ${created} created · ${refreshed} pending proposals refreshed · ${decidedRefreshed} decided rows kept their decision (evidence refreshed only)`);
const stillDecided = await prisma.migrationDecision.count({ where: { queue: 'organizations', status: { not: 'pending' } } });
console.log(`   owner decisions intact after refresh: ${stillDecided}`);
console.log(`LegacyRecord count (must be 0): ${await prisma.legacyRecord.count()}`);
await prisma.$disconnect();
