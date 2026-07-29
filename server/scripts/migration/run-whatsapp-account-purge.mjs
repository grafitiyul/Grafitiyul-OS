// Permanently remove a WhatsApp account and all of its data.
//
//   node server/scripts/migration/run-whatsapp-account-purge.mjs --account personal_test
//   node ... --account personal_test --expect <rows> --backup <verifiedBackupId> --execute
//
// SAFETY:
//   * Default is a read-only plan.
//   * --execute requires a backup id that VERIFIES right now.
//   * --expect binds the approval to a measured row count: this is a LIVE
//     number, so if it received messages since planning, the run refuses.
//   * Contacts are never deleted — chats are link-only, so the CRM record
//     survives with the link simply gone.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { requireVerifiedBackup } from '../../src/migration/backup.js';
import {
  executeAccountPurge, planAccountPurge, verifyNoResidualDependency,
} from '../../src/migration/whatsappAccountPurge.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const accountId = arg('--account');
const EXECUTE = process.argv.includes('--execute');
const expect = arg('--expect');
const backupId = arg('--backup');
if (!accountId) { console.error('usage: --account <id> [--expect <rows> --backup <id> --execute]'); process.exit(1); }

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText, getBytes: r2.getObjectBytes };
const fmt = (n) => (n === null ? '—' : Number(n).toLocaleString('en-US'));

async function main() {
  const plan = await planAccountPurge(prisma, accountId);
  console.log(`account : ${plan.accountId}  "${plan.account.label}"`);
  console.log(`state   : active=${plan.account.active} status=${plan.account.status} jid=${plan.account.phoneJid || '—'}`);
  console.log('\nrows scoped to this account:');
  for (const [t, n] of Object.entries(plan.counts)) console.log(`  ${t.padEnd(32)} ${fmt(n)}`);
  console.log(`  ${'TOTAL'.padEnd(32)} ${fmt(plan.totalRows)}`);
  console.log(`\ncontacts whose chat link disappears (CONTACTS ARE NOT DELETED): ${fmt(plan.linkedContacts)}`);
  console.log(`CRM tasks pointing at a scheduled message here (will be unlinked): ${fmt(plan.orphanTasks)}`);
  console.log(`other CONNECTED accounts remaining after this: ${plan.otherConnected}`);

  if (!EXECUTE) {
    console.log(`\nread-only. to proceed:  --expect ${plan.totalRows} --backup <verifiedBackupId> --execute`);
    return;
  }

  console.log(`\nverifying backup ${backupId} …`);
  const v = await requireVerifiedBackup({ store, backupId });
  console.log(`  backup VERIFIED ✓ (${v.tableCount} tables, ${fmt(v.checkedRecords)} records, ${v.backupSha256.slice(0, 16)}…)`);

  const key = `backups/${backupId}/_whatsapp-purge-${accountId}.json`;
  await r2.putObject({
    key,
    body: Buffer.from(JSON.stringify({ executedAt: new Date().toISOString(), backupId, plan }, null, 2), 'utf8'),
    contentType: 'application/json',
  });
  console.log(`  audit export written → ${key}`);

  const res = await executeAccountPurge(prisma, accountId, { expectedRows: Number(expect), dryRun: false });
  console.log('\nDELETED:');
  for (const [t, n] of Object.entries(res.deleted)) console.log(`  ${t.padEnd(32)} ${fmt(n)}`);
  console.log(`  ${'TOTAL'.padEnd(32)} ${fmt(res.totalDeleted)}`);

  const check = await verifyNoResidualDependency(prisma, accountId);
  console.log(`\nresidual dependency check: ${check.clean ? 'CLEAN ✓ — nothing in production references this account' : 'FOUND RESIDUE'}`);
  for (const f of check.findings) console.log(`  ✗ ${f.table}: ${f.rows}`);

  const contacts = await prisma.contact.count();
  console.log(`\ncontacts still present (must be unchanged): ${fmt(contacts)}`);
  const accounts = await prisma.whatsAppAccount.findMany({ select: { id: true, label: true, active: true, status: true } });
  console.log('remaining accounts:');
  for (const a of accounts) console.log(`  ${a.id.padEnd(12)} ${String(a.label).padEnd(30)} active=${a.active} status=${a.status}`);
  process.exit(check.clean ? 0 : 1);
}

main()
  .catch((e) => { console.error('\npurge ABORTED:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
