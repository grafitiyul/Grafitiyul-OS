// READ-ONLY migration state inspection. Answers: is 2B started, do snapshot
// objects exist, MigrationRun status, readyForExtraction, safe resume point.
// railway run --service Grafitiyul-OS node server/scripts/migration/inspect-state.mjs  (inject MIGRATION_DB_URL for the DB part)
import { migrationConfigStatus } from '../../src/migration/config.js';
import * as r2 from '../../src/migration/r2.js';

const cfg = migrationConfigStatus();
console.log('readyForExtraction:', cfg.readyForExtraction, '| bucket:', cfg.snapshotStorage.bucket);

// R2 snapshot inventory
const objs = await r2.listKeys('snapshots/');
const byId = new Map();
for (const o of objs) {
  const id = o.key.split('/')[1];
  if (!byId.has(id)) byId.set(id, { objects: 0, bytes: 0 });
  const g = byId.get(id); g.objects++; g.bytes += o.size;
}
console.log(`\nsnapshot objects in bucket: ${objs.length} across ${byId.size} snapshot id(s)`);
for (const [id, g] of byId) {
  let run = null, top = null;
  try { run = JSON.parse(await r2.getObjectText(`snapshots/${id}/_run.json`)); } catch {}
  try { top = JSON.parse(await r2.getObjectText(`snapshots/${id}/manifest.json`)); } catch {}
  console.log(`\n[${id}] objects=${g.objects} bytes=${(g.bytes / 1048576).toFixed(1)}MB`);
  console.log(`  _run.json: ${run ? `status=${run.status} completed=${Object.keys(run.completed || {}).length}/${(run.plan || []).length} current=${run.current?.key || 'none'} updatedAt=${run.updatedAt}` : 'MISSING'}`);
  console.log(`  manifest.json (finalized): ${top ? `YES status=${top.status} records=${top.totals?.records}` : 'not yet (run incomplete)'}`);
  if (run?.completed) for (const [k, v] of Object.entries(run.completed)) console.log(`    ✓ ${k}: ${v.records}`);
  if (run?.current) console.log(`    ▶ in-progress: ${run.current.key} (cursor ${JSON.stringify(run.current.cursor)}, shards ${run.current.shards?.length || 0})`);
}

// MigrationRun table (best-effort)
try {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
  await Promise.race([p.$queryRawUnsafe('SELECT 1'), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
  const runs = await p.migrationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
  console.log(`\nMigrationRun rows: ${runs.length}`);
  for (const r of runs) console.log(`  [${r.id.slice(-6)}] kind=${r.kind} snapshotId=${r.snapshotId} status=${r.status} started=${r.startedAt?.toISOString?.() || r.startedAt} finished=${r.finishedAt || 'null'} counters=${JSON.stringify(r.counters)}`);
  const legacy = await p.legacyRecord.count();
  console.log(`LegacyRecord count (must be 0): ${legacy}`);
  await p.$disconnect();
} catch (e) { console.log('\nMigrationRun: DB not reachable from this env —', String(e?.message || e).split('\n')[0]); }
