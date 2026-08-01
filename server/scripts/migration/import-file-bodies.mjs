// FILE BODIES — the scoped, self-throttling, resumable body import.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/import-file-bodies.mjs
//       [--execute] [--year 2026|all] [--wait-for-window] [--ceiling N] [--delay ms]
//
// Why a separate script from import-files.mjs: the owner's priority is
// PIPEDRIVE USABILITY. This one is scoped (--year), budget-aware, single-process
// and built to STOP rather than push through. --year all covers every source
// year; --wait-for-window lets it be launched inside a throttle window and begin
// by itself when the budget resets.
//
// ── The real endpoint contract (audited, not assumed) ───────────────────────
//   * LISTING file metadata is bulk: GET /v1/files?start&limit, 500 rows/page.
//     Already done — the census in R2 holds all 170,781 rows, so this job makes
//     ZERO list calls.
//   * DOWNLOADING a body is NOT bulk: GET /v1/files/{id}/download returns one
//     body per request. There is no batch body endpoint, and pretending
//     otherwise would just be a slower loop with a nicer name.
//   * Therefore: requests = exactly the number of bodies still missing. Nothing
//     else costs a request.
//
// ── Safety, in order of precedence ──────────────────────────────────────────
//   1. PREFLIGHT. One cheap probe. A 429 (or any Retry-After) aborts the run
//      before a single body is fetched, and records when it is safe to return.
//   2. ONE PROCESS. A heartbeat lock in LegacyRecord; a second run refuses to
//      start. Four concurrent copies of the old importer are what exhausted the
//      token budget in the first place.
//   3. STOP, DON'T GRIND. A 429 mid-run ends the run immediately — no retry
//      storm. Same for a 3-failure streak or a latency regression.
//   4. CHECKPOINT-PER-FILE. The crosswalk row IS the checkpoint: a file with a
//      row is never fetched again, so resume is just re-running.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const MAX = Number(arg('--max') || 0) || Infinity;
const SNAP = arg('--snapshot') || 'snap-20260730T081731Z-44cb';
const YEAR = arg('--year') || '2026';           // 'all' = every year in the census
const ALL_YEARS = YEAR === 'all';
const WAIT = process.argv.includes('--wait-for-window'); // idle until the throttle clears
const CEILING = Number(arg('--ceiling') || 6500);        // hard per-run request cap
const BUDGET_RESERVE = Number(arg('--reserve') || 500);  // stop with this much daily budget left
const BASE_DELAY_MS = Number(arg('--delay') || 2000);   // 30 req/min — deliberately gentle
const LOCK_STALE_MS = 10 * 60 * 1000;
const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = { sourceSystem: 'gos', sourceType: 'files_import_lock', sourceId: 'singleton' };

let requests = 0;
const stats = { copied: 0, bytes: 0, failed: 0, skipped: 0, backoff: null, stoppedBecause: null };

// ── 1. one process only ─────────────────────────────────────────────────────
async function claimLock() {
  const now = Date.now();
  const existing = await prisma.legacyRecord.findUnique({
    where: { sourceSystem_sourceType_sourceId: LOCK },
  });
  const held = existing?.cardData?.heartbeatAt ? Date.parse(existing.cardData.heartbeatAt) : 0;
  if (existing && now - held < LOCK_STALE_MS) {
    console.error(`REFUSING TO START — another importer holds the lock (heartbeat ${existing.cardData.heartbeatAt}, pid ${existing.cardData.pid}).`);
    console.error('If that process is dead, wait for the lock to go stale (10 min) or clear it deliberately.');
    return false;
  }
  const card = { pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), year: YEAR };
  await prisma.legacyRecord.upsert({ where: { sourceSystem_sourceType_sourceId: LOCK }, create: { ...LOCK, cardData: card }, update: { cardData: card } });
  return true;
}
const heartbeat = async (extra = {}) => {
  await prisma.legacyRecord.update({
    where: { sourceSystem_sourceType_sourceId: LOCK },
    data: { cardData: { pid: process.pid, heartbeatAt: new Date().toISOString(), year: YEAR, ...stats, requests, ...extra } },
  }).catch(() => {});
};
const releaseLock = () => prisma.legacyRecord.delete({ where: { sourceSystem_sourceType_sourceId: LOCK } }).catch(() => {});

