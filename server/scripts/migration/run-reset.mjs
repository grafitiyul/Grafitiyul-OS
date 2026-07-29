// RESET runner — builds the deterministic reset manifest and (only with an
// approved hash AND a verified backup) removes verified test/demo data.
//
//   # 1. build + review the manifest (READ-ONLY, writes nothing)
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-reset.mjs
//
//   # 2. dry-run against an approved hash
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-reset.mjs --approve <hash>
//
//   # 3. execute — requires a VERIFIED backup id
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-reset.mjs \
//     --approve <hash> --backup <backupId> --execute
//
// SAFETY:
//   * Default is build-and-print. Nothing is deleted without --execute.
//   * --execute refuses without a backup id that verifies right now.
//   * --execute refuses if the manifest hash differs from the approved one.
//   * Each deletion re-probes real-world impact INSIDE the transaction.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { requireVerifiedBackup } from '../../src/migration/backup.js';
import { buildResetManifest, executeResetManifest } from '../../src/migration/resetManifest.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const approvedHash = arg('--approve');
const approvedQaHash = arg('--approve-qa');
const backupId = arg('--backup');

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText, getBytes: r2.getObjectBytes };

async function main() {
  const m = await buildResetManifest(prisma);

  const s = m.summary;
  console.log(`native deals examined      : ${s.nativeDealsExamined}`);
  console.log(`→ TIER 1 remove deals      : ${s.dealsToRemove}`);
  console.log(`→ TIER 1 remove contacts   : ${s.orphanContactsToRemove}`);
  console.log(`→ TIER 2 remove deals      : ${s.qaReservationDealsToRemove} (+ ${s.qaSessionsToRemove} QA sessions, ${s.qaOrgsToRemove} org)`);
  console.log(`→ KEEP                     : ${s.dealsKept}`);

  console.log('\n── TIER 1: test pattern, zero real-world impact ────────');
  if (!m.remove.deals.length && !m.remove.contacts.length) console.log('  (none)');
  for (const d of m.remove.deals) console.log(`  #${d.orderNo}  ${String(d.title).slice(0, 44).padEnd(46)} ${d.reason}`);
  for (const c of m.remove.contacts) console.log(`  contact ${c.id}  ${c.name}`);

  console.log('\n── TIER 2: only impact is a PROVABLY-QA reservation ────');
  if (!m.removeQaReservations.deals.length) console.log('  (none)');
  for (const d of m.removeQaReservations.deals) {
    console.log(`  #${d.orderNo}  ${String(d.title).slice(0, 44).padEnd(46)} ${d.reason}`);
  }
  for (const x of m.removeQaReservations.sessions) {
    console.log(`  session #${x.sessionNo}  org "${x.orgName}"  signer "${x.signerName ?? '—'}"`);
  }
  for (const o of m.removeQaReservations.organizations) console.log(`  org  ${o.name}  — ${o.reason}`);

  console.log('\n── KEEP ───────────────────────────────────────────────');
  for (const k of m.keep) {
    console.log(`  #${k.orderNo}  ${String(k.title).slice(0, 44).padEnd(46)} ${k.reason}`);
  }

  console.log(`\nmanifestSha256      (tier 1): ${m.manifestSha256}`);
  console.log(`qaReservationsSha256(tier 2): ${m.qaReservationsSha256}`);

  if (!approvedHash) {
    console.log('\nread-only. to proceed:');
    console.log(`  --approve ${m.manifestSha256}`);
    console.log(`  [--approve-qa ${m.qaReservationsSha256}]   ← tier 2 is OPT-IN and separately approved`);
    return;
  }

  if (EXECUTE) {
    console.log(`\nverifying backup ${backupId} …`);
    const v = await requireVerifiedBackup({ store, backupId });
    console.log(`  backup VERIFIED ✓  (${v.tableCount} tables, ${v.checkedRecords.toLocaleString('en-US')} records, ${v.backupSha256.slice(0, 16)}…)`);
  }

  const res = await executeResetManifest(prisma, m, { approvedHash, approvedQaHash, dryRun: !EXECUTE });
  console.log(
    `\n${res.dryRun ? 'DRY RUN' : 'EXECUTED'}${res.includeQa ? ' (incl. tier 2)' : ' (tier 1 only)'}: ` +
    `${res.deals} deal(s), ${res.contacts} contact(s), ${res.sessions} reservation session(s), ${res.organizations} org(s)`,
  );
  if (!res.dryRun) {
    console.log('\ndeleted deal ids:');
    for (const id of res.dealIds) console.log('  ', id);
  } else {
    console.log('\nadd --backup <verifiedBackupId> --execute to perform the deletion.');
  }
}

main()
  .catch((e) => { console.error('\nreset ABORTED:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
