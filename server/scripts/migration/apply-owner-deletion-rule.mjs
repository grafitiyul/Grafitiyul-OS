// OWNER-APPROVED AUTOMATIC RULE (2026-07-16) over the blocking Name Cleanup rows:
//
//   auto-delete when the record has ZERO deals, or when EVERY linked deal —
//   primary AND secondary-participant — is LOST.
//   WON-linked rows stay for manual review; OPEN-linked rows are highest-priority
//   manual review and are NEVER auto-deleted. Unknown deal status never counts as
//   LOST: such rows (if any) stop the run as a reconciliation failure.
//
// Every write goes through the CANONICAL recordDecision path, so the resolver's
// safety boundary re-verifies each row independently — this script cannot delete
// anything the UI could not. Only still-pending rows are touched; an existing
// explicit owner decision is never overwritten.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/apply-owner-deletion-rule.mjs [--apply]
import { PrismaClient } from '@prisma/client';
import { recordDecision } from '../../src/migration/review/service.js';
import { statusCounts, openLinked, wonLinked } from '../../src/migration/review/nameCleanup.js';

const APPLY = process.argv.includes('--apply');
const RULE_NOTE = 'Owner-approved automatic rule: zero Deals or LOST-only history';
const RULE_ACTOR = 'כלל עסקי מאושר של הבעלים';
const p = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

const rows = await p.migrationDecision.findMany({ where: { queue: 'name_cleanup' } });
const blocking = rows.filter((r) => r.proposal?.blocking === true);
const pending = blocking.filter((r) => r.status === 'pending');
const decided = blocking.length - pending.length;
console.log(`blocking rows: ${blocking.length} (pending ${pending.length} · already decided ${decided} — never touched)`);

const classify = (r) => {
  const cxx = r.proposal.context;
  const ds = statusCounts(cxx.dealStatusCounts, cxx.dealCount);
  const ps = statusCounts(cxx.participantStatusCounts, cxx.participantCount);
  const open = ds.open + ps.open;
  const won = ds.won + ps.won;
  const other = ds.other + ps.other;
  const lost = ds.lost + ps.lost;
  if (open > 0) return 'OPEN';
  if (won > 0) return 'WON';
  if (other > 0) return 'UNKNOWN_STATUS';
  if (lost > 0) return 'LOST_ONLY';
  return 'ZERO_DEALS';
};
const buckets = { ZERO_DEALS: [], LOST_ONLY: [], WON: [], OPEN: [], UNKNOWN_STATUS: [] };
for (const r of pending) buckets[classify(r)].push(r);

// Rows whose PRIMARY history alone would qualify, but a participant link changes
// the classification — the owner asked for this measured explicitly.
const reclassified = pending.filter((r) => {
  const cxx = r.proposal.context;
  const ds = statusCounts(cxx.dealStatusCounts, cxx.dealCount);
  const ps = statusCounts(cxx.participantStatusCounts, cxx.participantCount);
  const primaryQualifies = ds.open === 0 && ds.won === 0 && ds.other === 0;
  const participantBlocks = ps.open > 0 || ps.won > 0 || ps.other > 0;
  return primaryQualifies && participantBlocks;
});

console.log('\n══════ DRY-RUN RECONCILIATION ══════');
console.log(`  zero deals                    ${buckets.ZERO_DEALS.length}`);
console.log(`  LOST-only                     ${buckets.LOST_ONLY.length}`);
console.log(`  contains >=1 WON              ${buckets.WON.length}`);
console.log(`  contains >=1 OPEN             ${buckets.OPEN.length}`);
console.log(`  unknown status (never LOST)   ${buckets.UNKNOWN_STATUS.length}`);
const sum = Object.values(buckets).reduce((n, b) => n + b.length, 0);
console.log(`  ── sum ${sum} + decided ${decided} = ${sum + decided} (blocking total ${blocking.length})`);
console.log(`  participant links changed the classification: ${reclassified.length}`);
const toDelete = [...buckets.ZERO_DEALS, ...buckets.LOST_ONLY];
console.log(`\n  WILL AUTO-DELETE : ${toDelete.length}`);
console.log(`  REMAIN FOR REVIEW: ${buckets.WON.length + buckets.OPEN.length} (WON ${buckets.WON.length} · OPEN ${buckets.OPEN.length})`);

const dealsOf = (r) => {
  const all = [
    ...(r.proposal.context.primaryDeals || []).map((d) => ({ ...d, role: 'ראשי' })),
    ...(r.proposal.context.participantDeals || []).map((d) => ({ ...d, role: 'משתתף' })),
  ];
  return all.filter((d) => d.status === 'won' || d.status === 'open');
};
for (const [label, set] of [['OPEN-LINKED (highest priority)', buckets.OPEN], ['WON-LINKED (manual review)', buckets.WON], ['UNKNOWN STATUS (stops the run)', buckets.UNKNOWN_STATUS]]) {
  if (!set.length) continue;
  console.log(`\n  ${label}:`);
  for (const r of set) {
    console.log(`    "${r.proposal.displayName}" (person ${r.proposal.legacyId})`);
    for (const d of dealsOf(r)) console.log(`       ${d.status.toUpperCase().padEnd(4)} #${d.id} "${String(d.title).slice(0, 45)}" [${d.role}]${d.wonTime ? ' נסגרה ' + d.wonTime : ''}${d.orgName ? ' · ' + d.orgName : ''}`);
  }
}

// Reconciliation gate: every pending row must land in exactly one known bucket,
// and UNKNOWN_STATUS must be empty — otherwise stop before writing anything.
if (sum !== pending.length || buckets.UNKNOWN_STATUS.length > 0) {
  console.error('\n✗ RECONCILIATION FAILED — nothing was written. See the discrepancy above.');
  await p.$disconnect();
  process.exit(2);
}
console.log('\n✓ categories reconcile exactly; no ambiguity.');

if (!APPLY) {
  console.log('\n--dry (default): nothing written. Run with --apply to execute.');
  await p.$disconnect();
  process.exit(0);
}

// ── APPLY — each row through the canonical resolver, which re-verifies the
// boundary itself. A row it refuses is reported, never forced.
console.log('\n── APPLYING ──');
let applied = 0, refusedCount = 0;
for (const r of toDelete) {
  try {
    await recordDecision(p, {
      id: r.id,
      action: 'edit',
      decision: { treatment: 'deleted', fields: r.proposal.proposedFields },
      note: RULE_NOTE,
      userName: RULE_ACTOR,
    });
    applied++;
  } catch (e) {
    refusedCount++;
    console.error(`  ✗ refused "${r.proposal.displayName}": ${(e.problems || [e.message]).join(' · ')}`);
  }
}
console.log(`\n✔ auto-deleted ${applied} · refused by the resolver ${refusedCount}`);
console.log(`   remaining blocking review workload: ${buckets.WON.length + buckets.OPEN.length}`);
console.log(`   LegacyRecord (must be 0): ${await p.legacyRecord.count()} · GOS Contacts: ${await p.contact.count()} · Orgs: ${await p.organization.count()}`);
await p.$disconnect();
