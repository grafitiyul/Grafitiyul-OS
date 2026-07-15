// Executable request plan — computes the EXACT Pipedrive request cost of
// finishing Snapshot #1 using only data already in R2. Makes ZERO Pipedrive
// calls (reads the snapshot's own deals shards to derive deal_products cost).
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/plan-requests.mjs --snapshot <id>
import * as r2 from '../../src/migration/r2.js';
import { SnapshotWriter } from '../../src/migration/snapshotWriter.js';
import { DEAL_IDS_PER_BULK_CALL, BULK_PAGE_LIMIT } from '../../src/migration/sources/pipedrive.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
if (!snapshotId) { console.error('usage: --snapshot <id>'); process.exit(1); }

const FILES_TOTAL_AUDITED = 170412; // Phase-2A census
const FILES_PAGE_CAP = 100;         // /files hard cap (v1 only, no v2 endpoint)

const store = { put: r2.putObject, head: r2.headObject, getText: r2.getObjectText };
const writer = new SnapshotWriter({ snapshotId, store });
const state = await writer.readRunState();
if (!state) { console.error(`no run state for ${snapshotId}`); process.exit(1); }

console.log(`════ Executable request plan — ${snapshotId} ════\n`);

// ── Completed entities make ZERO calls ──────────────────────────────────────
const completed = Object.keys(state.completed || {});
console.log(`Completed entities (0 calls each): ${completed.length}`);
for (const k of completed) console.log(`  ✓ ${k}: ${state.completed[k].records} records — 0 requests`);

// ── files: resume from the exact checkpoint ─────────────────────────────────
let filesCaptured = 0;
if (state.completed['pipedrive/files']) filesCaptured = state.completed['pipedrive/files'].records;
else if (state.current?.key === 'pipedrive/files') filesCaptured = Number(state.current.cursor?.start || 0);
const filesRemainingRows = Math.max(0, FILES_TOTAL_AUDITED - filesCaptured);
const filesRequests = Math.ceil(filesRemainingRows / FILES_PAGE_CAP);

// ── deal_products: exact cost derived from the deals snapshot ───────────────
const dealsManifest = await writer.readEntityManifest('pipedrive', 'deals');
if (!dealsManifest) { console.error('deals entity not snapshotted — cannot plan deal_products'); process.exit(1); }
const targets = [];
let totalLines = 0, dealsScanned = 0;
for (const shard of dealsManifest.shards) {
  const text = await store.getText(shard.key);
  for (const line of text.split('\n')) {
    if (!line) continue;
    const d = JSON.parse(line);
    dealsScanned++;
    const pc = Number(d.products_count || 0);
    if (pc > 0) { targets.push({ id: d.id, pc }); totalLines += pc; }
  }
}
targets.sort((a, b) => a.id - b.id);

// Walk the real batches: pages per batch = ceil(rows_in_batch / 500).
let dpRequests = 0, batches = 0, multiPageBatches = 0, maxBatchRows = 0;
for (let i = 0; i < targets.length; i += DEAL_IDS_PER_BULK_CALL) {
  const batch = targets.slice(i, i + DEAL_IDS_PER_BULK_CALL);
  const rows = batch.reduce((n, t) => n + t.pc, 0);
  const pages = Math.max(1, Math.ceil(rows / BULK_PAGE_LIMIT));
  dpRequests += pages; batches++;
  if (pages > 1) multiPageBatches++;
  maxBatchRows = Math.max(maxBatchRows, rows);
}
const oldPath = targets.length; // the retired one-request-per-deal cost

// ── catalog + verification margin ───────────────────────────────────────────
const catalogRequests = 2;      // /products at limit=500 (small catalog)
const verificationMargin = 3;   // field-parity inspection + slack

const total = filesRequests + dpRequests + catalogRequests + verificationMargin;
const recommendedLimit = Math.ceil((total * 1.2) / 50) * 50;

console.log(`\n── Remaining work ──`);
console.log(`files (metadata)      : ${filesRequests} requests  | ${filesRemainingRows} rows remaining of ${FILES_TOTAL_AUDITED} (captured ${filesCaptured}) @ ${FILES_PAGE_CAP}/page (v1 cap, no v2)`);
console.log(`deal_products (v2 bulk): ${dpRequests} requests  | ${targets.length} target deals, ${totalLines} product lines, ${batches} batches @ ${DEAL_IDS_PER_BULK_CALL} ids, limit ${BULK_PAGE_LIMIT}`);
console.log(`                        multi-page batches: ${multiPageBatches}, largest batch rows: ${maxBatchRows}`);
console.log(`products catalog      : ${catalogRequests} requests  | name resolution for historical lines`);
console.log(`verification margin   : ${verificationMargin} requests`);
console.log(`deals re-page to find targets: 0 requests  (read ${dealsScanned} deals from R2 snapshot)`);
console.log(`\nTOTAL EXPECTED        : ${total} Pipedrive requests`);
console.log(`RECOMMENDED HARD LIMIT: ${recommendedLimit}  (MIGRATION_MAX_REQUESTS, ~20% margin)`);

console.log(`\n── Optimization proof ──`);
console.log(`old per-deal path : ${oldPath} requests (1 per deal)`);
console.log(`new v2 bulk path  : ${dpRequests} requests`);
console.log(`reduction         : ${(100 * (1 - dpRequests / oldPath)).toFixed(2)}%  (${oldPath} → ${dpRequests})`);

console.log(`\nNo audit or full recount will run: every completed entity is skipped (${completed.length} entities, 0 requests).`);
console.log(JSON.stringify({ plan: { filesRequests, dpRequests, catalogRequests, verificationMargin, total, recommendedLimit, targets: targets.length, totalLines, oldPath } }, null, 2));