// ── 2. scope (zero API cost) ────────────────────────────────────────────────
async function scope() {
  const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
  const man = await reader.entityManifest('pipedrive/deals');
  const inYear = new Set();
  for (const s of man.shards || []) {
    for (const row of await reader.readShard(s.key)) {
      const id = row?.id ?? row?.fields?.id;
      const add = String(row?.add_time ?? row?.fields?.add_time ?? '');
      if (id != null && (ALL_YEARS ? add : add.startsWith(YEAR))) inYear.add(String(id));
    }
    reader._shardCache.clear();
  }
  const keys = (await r2.listKeys('files-census/')).map((k) => String(k.Key || k.key || k));
  const census = JSON.parse(await r2.getObjectText(keys.filter((k) => k.includes('files-census-')).sort().at(-1)));

  const [dealLinks, fileRows] = await Promise.all([
    prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'deal', entityId: { not: null } }, select: { sourceId: true, entityId: true } }),
    prisma.legacyRecord.findMany({ where: { sourceSystem: 'pipedrive', sourceType: 'file' }, select: { sourceId: true, entityId: true } }),
  ]);
  const gosDealByLegacy = new Map(dealLinks.map((l) => [l.sourceId, l.entityId]));
  const done = new Map(fileRows.map((r) => [r.sourceId, !!r.entityId]));
  const status = new Map((await prisma.deal.findMany({ where: { id: { in: [...gosDealByLegacy.values()] } }, select: { id: true, status: true } })).map((d) => [d.id, d.status]));

  const work = [];
  for (const f of census.files) {
    if (!f.deal_id || !inYear.has(String(f.deal_id))) continue;
    if (done.get(String(f.id))) continue;                       // body already copied — never twice
    if (f.mail_message_id) continue;                            // Gmail owns email attachments
    const gosId = gosDealByLegacy.get(String(f.deal_id));
    if (!gosId) continue;
    if (f.remote_location && f.remote_location !== 'pipedrive' && f.remote_location !== 's3') continue; // Drive link preserved elsewhere
    if (done.has(String(f.id))) continue;                       // crosswalked metadata-only already
    if (!['open', 'won'].includes(status.get(gosId))) continue;  // policy C
    work.push({ f, gosId });
  }
  return { work, censusId: census.censusId, dealsInYear: inYear.size };
}

// ── 3. preflight — never start into a throttled account ─────────────────────
async function preflight() {
  const res = await fetch(`https://${domain}.pipedrive.com/api/v1/files?limit=1&api_token=${encodeURIComponent(token)}`);
  requests += 1;
  const retryAfter = Number(res.headers.get('retry-after') || 0);
  if (res.status === 429 || retryAfter > 0) {
    const until = new Date(Date.now() + retryAfter * 1000).toISOString();
    stats.backoff = { status: res.status, retryAfterSeconds: retryAfter, safeAfter: until };
    return false;
  }
  return res.ok;
}

// ── 4. the run ──────────────────────────────────────────────────────────────
const { work, censusId, dealsInYear } = await scope();
console.log(`${EXECUTE ? 'EXECUTE' : 'DRY RUN'} · scope ${ALL_YEARS ? 'ALL YEARS' : YEAR} · source deals: ${dealsInYear} · census ${censusId}`);
console.log(`bodies still missing in scope: ${work.length} (${(work.reduce((s, w) => s + (Number(w.f.file_size) || 0), 0) / 1048576).toFixed(1)} MB)`);
console.log(`API requests this run would make: ${Math.min(work.length, MAX)} downloads + 1 preflight`);

if (!EXECUTE) { console.log('\n--dry: nothing fetched, nothing written. Re-run with --execute.'); await prisma.$disconnect(); process.exit(0); }
if (!work.length) { console.log(`nothing to do — the ${ALL_YEARS ? 'full' : YEAR} scope is complete.`); await prisma.$disconnect(); process.exit(0); }
if (!(await claimLock())) { await prisma.$disconnect(); process.exit(2); }

process.on('SIGINT', async () => { stats.stoppedBecause = 'interrupted'; await heartbeat(); await releaseLock(); await prisma.$disconnect(); process.exit(130); });

// THE gate. One probe. With --wait-for-window the run then IDLES for exactly as
// long as Pipedrive asked (plus a minute) and probes once more — so a job
// started inside a throttle window costs 1 request now, sleeps, and begins the
// moment the budget resets. Never a polling storm: one probe per wait.
let clear = await preflight();
if (!clear && WAIT) {
  for (let attempt = 1; attempt <= 6 && !clear; attempt += 1) {
    const waitMs = Math.max(60_000, (stats.backoff.retryAfterSeconds + 60) * 1000);
    console.log(`[${new Date().toISOString()}] throttled — idling ${(waitMs / 3600000).toFixed(2)}h (attempt ${attempt}); safe after ${stats.backoff.safeAfter}`);
    await heartbeat({ waitingUntil: stats.backoff.safeAfter, stoppedBecause: null });
    await sleep(waitMs);
    stats.backoff = null;
    clear = await preflight();
    if (clear) console.log(`[${new Date().toISOString()}] window cleared — starting transfers.`);
  }
}
if (!clear) {
  console.error(`\nPREFLIGHT REFUSED — Pipedrive returned ${stats.backoff.status}, Retry-After ${stats.backoff.retryAfterSeconds}s.`);
  console.error(`Safe to resume after ${stats.backoff?.safeAfter}. Not one body was requested.`);
  await heartbeat({ stoppedBecause: 'preflight_429' });
  await releaseLock();
  await prisma.$disconnect();
  process.exit(3);
}
console.log('preflight OK — starting.');

