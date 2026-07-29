// Verify a GOS database backup — READ-ONLY. Re-reads every shard from storage,
// decompresses it, recomputes its hash and line count, and recomputes the
// per-table and whole-backup hashes.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/verify-backup.mjs [--backup <id>] [--live]
//
// Without --backup, verifies the most recent backups/<id>/manifest.json.
// --live also compares every table against the live database (drift is
// reported, never treated as a failure — a live DB moves while a backup runs).
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { verifyBackup, BACKUP_ROOT } from '../../src/migration/backup.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const LIVE = process.argv.includes('--live');

const store = {
  put: r2.putObject,
  head: r2.headObject,
  getText: r2.getObjectText,
  getBytes: r2.getObjectBytes,
};

async function findLatestBackup() {
  const objs = await r2.listKeys(`${BACKUP_ROOT}/`);
  const ids = new Set();
  for (const o of objs) {
    const m = o.key.match(new RegExp(`^${BACKUP_ROOT}/([^/]+)/manifest\\.json$`));
    if (m) ids.add(m[1]);
  }
  return [...ids].sort().pop() || null;
}

async function main() {
  const backupId = arg('--backup') || (await findLatestBackup());
  if (!backupId) { console.error('no backup found under backups/'); process.exit(1); }

  const prisma = LIVE
    ? new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL })
    : null;

  console.log(`verifying ${backupId}${LIVE ? ' (with live comparison)' : ''}\n`);
  const v = await verifyBackup({ store, backupId, db: prisma });

  console.log(`created        : ${v.createdAt}`);
  console.log(`tables         : ${v.tableCount}`);
  console.log(`shards checked : ${v.checkedShards.toLocaleString('en-US')}`);
  console.log(`records checked: ${v.checkedRecords.toLocaleString('en-US')}`);
  console.log(`backupSha256   : ${v.backupSha256}`);

  if (v.drift.length) {
    console.log(`\nlive drift since the backup: ${v.drift.length} table(s)`);
    for (const d of v.drift) {
      console.log(`  ~ ${d.table.padEnd(34)} backup ${String(d.backup).padStart(9)} → live ${String(d.live).padStart(9)}`);
    }
  }
  for (const e of v.errors) console.log('  ✗', e);

  console.log(`\nVERDICT: ${v.ok ? 'VERIFIED ✓' : 'FAILED'}  (${v.errors.length} error(s))`);
  await prisma?.$disconnect();
  process.exit(v.ok ? 0 : 1);
}

main().catch((e) => { console.error('verify fatal:', e?.message || e); process.exit(1); });
