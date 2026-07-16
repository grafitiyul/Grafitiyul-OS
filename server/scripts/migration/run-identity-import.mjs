// IDENTITY IMPORT runner — Slice 6. Creates production Contacts + Organizations
// from Snapshot #1 and the decision ledger.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-identity-import.mjs --snapshot <id> [--execute]
//
// SAFETY:
//   * Default is DRY-RUN: full plan + stats, zero writes.
//   * --execute refuses unless the data-driven readiness gate is GREEN.
//   * Idempotent: the LegacyRecord crosswalk is loaded first; already-imported
//     source ids are skipped, so a re-run never duplicates.
//   * A MigrationRun row (kind 'import') records the batch for audit/rollback.
//   * No Pipedrive/Airtable calls — reads R2 + Postgres only.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { buildImportReadiness, getDeletedPersonIds, getIdentityEdits } from '../../src/migration/review/service.js';
import { isNewContactName } from '../../src/migration/phoneCompare.js';
import { planIdentityImport, executeIdentityPlan } from '../../src/migration/import/identityImport.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const EXECUTE = process.argv.includes('--execute');
if (!snapshotId) { console.error('usage: --snapshot <id> [--execute]'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
const pid = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
async function stream(key, visit) {
  const man = await reader.entityManifest(key);
  for (const s of man.shards || []) { for (const r of await reader.readShard(s.key)) visit(r); reader._shardCache.clear(); }
}

// ── 0) the gate ───────────────────────────────────────────────────────────────
const readiness = await buildImportReadiness(prisma);
console.log(`readiness gate: ${readiness.ready ? 'GREEN' : 'RED'}`);
if (!readiness.ready) {
  for (const b of readiness.blockers) console.log(`  ✗ ${b.label}: ${b.detail}`);
  if (EXECUTE) { console.error('\nABORT: --execute refused while the gate is red.'); process.exit(2); }
}

// ── 1) load the sources ──────────────────────────────────────────────────────
console.log(`\nloading snapshot ${snapshotId}…`);
const persons = new Map();
await stream('pipedrive/persons', (p) => persons.set(p.id, {
  legacyId: p.id, name: String(p.name || '').trim(),
  firstName: p.first_name || null, lastName: p.last_name || null,
  phones: (p.phone || []).map((x) => x?.value).filter((v) => String(v || '').trim()),
  emails: (p.email || []).map((x) => String(x?.value || '').trim()).filter(Boolean),
  orgId: pid(p.org_id), history: 0,
}));
const organizations = [];
await stream('pipedrive/organizations', (o) => organizations.push({ legacyId: o.id, name: String(o.name || '').trim() }));
const bump = (v) => { const c = persons.get(pid(v)); if (c) c.history++; };
await stream('pipedrive/deals', (d) => bump(d.person_id));
await stream('pipedrive/activities', (a) => bump(a.person_id));
await stream('pipedrive/notes', (n) => bump(n.person_id));
await stream('pipedrive/files', (f) => bump(f.person_id));
await stream('pipedrive/deal_participants', (l) => bump(l.person_id));
for (const p of persons.values()) p.importable = p.history > 0;
console.log(`  persons ${persons.size} · organizations ${organizations.length}`);

// ── 2) load the ledger ───────────────────────────────────────────────────────
const [orgRows, contactRows, nameRows, deletedIds, identityEdits] = await Promise.all([
  prisma.migrationDecision.findMany({ where: { queue: 'organizations' } }),
  prisma.migrationDecision.findMany({ where: { queue: 'contacts' } }),
  prisma.migrationDecision.findMany({ where: { queue: 'name_cleanup' } }),
  getDeletedPersonIds(prisma),
  getIdentityEdits(prisma),
]);
const spamIds = new Set([...persons.values()].filter((p) => isNewContactName(`${p.firstName || ''} ${p.name || ''}`)).map((p) => p.legacyId));
console.log(`  ledger: orgs ${orgRows.length} · contacts ${contactRows.length} · names ${nameRows.length} · deleted ${deletedIds.size} · corrections ${Object.keys(identityEdits).length} · spam ${spamIds.size}`);

// ── 3) the crosswalk (idempotency) ───────────────────────────────────────────
const existing = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'pipedrive', sourceType: { in: ['person', 'organization'] } },
  select: { sourceType: true, sourceId: true, entityId: true },
});
const existingPersonXwalk = new Map(existing.filter((x) => x.sourceType === 'person').map((x) => [x.sourceId, x.entityId]));
const existingOrgXwalk = new Map(existing.filter((x) => x.sourceType === 'organization').map((x) => [x.sourceId, x.entityId]));
console.log(`  crosswalk: persons ${existingPersonXwalk.size} · organizations ${existingOrgXwalk.size} already imported`);

// ── 4) plan ──────────────────────────────────────────────────────────────────
const { plan, stats, problems } = planIdentityImport({
  persons: [...persons.values()], organizations,
  orgRows, contactRows, nameRows,
  identityEdits, spamIds, deletedIds,
  existingPersonXwalk, existingOrgXwalk,
});
for (const lr of plan.legacyRecords) lr.snapshotId = snapshotId;

console.log('\n══════ PLAN ══════');
console.log(`  Organizations to create : ${stats.organizations}`);
console.log(`  Units to create         : ${stats.units}`);
console.log(`  Contacts to create      : ${stats.contacts}`);
console.log(`  phones ${stats.phones} · emails ${stats.emails} · org links ${stats.orgLinks}`);
console.log(`  LegacyRecord crosswalk  : ${stats.legacyRecords}`);
console.log('  skipped:', JSON.stringify(stats.skipped));
if (problems.length) {
  console.log(`\n  problems (${problems.length}):`);
  for (const pr of problems.slice(0, 20)) console.log(`   · ${pr}`);
  if (problems.length > 20) console.log(`   … ${problems.length - 20} more`);
}

if (!EXECUTE) { console.log('\n--dry (default): nothing written. Run with --execute to import.'); await prisma.$disconnect(); process.exit(0); }

// ── 5) execute ───────────────────────────────────────────────────────────────
const batchId = `identity-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const run = await prisma.migrationRun.create({
  data: {
    kind: 'import', target: 'import.identity', status: 'running',
    snapshotId, batchId, startedAt: new Date(),
    counters: stats,
  },
});
console.log(`\nexecuting batch ${batchId} (run ${run.id})…`);
try {
  await executeIdentityPlan(prisma, { plan }, { batchId, log: (m) => console.log(`  ✓ ${m}`) });
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), counters: { ...stats, problems: problems.length } } });
} catch (e) {
  await prisma.migrationRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: String(e?.message || e).slice(0, 500) } });
  console.error('\nFAILED:', e?.message || e);
  console.error('The crosswalk marks everything already written — re-running resumes without duplicating.');
  process.exit(3);
}

console.log('\n══════ POST-IMPORT VERIFICATION ══════');
console.log('  GOS Contacts     :', await prisma.contact.count());
console.log('  GOS Organizations:', await prisma.organization.count());
console.log('  GOS Units        :', await prisma.organizationUnit.count());
console.log('  ContactPhones    :', await prisma.contactPhone.count());
console.log('  ContactEmails    :', await prisma.contactEmail.count());
console.log('  Contact↔Org links:', await prisma.contactOrganization.count());
console.log('  LegacyRecords    :', await prisma.legacyRecord.count());
console.log(`\n✔ Identity Import complete — batch ${batchId}`);
await prisma.$disconnect();
