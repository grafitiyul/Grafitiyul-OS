// Phase 2C verification — reconcile a completed snapshot against the audited
// numbers and prove integrity. READ-ONLY (lists + reads snapshot objects; writes
// nothing). Run:
//   railway run --service Grafitiyul-OS node server/scripts/migration/verify-snapshot.mjs --snapshot <id>
// Without --snapshot, verifies the most recent snapshots/<id>/manifest.json.
import crypto from 'node:crypto';
import * as r2 from '../../src/migration/r2.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

// Audited baselines (M1/M1b + Phase-2A live). Snapshot may drift a few rows since
// the audit; reconcile within tolerance and report exact snapshot counts.
const EXPECT = {
  'pipedrive/organizations': [2905, 20],
  'pipedrive/persons': [32472, 60],
  'pipedrive/deals': [24356, 20],
  'pipedrive/notes': [73555, 400],
  'pipedrive/activities': [154687, 800],
  'pipedrive/files': [170412, 2000],
  'pipedrive/deal_products': [15639, 500],
};
const AT_EXPECT = { 'סיורים': 3506, 'משתתפים': 4409, 'מעקב תשלומים': 1702, 'שכר': 2551, 'לקוחות עסקיים': 599, 'סיכומי סיור': 294 };
const EXPECT_ATTACHMENTS = 82;
const EXCLUDED_TABLE = 'גישה, סיסמאות';

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fails = [], warns = [];
const near = (a, [exp, tol]) => a != null && Math.abs(a - exp) <= tol;

async function findLatestSnapshot() {
  const objs = await r2.listKeys('snapshots/');
  const ids = new Set();
  for (const o of objs) { const m = o.key.match(/^snapshots\/([^/]+)\/manifest\.json$/); if (m) ids.add(m[1]); }
  return [...ids].sort().pop() || null;
}

