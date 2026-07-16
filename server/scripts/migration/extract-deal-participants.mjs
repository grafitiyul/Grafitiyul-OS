// APPEND-ONLY extraction: secondary deal participants for the 478 Pipedrive deals
// with participants_count > 1.
//
// ── APPROVED PLAN (owner, 2026-07-15) ────────────────────────────────────────
//   endpoint : GET /api/v1/deals/{id}/participants   (no bulk endpoint exists)
//   scope    : the 478 deals with participants_count > 1, read from Snapshot #1
//   ceiling  : 500 requests / 10,000 tokens (v1 GET list = 20 tokens)
//   appends  : pipedrive/deal_participants — a NEW entity in the EXISTING snapshot
//
// ── IMMUTABILITY ─────────────────────────────────────────────────────────────
//   * No existing entity, shard, or manifest is ever rewritten.
//   * Snapshot #1's `_run.json` is NEVER touched — it is the authoritative state of
//     the completed run. This extraction keeps its own `_run_participants.json`, so
//     a failure here cannot corrupt the original snapshot's resumability.
//   * The top manifest IS rewritten, because it is the entity registry and the new
//     entity must be discoverable. Every existing key is carried over verbatim and
//     the previous manifest is archived first (manifest.pre-participants.json).
//   * Shards are content-hashed exactly like every other entity; the entity manifest
//     carries per-shard hashes + a combined hash, so verification works unchanged.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
//   * MIGRATION_EXTRACTION_ENABLED must be true; default-off is the post-incident
//     rule and this script refuses to run without it.
//   * Every request passes RequestBudget.take() first — it throws before exceeding.
//   * The FIRST response is shape-checked before a second request is made. If the
//     payload or pagination differs materially from the plan, it aborts at ONE
//     request and reports, per the owner's instruction.
//   * Resumable: completed deal ids are persisted, so a restart re-reads nothing.
//   * No auto-resume: this is a one-shot script. Nothing schedules it.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/extract-deal-participants.mjs --snapshot <id> [--dry]
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { SnapshotWriter, SHARD_SIZE } from '../../src/migration/snapshotWriter.js';
import { pipedriveClient } from '../../src/migration/sources/pipedrive.js';
import { RequestBudget, RunLimitReached } from '../../src/migration/budget.js';
import { extractionEnabled } from '../../src/migration/config.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
const dry = process.argv.includes('--dry');
if (!snapshotId) { console.error('usage: --snapshot <id> [--dry]'); process.exit(1); }

const MAX_REQUESTS = 500;          // hard ceiling, as approved
const TOKENS_PER_REQUEST = 20;     // v1 GET list
const MAX_TOKENS = 10000;          // hard ceiling, as approved
const SYSTEM = 'pipedrive';
const ENTITY = 'deal_participants';
const ENTITY_KEY = `${SYSTEM}/${ENTITY}`;

const store = {
  put: r2.putObject, head: r2.headObject, getText: r2.getObjectText,
};
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });
const writer = new SnapshotWriter({ snapshotId, store });
const RUN_KEY = `snapshots/${snapshotId}/_run_participants.json`;
const pid = (v) => (v && typeof v === 'object' ? v.value : v) ?? null;
const log = (...a) => console.log(...a);

// ── 1) Scope: read the target deal ids from the snapshot (no API call) ───────
const targets = [];
{
  const man = await reader.entityManifest('pipedrive/deals');
  for (const s of man.shards || []) {
    for (const d of await reader.readShard(s.key)) {
      if ((d.participants_count || 0) > 1) targets.push({ id: d.id, count: d.participants_count });
    }
    reader._shardCache.clear();
  }
}
targets.sort((a, b) => a.id - b.id);
log(`target deals (participants_count > 1): ${targets.length}`);
log(`  distribution: ${JSON.stringify(targets.reduce((a, t) => ({ ...a, [t.count]: (a[t.count] || 0) + 1 }), {}))}`);
if (targets.length > MAX_REQUESTS) {
  console.error(`ABORT: ${targets.length} deals exceeds the approved ceiling of ${MAX_REQUESTS} requests`);
  process.exit(1);
}

