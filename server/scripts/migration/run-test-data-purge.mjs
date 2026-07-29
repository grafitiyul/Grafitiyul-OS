// TEST-DATA PURGE runner — the owner-approved rule "orderNo >= 27000 is test data".
//
//   node server/scripts/migration/run-test-data-purge.mjs                    # plan (read-only)
//   node server/scripts/migration/run-test-data-purge.mjs --approve <hash> --backup <id> --execute
//
// SAFETY:
//   * Default is a read-only plan; nothing is deleted without --execute.
//   * --execute requires a backup id that VERIFIES right now.
//   * The plan is content-hashed; a changed plan is refused.
//   * A full JSON audit export of everything about to be deleted is written to
//     the private bucket BEFORE the transaction opens — the deletion is
//     reversible from the backup, and inspectable from the export.
//   * Idempotent: a re-run plans zero deletions.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { requireVerifiedBackup } from '../../src/migration/backup.js';
import { buildPurgePlan, executePurge } from '../../src/migration/testDataPurge.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const approvedHash = arg('--approve');
const backupId = arg('--backup');

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText, getBytes: r2.getObjectBytes };
const fmt = (n) => (n === null ? '—' : Number(n).toLocaleString('en-US'));

async function main() {
  const before = await prisma.deal.count();
  const plan = await buildPurgePlan(prisma);

  console.log(`rule: every Deal with orderNo >= ${plan.floor} is test data\n`);
  console.log(`deals in scope : ${plan.deals.length}`);
  for (const d of plan.deals) {
    console.log(`  #${d.orderNo}  ${String(d.title).slice(0, 34).padEnd(36)} ${String(d.status).padEnd(5)} value=${d.valueMinor}`);
  }

  console.log(`\ntours to delete        : ${plan.tours.length}`);
  console.log(`reservation sessions   : ${plan.sessions.length}`);
  console.log(`contacts               : ${plan.contacts.length}${plan.contacts.length ? '  (' + plan.contacts.map((c) => c.name).join(', ') + ')' : ''}`);
  console.log(`organizations          : ${plan.organizations.length}${plan.organizations.length ? '  (' + plan.organizations.map((o) => o.name).join(', ') + ')' : ''}`);

  console.log('\ndependent rows that go with them:');
  for (const [k, v] of Object.entries(plan.dependents)) {
    if (v) console.log(`  ${k.padEnd(30)} ${fmt(v)}`);
  }

  if (plan.retained.length) {
    console.log('\nRETAINED (shared with surviving records — never deleted):');
    for (const r of plan.retained) console.log(`  ${r.kind.padEnd(20)} ${String(r.label || r.id).slice(0, 30).padEnd(32)} ${r.reason}`);
  }

  const ext = plan.external || {};
  if (ext.icountDocuments?.length) {
    console.log(`\n⚠ EXTERNAL — ${ext.icountDocuments.length} iCount document(s) exist in the LIVE accounting system.`);
    console.log('  GOS loses its record of them; the documents themselves REMAIN in iCount and are not touched:');
    for (const d of ext.icountDocuments) console.log(`    #${d.orderNo}  ${d.doctype} ${d.docnum}  (${d.amount} minor)`);
  }
  if (ext.googleCalendarEvents?.length) {
    console.log(`\n⚠ EXTERNAL — ${ext.googleCalendarEvents.length} Google Calendar event(s) will be ORPHANED.`);
    console.log('  They are NOT deleted automatically: cancelling them notifies the guides. Clean them manually if wanted:');
    for (const g of ext.googleCalendarEvents) console.log(`    ${String(g.date).slice(0, 10)}  ${g.gcalEventId}`);
  }

  console.log(`\nplanHash: ${plan.planHash}`);

  if (!approvedHash) {
    console.log(`\nread-only. to proceed:  --approve ${plan.planHash} --backup <verifiedBackupId> --execute`);
    return;
  }

  if (EXECUTE) {
    console.log(`\nverifying backup ${backupId} …`);
    const v = await requireVerifiedBackup({ store, backupId });
    console.log(`  backup VERIFIED ✓ (${v.tableCount} tables, ${fmt(v.checkedRecords)} records)`);

    // Audit trail: the full plan, stored beside the backup, BEFORE any deletion.
    const key = `backups/${backupId}/_purge-${plan.planHash.slice(0, 12)}.json`;
    await r2.putObject({
      key,
      body: Buffer.from(JSON.stringify({ executedAt: new Date().toISOString(), backupId, ...plan }, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    console.log(`  audit export written → ${key}`);
  }

  const res = await executePurge(prisma, plan, { approvedHash, dryRun: !EXECUTE });
  console.log(`\n${res.dryRun ? 'DRY RUN' : 'EXECUTED'}:`);
  for (const [k, v] of Object.entries(res.deleted)) console.log(`  ${k.padEnd(28)} ${fmt(v)}`);

  if (!res.dryRun) {
    const after = await prisma.deal.count();
    const range = await prisma.$queryRawUnsafe(`SELECT min("orderNo")::int AS lo, max("orderNo")::int AS hi FROM "Deal"`);
    const left = await prisma.deal.count({ where: { orderNo: { gte: plan.floor } } });
    console.log(`\ndeals before : ${fmt(before)}`);
    console.log(`deals deleted: ${fmt(before - after)}`);
    console.log(`deals after  : ${fmt(after)}`);
    console.log(`order range  : ${range[0].lo} … ${range[0].hi}`);
    console.log(`remaining >= ${plan.floor}: ${left}`);
  }
}

main()
  .catch((e) => { console.error('\npurge ABORTED:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
