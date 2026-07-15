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
import { draftFromProposal, decisionFromDraft } from '../../src/migration/review/orgDecision.js';

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
const newBySubject = new Map(proposals.map((p) => [subjectKeyFor(p), p]));

let created = 0, refreshed = 0, decidedKept = 0, upgraded = 0, returnedToReview = 0, supersededPending = 0;
const returnedDetail = [];

// Rows whose subjectKey no longer exists under the corrected rules. Two very
// different causes — and the owner deserves the true one:
//   * iCount demotion  → the cluster should never have existed.
//   * normalisation fix → the KEY was renamed (e.g. "קודיום בע מ" → "קודיום"),
//     so the same organisations now live under a different cluster. An owner
//     decision here must be REHOMED, not discarded.
const why = (subjectKey) =>
  subjectKey.startsWith('org:icountId:')
    ? 'הקבוצה בוטלה: מזהה iCount לבדו אינו ראיה מספקת לאיחוד'
    : 'מפתח הקבוצה השתנה בעקבות תיקון נרמול השם';
let rehomed = 0;
const refreshedIds = new Set();

for (const row of existing) {
  if (newBySubject.has(row.subjectKey)) continue;

  // A row with NO decision costs the owner nothing — a wrong proposal just goes.
  if (!row.decision) {
    await prisma.migrationDecision.delete({ where: { id: row.id } });
    supersededPending++;
    continue;
  }

  // The owner answered this. Try to rehome onto the cluster that now holds the
  // same source records (their old members must all still be together).
  const oldIds = new Set((row.proposal?.members || []).map((m) => String(m.legacyId)));
  const target = proposals.find((p) => {
    const key = subjectKeyFor(p);
    if (key === row.subjectKey) return false;
    const ids = new Set(p.members.map((m) => String(m.legacyId)));
    return oldIds.size > 0 && [...oldIds].every((id) => ids.has(id));
  });

  if (target) {
    const targetKey = subjectKeyFor(target);
    const targetRow = bySubject.get(targetKey);
    const carried = decisionFromDraft(target, draftFromProposal(target, row.decision));
    const added = target.members.filter((m) => !oldIds.has(String(m.legacyId)));
    const reason = added.length
      ? `${why(row.subjectKey)} — נוספו ${added.length} רשומות מקור לקבוצה`
      : why(row.subjectKey);
    const data = {
      proposal: target,
      status: 'pending',
      decision: { ...carried, needsRereview: true, rereviewReason: `${reason}. ההחלטה הקודמת שלך נשמרה — יש לאשר מחדש.` },
      note: `הוחזר לבדיקה: ${reason}`,
    };
    if (targetRow) {
      // The new cluster already has a row — move the decision into it and drop the orphan.
      await prisma.migrationDecision.update({ where: { id: targetRow.id }, data });
      await prisma.migrationDecision.delete({ where: { id: row.id } });
      refreshedIds.add(targetRow.id);
    } else {
      await prisma.migrationDecision.update({ where: { id: row.id }, data: { ...data, subjectKey: targetKey } });
    }
    rehomed++;
    returnedToReview++;
    returnedDetail.push({ subjectKey: `${row.subjectKey} → ${targetKey}`, reason: `הועבר לקבוצה המעודכנת · ${reason}`, added: added.map((m) => m.legacyId), removed: [] });
    continue;
  }

  // Nowhere to rehome: keep the row + the owner's decision, mark it superseded.
  await prisma.migrationDecision.update({
    where: { id: row.id },
    data: {
      status: 'pending',
      proposal: { ...row.proposal, superseded: true, supersededReason: why(row.subjectKey) },
      decision: { ...row.decision, needsRereview: true, rereviewReason: `${why(row.subjectKey)}. ההחלטה הקודמת נשמרה לעיון.` },
      note: `הוחזר לבדיקה: ${why(row.subjectKey)}`,
    },
  });
  returnedToReview++;
  returnedDetail.push({ subjectKey: row.subjectKey, reason: why(row.subjectKey), added: [], removed: [] });
}

// ── PASS 2: create new clusters / refresh evidence / carry decisions forward ──
// Re-read: pass 1 may have rehomed rows onto these subject keys.
const afterRehome = await prisma.migrationDecision.findMany({ where: { queue: 'organizations' } });
const nowBySubject = new Map(afterRehome.map((r) => [r.subjectKey, r]));

for (const p of proposals) {
  const subjectKey = subjectKeyFor(p);
  const row = nowBySubject.get(subjectKey);
  if (!row) {
    await prisma.migrationDecision.create({ data: { queue: 'organizations', subjectKey, proposal: p, status: 'pending' } });
    created++;
    continue;
  }
  if (refreshedIds.has(row.id)) continue; // already written by the rehome pass

  const data = { proposal: p };
  if (row.status !== 'pending' && row.decision) {
    // Carry the owner's answer forward into the per-source model. Their choices are
    // never discarded; but if the corrected rules changed WHICH source rows are in
    // the cluster, the decision no longer covers every row — so it goes back to
    // review with the reason, keeping the prior choices pre-filled.
    const upgradedDraft = draftFromProposal(p, row.decision);
    const oldIds = new Set(Object.keys(row.decision.dispositions || row.decision.assignments || row.decision.roles || {}).map(String));
    const newIds = new Set(p.members.map((m) => String(m.legacyId)));
    const added = [...newIds].filter((id) => !oldIds.has(id));
    const removed = [...oldIds].filter((id) => !newIds.has(id));

    if (added.length || removed.length) {
      const reason = [
        added.length ? `נוספו ${added.length} רשומות מקור` : null,
        removed.length ? `הוסרו ${removed.length} רשומות מקור` : null,
      ].filter(Boolean).join(' · ');
      data.status = 'pending';
      data.decision = { ...decisionFromDraft(p, upgradedDraft), needsRereview: true, rereviewReason: `${reason} בעקבות תיקון מנוע ההתאמה — יש לאשר מחדש` };
      data.note = `הוחזר לבדיקה: ${reason}`;
      returnedToReview++;
      returnedDetail.push({ subjectKey, reason, added, removed });
    } else {
      data.decision = decisionFromDraft(p, upgradedDraft);
      if (row.decision.dispositions == null) upgraded++;
      decidedKept++;
    }
  } else if (row.status === 'pending') {
    refreshed++;
  }
  await prisma.migrationDecision.update({ where: { id: row.id }, data });
}

console.log(`\n✔ persisted:`);
console.log(`   created                        : ${created}`);
console.log(`   decisions rehomed to a renamed/updated cluster: ${rehomed}`);
console.log(`   pending proposals refreshed    : ${refreshed}`);
console.log(`   owner decisions carried forward: ${decidedKept} (of which upgraded to the per-source model: ${upgraded})`);
console.log(`   RETURNED TO OWNER REVIEW       : ${returnedToReview}`);
for (const d of returnedDetail) console.log(`       • ${d.subjectKey} — ${d.reason}`);
console.log(`   superseded undecided clusters removed: ${supersededPending}`);
const stillDecided = await prisma.migrationDecision.count({ where: { queue: 'organizations', status: { not: 'pending' } } });
const total = await prisma.migrationDecision.count({ where: { queue: 'organizations' } });
console.log(`\n   organizations queue: ${total} proposals · ${stillDecided} decided · ${total - stillDecided} awaiting the owner`);
console.log(`LegacyRecord count (must be 0): ${await prisma.legacyRecord.count()}`);
await prisma.$disconnect();
