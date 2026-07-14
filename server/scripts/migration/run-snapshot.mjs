// Snapshot #1 CLI — read-only extraction into the private snapshot bucket.
// Authoritative state = R2 (`_run.json` + manifests). MigrationRun table is a
// best-effort mirror (enabled only if a DB URL is reachable from the run env).
//
//   railway run --service Grafitiyul-OS node scripts/migration/run-snapshot.mjs            # new snapshot
//   railway run --service Grafitiyul-OS node scripts/migration/run-snapshot.mjs --snapshot <id>   # resume
//
// NO imports. NO LegacyRecords. NO production-entity writes. NO Pipedrive file
// bodies (metadata only). Airtable attachment bodies ARE captured (URLs expire).
import { migrationConfigStatus } from '../../src/migration/config.js';
import * as r2 from '../../src/migration/r2.js';
import { pipedriveClient } from '../../src/migration/sources/pipedrive.js';
import { airtableClient } from '../../src/migration/sources/airtable.js';
import { runSnapshot } from '../../src/migration/snapshotRun.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || true) : null;
}
function newSnapshotId() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.abs((Date.now() ^ (process.pid << 8)) % 0xffff).toString(16).padStart(4, '0');
  return `snap-${ts}-${rand}`;
}

const cfg = migrationConfigStatus();
if (!cfg.readyForExtraction) {
  console.error('NOT READY — missing:', JSON.stringify(cfg));
  process.exit(1);
}

const snapshotId = arg('--snapshot') || newSnapshotId();
const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText };
const pd = pipedriveClient();
const at = airtableClient();

// ── best-effort DB mirror (R2 stays authoritative regardless) ────────────────
let prisma = null, runRowId = null;
const dbUrl = process.env.MIGRATION_DB_URL || process.env.DATABASE_URL;
try {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: dbUrl });
  await Promise.race([
    p.$queryRaw`SELECT 1`,
    new Promise((_, rej) => setTimeout(() => rej(new Error('db connect timeout')), 8000)),
  ]);
  prisma = p;
  console.log('[db] MigrationRun mirror enabled');
} catch (e) {
  console.log('[db] MigrationRun mirror DISABLED (DB not reachable from this env):', String(e?.message || e).split('\n')[0]);
}

async function mirror(state) {
  if (!prisma) return;
  const data = {
    kind: 'snapshot', target: state.snapshotId, snapshotId: state.snapshotId,
    status: state.status, cursor: state.current || {}, counters: state.counters || {},
    startedAt: new Date(state.startedAt), finishedAt: state.status === 'complete' ? new Date() : null,
  };
  if (!runRowId) {
    const existing = await prisma.migrationRun.findFirst({ where: { snapshotId: state.snapshotId, kind: 'snapshot' } });
    if (existing) { runRowId = existing.id; await prisma.migrationRun.update({ where: { id: runRowId }, data }); }
    else { const c = await prisma.migrationRun.create({ data: { ...data, claimedBy: 'run-snapshot-cli', claimedAt: new Date(), attempts: 1 } }); runRowId = c.id; }
  } else {
    await prisma.migrationRun.update({ where: { id: runRowId }, data });
  }
}

console.log(`\n════ Snapshot #1 — ${snapshotId} ════`);
console.log('bucket:', r2.bucket(), '| scope: records + Airtable attachment bodies + Pipedrive file METADATA');

const started = Date.now();
try {
  const manifest = await runSnapshot({ snapshotId, store, pd, at, log: (m) => console.log(m), mirror });
  console.log(`\n✔ COMPLETE in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  console.log('totals:', JSON.stringify(manifest.totals));
  console.log('counters:', JSON.stringify(manifest.counters, null, 2));
  if (prisma) await prisma.$disconnect();
  process.exit(0);
} catch (e) {
  if (e?.code === 'RATE_BUDGET_EXCEEDED') {
    const mins = Math.round((e.retryAfter || 0) / 60);
    console.error(`\n⏸ PAUSED — Pipedrive daily request budget exceeded. Reset in ~${mins} min (${e.retryAfter}s).`);
    console.error('Progress is safely checkpointed. Resume after reset with:');
    console.error(`  node server/scripts/migration/run-snapshot.mjs --snapshot ${snapshotId}`);
    if (prisma) await prisma.$disconnect().catch(() => {});
    process.exit(3); // distinct code: paused, not failed
  }
  console.error('\n✗ SNAPSHOT ERROR:', e?.message || e);
  console.error('Re-run with the SAME snapshot id to resume:');
  console.error(`  node server/scripts/migration/run-snapshot.mjs --snapshot ${snapshotId}`);
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(1);
}