// ── 2) Resume state (separate from the snapshot's own _run.json) ─────────────
async function readRun() {
  if (!(await r2.headObject(RUN_KEY))) return null;
  try { return JSON.parse(await r2.getObjectText(RUN_KEY)); } catch { return null; }
}
async function writeRun(state) {
  await r2.putObject({ key: RUN_KEY, body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'), contentType: 'application/json' });
}
let state = (await readRun()) || {
  snapshotId, entity: ENTITY_KEY, status: 'running', startedAt: new Date().toISOString(),
  requestBudget: { limit: MAX_REQUESTS, used: 0 },
  doneDealIds: [], shards: [], links: 0,
};
const done = new Set(state.doneDealIds);
const pending = targets.filter((t) => !done.has(t.id));
log(`already done: ${done.size} · pending: ${pending.length}`);
log(`planned: ${pending.length} requests · ~${pending.length * TOKENS_PER_REQUEST} tokens (ceiling ${MAX_REQUESTS} / ${MAX_TOKENS})`);

if (dry) { log('\n--dry: no Pipedrive call made, nothing written'); process.exit(0); }

// ── 3) Safety gate ───────────────────────────────────────────────────────────
if (!extractionEnabled()) {
  console.error('ABORT: MIGRATION_EXTRACTION_ENABLED is not true. Extraction is OFF by default (post-incident rule).');
  process.exit(1);
}
const budget = new RequestBudget({
  limit: MAX_REQUESTS,
  used: state.requestBudget.used,
  persistEvery: 25,
  onPersist: async (b) => { state.requestBudget = b; await writeRun(state); },
});
const pd = pipedriveClient({ budget, throttleMs: 120 });
log(`pipedrive domain: ${pd.domain} · extraction ENABLED · ceiling ${MAX_REQUESTS} requests\n`);

// ── 4) Extract ───────────────────────────────────────────────────────────────
let buffer = [];
let shardIndex = state.shards.length;
let checked = false;

async function flushShard() {
  if (!buffer.length) return;
  shardIndex += 1;
  const desc = await writer.writeShard({ system: SYSTEM, entity: ENTITY, shardIndex, records: buffer });
  state.shards.push(desc);
  buffer = [];
  // Persist ONLY at a flush boundary: the buffer is empty and every done id is
  // durably written, so a restart can never duplicate or lose a link.
  state.requestBudget = budget.snapshot();
  await writeRun(state);
  log(`  ✓ shard ${desc.key.split('/').pop()} — ${desc.records} links`);
}

// The plan says: one page, <=4 participants, no pagination. Verify on the FIRST
// response and abort if reality disagrees — before spending the ceiling.
function checkShape(json, dealId) {
  const problems = [];
  if (!json || typeof json !== 'object') problems.push('response is not an object');
  if (!Array.isArray(json?.data)) problems.push(`data is ${typeof json?.data}, expected an array`);
  const pag = json?.additional_data?.pagination;
  if (pag?.more_items_in_collection) problems.push('pagination reports more_items_in_collection — plan assumed a single page');
  const first = json?.data?.[0];
  if (first && pid(first.person_id) == null) problems.push('participant has no resolvable person_id');
  if (problems.length) {
    console.error(`\nABORT — the endpoint differs materially from the approved plan (deal ${dealId}):`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error(`\nrequests used: ${budget.used} (ceiling ${MAX_REQUESTS}) — stopping well below it.`);
    console.error(`sample keys: ${JSON.stringify(Object.keys(json || {}))}`);
    console.error(`first record keys: ${JSON.stringify(Object.keys(first || {})).slice(0, 300)}`);
    process.exit(2);
  }
  log('  shape check PASSED: data[] array, single page, resolvable person_id');
  log(`  first record keys: ${JSON.stringify(Object.keys(first || {})).slice(0, 200)}\n`);
}

const t0 = Date.now();
try {
  for (const t of pending) {
    const json = await pd.get(`/deals/${t.id}/participants`, { start: 0, limit: 100 });
    if (!checked) { checkShape(json, t.id); checked = true; }
    for (const p of json?.data || []) {
      // RAW participant object, plus the deal id — which the payload does not carry
      // and which is the only join key. Nothing else is added or rewritten.
      buffer.push({ deal_id: t.id, person_id: pid(p.person_id), participant: p });
      state.links += 1;
    }
    done.add(t.id);
    state.doneDealIds = [...done];
    if (buffer.length >= SHARD_SIZE) await flushShard();
  }
  await flushShard();
} catch (e) {
  await flushShard();
  state.status = e instanceof RunLimitReached ? 'stopped_budget' : 'failed';
  state.error = String(e?.code || e?.message || e);
  state.requestBudget = budget.snapshot();
  await writeRun(state);
  console.error(`\nSTOPPED: ${state.error}`);
  console.error(`requests used: ${budget.used}/${MAX_REQUESTS} · deals done: ${done.size}/${targets.length}`);
  console.error('State is persisted — re-running resumes from here. Nothing auto-resumes.');
  process.exit(3);
}

// ── 5) Entity manifest ───────────────────────────────────────────────────────
const entityManifest = await writer.writeEntityManifest({
  system: SYSTEM, entity: ENTITY, shards: state.shards,
  params: { endpoint: '/api/v1/deals/{id}/participants', dealsRequested: targets.length, filter: 'participants_count > 1' },
  note: 'Secondary deal participants. One record per LINK: { deal_id, person_id, participant }. '
      + 'deal_id is added because the payload does not carry it and it is the only join key; '
      + '`participant` is the verbatim API object. Appended to Snapshot #1 on 2026-07-16; '
      + 'no existing entity, shard or manifest was modified.',
});
log(`\nentity manifest: ${entityManifest.totalRecords} links · ${entityManifest.shardCount} shards · combined ${entityManifest.combinedSha256.slice(0, 16)}…`);

// ── 6) Top manifest — additive registration, previous version archived ───────
const topKey = `snapshots/${snapshotId}/manifest.json`;
const top = JSON.parse(await r2.getObjectText(topKey));
await r2.putObject({
  key: `snapshots/${snapshotId}/manifest.pre-participants.json`,
  body: Buffer.from(JSON.stringify(top, null, 2), 'utf8'),
  contentType: 'application/json',
});
if (top.entities?.[ENTITY_KEY]) {
  console.error(`ABORT: ${ENTITY_KEY} already registered — refusing to rewrite an existing entity.`);
  process.exit(1);
}
const nextTop = {
  ...top,
  entities: {
    ...top.entities,
    [ENTITY_KEY]: {
      system: SYSTEM, entity: ENTITY,
      records: entityManifest.totalRecords,
      bytes: entityManifest.totalBytes,
      shards: entityManifest.shardCount,
      combinedSha256: entityManifest.combinedSha256,
      appendedAt: new Date().toISOString(),
    },
  },
  counters: { ...top.counters, [ENTITY_KEY]: entityManifest.totalRecords },
  totals: {
    entities: Object.keys(top.entities || {}).length + 1,
    records: Object.values({ ...top.counters, [ENTITY_KEY]: entityManifest.totalRecords })
      .reduce((n, v) => n + (Number(v) || 0), 0),
  },
  appended: [
    ...(top.appended || []),
    {
      entity: ENTITY_KEY, at: new Date().toISOString(),
      requests: budget.used, tokensEstimated: budget.used * TOKENS_PER_REQUEST,
      note: 'Owner-approved append. Existing entities untouched; previous manifest archived at manifest.pre-participants.json',
    },
  ],
};
await writer.writeTopManifest(nextTop);

state.status = 'complete';
state.finishedAt = new Date().toISOString();
state.requestBudget = budget.snapshot();
await writeRun(state);

log(`\n✔ COMPLETE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
log(`   deals requested : ${done.size}/${targets.length}`);
log(`   requests used   : ${budget.used}/${MAX_REQUESTS}`);
log(`   tokens (est.)   : ${budget.used * TOKENS_PER_REQUEST}/${MAX_TOKENS}`);
log(`   participant links: ${entityManifest.totalRecords}`);
log(`   snapshot entities: ${nextTop.totals.entities} · records ${nextTop.totals.records}`);