async function main() {
  const snapshotId = arg('--snapshot') || (await findLatestSnapshot());
  if (!snapshotId) { console.error('no completed snapshot found'); process.exit(1); }
  const root = `snapshots/${snapshotId}`;
  console.log(`verifying ${snapshotId}\n`);

  // Full object listing (one pass) → key → size.
  const listing = await r2.listKeys(root + '/');
  const sizeByKey = new Map(listing.map((o) => [o.key, o.size]));
  const report = { snapshotId, verifiedAt: new Date().toISOString(), objectCount: listing.length, totalBytes: listing.reduce((n, o) => n + o.size, 0), entities: {}, attachments: null };

  // Top + run manifests.
  let top, run;
  try { top = JSON.parse(await r2.getObjectText(`${root}/manifest.json`)); } catch { fails.push('top manifest.json missing/unreadable'); }
  try { run = JSON.parse(await r2.getObjectText(`${root}/_run.json`)); } catch { warns.push('_run.json missing/unreadable'); }
  if (run && run.status !== 'complete') fails.push(`run status is "${run.status}" (expected complete)`);
  report.status = top?.status || run?.status || 'unknown';

  // Per-entity verification from each _manifest.json.
  const entityKeys = [...new Set(listing.map((o) => o.key.match(new RegExp(`^${root}/(.+)/_manifest\\.json$`))?.[1]).filter(Boolean))];
  for (const ek of entityKeys.sort()) {
    if (ek === 'airtable/attachments') continue; // handled separately
    const man = JSON.parse(await r2.getObjectText(`${root}/${ek}/_manifest.json`));
    const shardSum = man.shards.reduce((n, s) => n + s.records, 0);
    // 1) shards sum == declared total
    if (shardSum !== man.totalRecords) fails.push(`${ek}: shard sum ${shardSum} ≠ manifest total ${man.totalRecords}`);
    // 2) every shard object exists with matching byte size
    for (const s of man.shards) {
      const actual = sizeByKey.get(s.key);
      if (actual == null) fails.push(`${ek}: shard object missing ${s.key}`);
      else if (actual !== s.bytes) fails.push(`${ek}: shard ${s.key} size ${actual} ≠ manifest ${s.bytes}`);
    }
    // 3) recompute combined hash from ordered shard hashes
    const combined = sha256Hex(Buffer.from(man.shards.map((s) => s.sha256).join(''), 'utf8'));
    if (man.combinedSha256 && combined !== man.combinedSha256) fails.push(`${ek}: combined hash mismatch`);
    // 4) sample content re-hash (first shard) — proves stored bytes hash as recorded
    let sampleOk = null;
    if (man.shards[0]) {
      const body = Buffer.from(await r2.getObjectText(man.shards[0].key), 'utf8');
      sampleOk = sha256Hex(body) === man.shards[0].sha256;
      if (!sampleOk) fails.push(`${ek}: sample shard content hash mismatch (${man.shards[0].key})`);
    }
    report.entities[ek] = { records: man.totalRecords, shards: man.shardCount, bytes: man.totalBytes, tableName: man.params?.tableName || null, sampleHashOk: sampleOk };
    // 5) reconcile against audited counts
    if (EXPECT[ek] && !near(man.totalRecords, EXPECT[ek])) warns.push(`${ek}: ${man.totalRecords} vs audited ${EXPECT[ek][0]} (±${EXPECT[ek][1]})`);
    const tName = man.params?.tableName;
    if (tName && AT_EXPECT[tName] != null && !near(man.totalRecords, [AT_EXPECT[tName], 50])) warns.push(`airtable "${tName}": ${man.totalRecords} vs audited ${AT_EXPECT[tName]} (±50)`);
    if (tName === EXCLUDED_TABLE) fails.push(`EXCLUDED table "${EXCLUDED_TABLE}" was captured — must never be snapshotted`);
  }

  // Attachments.
  try {
    const am = JSON.parse(await r2.getObjectText(`${root}/airtable/attachments/_manifest.json`));
    let bodyOk = 0, bodyMissing = 0;
    for (const a of am.attachments) {
      const sz = sizeByKey.get(a.key);
      if (sz == null) { bodyMissing++; fails.push(`attachment body missing ${a.key}`); }
      else { if (sz !== a.storedBytes) fails.push(`attachment ${a.key} size ${sz} ≠ manifest ${a.storedBytes}`); bodyOk++; }
    }
    report.attachments = { fileCount: am.fileCount, totalBytes: am.totalBytes, bodiesPresent: bodyOk, bodiesMissing: bodyMissing };
    if (!near(am.fileCount, [EXPECT_ATTACHMENTS, 5])) warns.push(`attachments ${am.fileCount} vs audited ${EXPECT_ATTACHMENTS}`);
  } catch { fails.push('airtable attachments manifest missing/unreadable'); }

  // Excluded table: no objects anywhere for it (defence-in-depth; keyed by id, so
  // this checks the run's excludedTables record + that no manifest named it).
  if (run && !(run.excludedTables || []).includes(EXCLUDED_TABLE)) warns.push('run state does not record the excluded table');

  // No Pipedrive file BODIES (only files.jsonl metadata by design).
  const bodyLike = listing.filter((o) => /\/files\/.*(?<!\.jsonl)$/.test(o.key) && !o.key.endsWith('_manifest.json'));
  report.pipedriveFileBodies = bodyLike.length;
  if (bodyLike.length) fails.push(`unexpected non-JSONL objects under pipedrive/files (${bodyLike.length}) — file bodies must NOT be in Snapshot #1`);

  report.reconciliation = { blocking: fails, warnings: warns, verdict: fails.length ? 'FAIL' : 'PASS' };
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nVERDICT: ${report.reconciliation.verdict}  (blocking ${fails.length}, warnings ${warns.length})`);
  for (const f of fails) console.log('  ✗', f);
  for (const w of warns) console.log('  ⚠', w);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('verify fatal:', e?.message || e); process.exit(1); });
