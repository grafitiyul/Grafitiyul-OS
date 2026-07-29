// GOS DATABASE BACKUP runner — the safety gate for the stabilization phase.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-backup.mjs            # plan (read-only)
//   railway run --service Grafitiyul-OS node server/scripts/migration/run-backup.mjs --execute  # write to R2
//
// SAFETY:
//   * Default is a PLAN: table inventory + row counts + size estimate, zero writes.
//   * Reads the GOS database only. Never touches Pipedrive or Airtable.
//   * Writes only into the private migration bucket under backups/<backupId>/.
//   * The run ends by VERIFYING what it just wrote (re-read + re-hash), so the
//     printed backup id is a verified id or the run fails.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import {
  listBackupTables,
  countTable,
  runBackup,
  verifyBackup,
  newBackupId,
} from '../../src/migration/backup.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const BATCH = Number(arg('--batch') || 2000);

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const store = {
  put: r2.putObject,
  head: r2.headObject,
  getText: r2.getObjectText,
  getBytes: r2.getObjectBytes,
};

const fmt = (n) => n.toLocaleString('en-US');

async function main() {
  const specs = await listBackupTables(prisma);
  const noPk = specs.filter((s) => !s.pk.length);
  if (noPk.length) {
    console.error(`ABORT: ${noPk.length} table(s) have no primary key and cannot be safely paginated:`);
    for (const s of noPk) console.error('  ✗', s.table);
    process.exit(2);
  }

  console.log(`tables: ${specs.length}`);

  if (!EXECUTE) {
    let total = 0;
    const rows = [];
    for (const s of specs) {
      const n = await countTable(prisma, s.table);
      total += n;
      rows.push({ table: s.table, rows: n });
    }
    rows.sort((a, b) => b.rows - a.rows);
    console.log('\nPLAN (read-only) — top 20 tables by row count:');
    for (const r of rows.slice(0, 20)) console.log('  ', r.table.padEnd(34), fmt(r.rows).padStart(10));
    console.log(`\ntotal rows: ${fmt(total)} across ${specs.length} tables`);
    console.log('\nnothing written. re-run with --execute to produce a backup.');
    return;
  }

  const backupId = arg('--id') || newBackupId();
  console.log(`\nEXECUTE → backups/${backupId}/\n`);
  const started = Date.now();

  const manifest = await runBackup({
    db: prisma,
    store,
    backupId,
    batchSize: BATCH,
    onProgress: ({ table, index, total, records }) => {
      console.log(`  [${String(index).padStart(3)}/${total}] ${table.padEnd(34)} ${fmt(records).padStart(10)} rows`);
    },
  });

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nwritten: ${fmt(manifest.totalRecords)} rows · ${(manifest.totalBytes / 1e6).toFixed(1)} MB compressed · ${mins} min`);
  console.log(`backupSha256: ${manifest.backupSha256}`);

  console.log('\nverifying (re-read + re-hash every shard) …');
  const v = await verifyBackup({ store, backupId, db: prisma });
  console.log(`  shards checked : ${fmt(v.checkedShards)}`);
  console.log(`  records checked: ${fmt(v.checkedRecords)}`);
  if (v.drift.length) {
    console.log(`  live drift during the run (expected on a live DB): ${v.drift.length} table(s)`);
    for (const d of v.drift.slice(0, 10)) console.log(`    ~ ${d.table}: backup ${fmt(d.backup)} → live ${fmt(d.live)}`);
  }
  for (const e of v.errors) console.log('  ✗', e);

  console.log(`\nVERDICT: ${v.ok ? 'VERIFIED ✓' : 'FAILED'}`);
  if (v.ok) {
    console.log(`\nbackup id  : ${backupId}`);
    console.log(`backup hash: ${v.backupSha256}`);
    console.log('\npass this id to any destructive runner as --backup <id>.');
  }
  process.exit(v.ok ? 0 : 1);
}

main()
  .catch((e) => { console.error('backup fatal:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