let streak = 0;
let delay = BASE_DELAY_MS;
const latencies = [];
for (const { f, gosId } of work.slice(0, MAX === Infinity ? undefined : MAX)) {
  if (requests >= CEILING) { stats.stoppedBecause = 'request_ceiling'; console.log(`
ceiling ${CEILING} reached — re-run to continue.`); break; }
  const t0 = Date.now();
  try {
    const res = await fetch(`https://${domain}.pipedrive.com/api/v1/files/${f.id}/download?api_token=${encodeURIComponent(token)}`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    requests += 1;
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || 0);
      stats.backoff = { status: 429, retryAfterSeconds: ra, safeAfter: new Date(Date.now() + ra * 1000).toISOString() };
      stats.stoppedBecause = 'rate_limited';
      console.error(`\n429 mid-run — stopping immediately (Retry-After ${ra}s). Progress is checkpointed; re-run to resume.`);
      break;
    }
    // Leave real headroom for normal Pipedrive work: if the account reports a
    // remaining daily budget, stop while a reserve is still untouched.
    const left = Number(res.headers.get('x-daily-requests-left') ?? res.headers.get('x-ratelimit-remaining') ?? NaN);
    if (Number.isFinite(left)) {
      stats.budgetLeft = left;
      if (left <= BUDGET_RESERVE) {
        stats.stoppedBecause = 'budget_reserve';
        console.error(`
stopping: only ${left} API requests left today (reserve ${BUDGET_RESERVE}). Re-run after the reset.`);
        break;
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    latencies.push(ms);

    const safeName = String(f.file_name || `file-${f.id}`).replace(/[^\w.\-֐-׿ ]+/g, '_').slice(0, 120);
    const r2Key = `deal-files/${gosId}/pd-${f.id}-${safeName}`;
    await r2.putObject({ key: r2Key, body, contentType: f.mime || 'application/octet-stream' });
    await prisma.$transaction(async (tx) => {
      const df = await tx.dealFile.create({
        data: {
          dealId: gosId, r2Key, bucket: r2.bucket(),
          filename: f.file_name || `file-${f.id}`,
          mimeType: f.mime || 'application/octet-stream',
          sizeBytes: body.length, uploadedById: null,
          ...(f.add_time ? { createdAt: new Date(`${String(f.add_time).replace(' ', 'T')}Z`) } : {}),
        },
      });
      // The crosswalk row IS the per-file checkpoint — written in the same
      // transaction as the DealFile, so a crash can never leave a body counted
      // as imported without its row (or the reverse).
      await tx.legacyRecord.create({
        data: {
          sourceSystem: 'pipedrive', sourceType: 'file', sourceId: String(f.id),
          entityType: 'DealFile', entityId: df.id,
          importBatchId: `files-${YEAR}-${censusId}`,
          payload: { ...f, gosDealId: gosId, policy: 'body_copied', scope: `${YEAR}_only` },
        },
      });
    });
    stats.copied += 1; stats.bytes += body.length; streak = 0;

    // Latency watch: a rising trend means Pipedrive is straining — slow down
    // before it has to say 429.
    if (latencies.length >= 20) {
      const recent = latencies.slice(-10).reduce((a, c) => a + c, 0) / 10;
      const early = latencies.slice(0, 10).reduce((a, c) => a + c, 0) / 10;
      if (recent > early * 2 && delay < 8000) { delay = Math.min(delay * 2, 8000); console.log(`  ↑ latency ${Math.round(early)}→${Math.round(recent)}ms — pacing back to ${delay}ms`); }
    }
    if (stats.copied % 25 === 0) { console.log(`  …${stats.copied}/${work.length} copied · ${(stats.bytes / 1048576).toFixed(1)} MB · ${requests} requests`); await heartbeat(); }
  } catch (e) {
    stats.failed += 1; streak += 1;
    console.error(`  ✗ file ${f.id}: ${String(e.message).slice(0, 120)}`);
    if (streak >= 3) { stats.stoppedBecause = 'failure_streak'; console.error('\n3 consecutive failures — stopping rather than pushing through.'); break; }
  }
  await sleep(delay);
}

await heartbeat();
await releaseLock();
console.log(`\n── run summary ──`);
console.log(`  copied      : ${stats.copied} (${(stats.bytes / 1048576).toFixed(1)} MB)`);
console.log(`  failed      : ${stats.failed}`);
console.log(`  requests    : ${requests}`);
console.log(`  remaining   : ${Math.max(0, work.length - stats.copied)}`);
console.log(`  stopped     : ${stats.stoppedBecause || 'completed scope'}`);
if (stats.backoff) console.log(`  backoff     : ${JSON.stringify(stats.backoff)}`);
await prisma.$disconnect();
