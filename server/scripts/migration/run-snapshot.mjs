// Snapshot #1 CLI — read-only extraction into the private snapshot bucket.
// Authoritative state = R2 (`_run.json` + manifests). MigrationRun table is a
// best-effort mirror (enabled only if a DB URL is reachable from the run env).
//
//   MIGRATION_EXTRACTION_ENABLED=true MIGRATION_MAX_REQUESTS=1800 \
//     node server/scripts/migration/run-snapshot.mjs --snapshot <id>
//
// SAFETY: refuses to make ANY Pipedrive request unless extraction is explicitly
// enabled AND a hard cumulative request ceiling is configured. The ceiling is
// persisted in R2, so restarting the process cannot reset the allowance. There is
// no automatic resume, no scheduler, and no retry after a daily-budget 429.
//
// NO imports. NO LegacyRecords. NO production-entity writes. NO Pipedrive file
// bodies (metadata only). Airtable attachment bodies ARE captured (URLs expire).
import { migrationConfigStatus, extractionEnabled, maxPipedriveRequests } from '../../src/migration/config.js';
import * as r2 from '../../src/migration/r2.js';
import { pipedriveClient } from '../../src/migration/sources/pipedrive.js';
import { airtableClient } from '../../src/migration/sources/airtable.js';
import { runSnapshot } from '../../src/migration/snapshotRun.js';
import { SnapshotWriter } from '../../src/migration/snapshotWriter.js';
import { RequestBudget } from '../../src/migration/budget.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || true) : null;
}
function newSnapshotId() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `snap-${ts}-${Math.abs((Date.now() ^ (process.pid << 8)) % 0xffff).toString(16).padStart(4, '0')}`;
}

const cfg = migrationConfigStatus();
if (!cfg.readyForExtraction) { console.error('NOT READY — missing:', JSON.stringify(cfg)); process.exit(1); }

// ── Safety gate #1: extraction must be explicitly enabled ───────────────────
if (!extractionEnabled()) {
  console.error('\n⛔ REFUSING TO RUN — extraction is disabled.');
  console.error('   MIGRATION_EXTRACTION_ENABLED is not "true". Zero Pipedrive calls made.');
  console.error('   This is the default. Enable it only for an explicitly approved run.');
  process.exit(2);
}
// ── Safety gate #2: an approved run must declare its hard ceiling ───────────
const limit = maxPipedriveRequests();
if (!limit) {
  console.error('\n⛔ REFUSING TO RUN — MIGRATION_MAX_REQUESTS is not set to a positive integer.');
  console.error('   An approved run must declare its hard Pipedrive request ceiling. Zero calls made.');
  process.exit(2);
}
// ── Safety gate #3: never mint a second snapshot by accident ────────────────
const explicitNew = process.argv.includes('--new');
const snapshotId = arg('--snapshot') || (explicitNew ? newSnapshotId() : null);
if (!snapshotId) {
  console.error('\n⛔ REFUSING TO RUN — pass --snapshot <id> to resume the existing snapshot.');
  console.error('   (Use --new ONLY to deliberately start a fresh snapshot.) Zero calls made.');
  process.exit(2);
}

const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText };

// Persisted request counter — a restart continues the allowance, never resets it.
const priorState = await new SnapshotWriter({ snapshotId, store }).readRunState();
const priorUsed = Number(priorState?.requestBudget?.used || 0);
if (priorUsed >= limit) {
  console.error(`\n⛔ REFUSING TO RUN — this snapshot has already used ${priorUsed}/${limit} Pipedrive requests.`);
  console.error('   Raise MIGRATION_MAX_REQUESTS explicitly (an approved decision) to continue. Zero calls made.');
  process.exit(2);
}
const budget = new RequestBudget({ limit, used: priorUsed });

const pd = pipedriveClient({ budget });
const at = airtableClient();

// ── best-effort DB mirror (R2 stays authoritative regardless) ────────────────
let prisma = null, runRowId = null;
try {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
  await Promise.race([p.$queryRaw`SELECT 1`, new Promise((_, rej) => setTimeout(() => rej(new Error('db connect timeout')), 8000))]);
  prisma = p;
  console.log('[db] MigrationRun mirror enabled');
} catch (e) {
  console.log('[db] MigrationRun mirror DISABLED (DB not reachable):', String(e?.message || e).split('\n')[0]);
}
async function mirror(state) {
  if (!prisma) return;
  const data = {
    kind: 'snapshot', target: state.snapshotId, snapshotId: state.snapshotId,
    status: state.status,
    cursor: state.current || {},
    // Surface request usage + pause reason on /api/migration/status.
    counters: { ...(state.counters || {}), _pipedriveRequests: state.requestBudget?.used ?? 0, _pipedriveRequestLimit: state.requestBudget?.limit ?? null },
    error: state.pausedReason || null,
    startedAt: new Date(state.startedAt),
    finishedAt: state.status === 'complete' ? new Date() : null,
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
console.log('bucket:', r2.bucket());
console.log(`request ceiling: ${priorUsed}/${limit} used (cumulative, persisted in R2)`);
console.log('scope: records + Airtable attachment bodies + Pipedrive file METADATA (no file bodies)');

const started = Date.now();
try {
  const omit = String(arg('--omit') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const manifest = await runSnapshot({ snapshotId, store, pd, at, log: (m) => console.log(m), mirror, budget, omit });
  await budget.flush();
  console.log(`\n✔ COMPLETE in ${((Date.now() - started) / 60000).toFixed(1)} min — Pipedrive requests used: ${budget.used}/${limit}`);
  console.log('counters:', JSON.stringify(manifest.counters, null, 2));
  if (prisma) await prisma.$disconnect();
  process.exit(0);
} catch (e) {
  await budget.flush().catch(() => {});
  const tail = `Pipedrive requests used this run: ${budget.used}/${limit}. Checkpoint preserved.`;
  if (e?.code === 'RATE_BUDGET_EXCEEDED') {
    console.error(`\n⏸ PAUSED — Pipedrive daily request budget exceeded. Reset in ~${Math.round((e.retryAfter || 0) / 60)} min.`);
    console.error(tail);
  } else if (e?.code === 'RUN_LIMIT_REACHED') {
    console.error(`\n⏸ PAUSED — hit the approved run ceiling (${e.used}/${e.limit}). No further calls made.`);
    console.error('Raise MIGRATION_MAX_REQUESTS explicitly to continue.');
  } else if (e?.code === 'FIELD_PARITY_FAILED') {
    console.error(`\n⛔ ABORTED BEFORE WRITING — ${e.message}`);
    console.error(tail);
    if (prisma) await prisma.$disconnect().catch(() => {});
    process.exit(4);
  } else {
    console.error('\n✗ SNAPSHOT ERROR:', e?.message || e);
    console.error(tail);
  }
  console.error(`Resume (after approval) with the SAME id: --snapshot ${snapshotId}`);
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(3);
}
