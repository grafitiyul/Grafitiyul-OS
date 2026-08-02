// Files import — POLICY C, owner-approved 2026-07-30:
//   * bodies copied for files on ACTIVE (open/won) deals → R2 + unified DealFile;
//   * closed-deal files: metadata-only crosswalk (payload retains everything
//     needed to fetch later), body deliberately not copied at this stage;
//   * email attachments (mail_message_id set): EXCLUDED — GOS already receives
//     email attachments through its own Gmail integration; importing Pipedrive's
//     copies would duplicate them. Reported, not silent;
//   * remote-linked files (Drive etc.): there IS no body at Pipedrive — the
//     crosswalk stores the remote URL, honouring "preserve the link, do not
//     silently omit".
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/import-files.mjs \
//       [--census <censusId>] [--limit N] [--execute]
//
// Idempotent: crosswalk-first (sourceType 'file'), resume = re-run. Downloads are
// throttled and ceilinged; a failure mid-run loses nothing but time.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const EXECUTE = process.argv.includes('--execute');
const LIMIT = Number(arg('--limit') || 0) || Infinity;
const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();
const CEILING = Number(arg('--ceiling') || 7600);
let used = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

// ── census ───────────────────────────────────────────────────────────────────
let censusKey = arg('--census') ? `files-census/${arg('--census')}.json` : null;
if (!censusKey) {
  const keys = await r2.listKeys('files-census/');
  const named = keys.map((k) => String(k.Key || k.key || k)).filter((k) => k.includes('files-census-')).sort();
  censusKey = named.at(-1);
}
if (!censusKey) { console.error('no census found — run files-census.mjs first'); process.exit(1); }
const census = JSON.parse(await r2.getObjectText(censusKey));
console.log(`census ${census.censusId}: ${census.files.length} files`);

// ── classification ───────────────────────────────────────────────────────────
const dealIds = [...new Set(census.files.map((f) => f.deal_id).filter(Boolean).map(String))];
const links = await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: { in: dealIds }, entityId: { not: null } },
  select: { sourceId: true, entityId: true },
});
const dealByLegacy = new Map(links.map((l) => [l.sourceId, l.entityId]));
const gosDeals = await prisma.deal.findMany({ where: { id: { in: [...dealByLegacy.values()] } }, select: { id: true, status: true } });
const statusByGos = new Map(gosDeals.map((d) => [d.id, d.status]));

const existing = new Set((await prisma.legacyRecord.findMany({
  where: { sourceSystem: 'pipedrive', sourceType: 'file' },
  select: { sourceId: true },
})).map((r) => r.sourceId));

const buckets = { emailAttachment: 0, noDeal: 0, dealNotInGos: 0, inactiveDeal: [], remoteLink: [], copyBody: [], alreadyImported: 0 };
for (const f of census.files) {
  if (existing.has(String(f.id))) { buckets.alreadyImported += 1; continue; }
  if (f.mail_message_id) { buckets.emailAttachment += 1; continue; }
  if (!f.deal_id) { buckets.noDeal += 1; continue; }
  const gosId = dealByLegacy.get(String(f.deal_id));
  if (!gosId) { buckets.dealNotInGos += 1; continue; }
  const active = ['open', 'won'].includes(statusByGos.get(gosId));
  const remote = f.remote_location && f.remote_location !== 'pipedrive' && f.remote_location !== 's3';
  if (remote) { buckets.remoteLink.push({ f, gosId }); continue; }
  if (!active) { buckets.inactiveDeal.push({ f, gosId }); continue; }
  buckets.copyBody.push({ f, gosId });
}
console.log(`classification:`);
console.log(`  copy body (active deals)     : ${buckets.copyBody.length}`);
console.log(`  metadata-only (closed deals) : ${buckets.inactiveDeal.length}`);
console.log(`  remote-linked (Drive etc.)   : ${buckets.remoteLink.length}`);
console.log(`  email attachments (excluded — Gmail path owns them): ${buckets.emailAttachment}`);
console.log(`  no deal attachment           : ${buckets.noDeal}`);
console.log(`  deal not in GOS              : ${buckets.dealNotInGos}`);
console.log(`  already imported             : ${buckets.alreadyImported}`);
console.log(`  download budget              : ${Math.min(buckets.copyBody.length, LIMIT)} of ceiling ${CEILING}`);

if (!EXECUTE) { console.log('\n--dry: nothing written. Re-run with --execute.'); await prisma.$disconnect(); process.exit(0); }

// ── metadata-only rows (closed deals + remote links): crosswalk, no body ─────
async function metadataOnly(list, why) {
  // CHUNKED — one createMany per row over the public proxy took ~1s each and
  // silently consumed the whole first hour of the run.
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const slice = list.slice(i, i + 500);
    await prisma.legacyRecord.createMany({
      data: slice.map(({ f, gosId }) => ({
        sourceSystem: 'pipedrive', sourceType: 'file', sourceId: String(f.id),
        entityType: null, entityId: null,
        importBatchId: `files-${census.censusId}`,
        cardData: [{ label: 'קובץ ממערכת קודמת', value: f.file_name || `file ${f.id}` }],
        payload: { ...f, gosDealId: gosId, policy: why },
      })),
      skipDuplicates: true,
    });
    n += slice.length;
    console.log(`  metadata ${why}: ${n}/${list.length}`);
  }
  return n;
}
const closedN = await metadataOnly(buckets.inactiveDeal, 'metadata_only_closed_deal');
const remoteN = await metadataOnly(buckets.remoteLink, 'remote_link_preserved');
console.log(`metadata-only crosswalks: closed ${closedN} · remote ${remoteN}`);

// ── bodies for active deals ──────────────────────────────────────────────────
async function download(fileId) {
  for (let attempt = 1; ; attempt += 1) {
    if (++used > CEILING) throw Object.assign(new Error(`download ceiling ${CEILING} reached`), { code: 'CEILING' });
    // A hung connection must fail, not freeze the whole run — 60s cap per file.
    const res = await fetch(`https://${domain}.pipedrive.com/api/v1/files/${fileId}/download?api_token=${encodeURIComponent(token)}`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (res.status === 429) {
      if (attempt > 6) throw new Error(`file ${fileId} → 429 after ${attempt} attempts`);
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 15_000 * attempt);
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`file ${fileId} → ${res.status}`), { status: res.status });
    const buf = Buffer.from(await res.arrayBuffer());
    await sleep(150);
    return buf;
  }
}

let copied = 0; let failed = 0; let bytes = 0;
const failures = [];
for (const { f, gosId } of buckets.copyBody.slice(0, LIMIT)) {
  try {
    const body = await download(f.id);
    const safeName = String(f.file_name || `file-${f.id}`).replace(/[^\w.\-֐-׿ ]+/g, '_').slice(0, 120);
    const r2Key = `deal-files/${gosId}/pd-${f.id}-${safeName}`;
    await r2.putObject({ key: r2Key, body, contentType: f.mime || 'application/octet-stream' });
    await prisma.$transaction(async (tx) => {
      const df = await tx.dealFile.create({
        data: {
          dealId: gosId, r2Key, bucket: r2.bucket(),
          filename: f.file_name || `file-${f.id}`,
          mimeType: f.mime || 'application/octet-stream',
          sizeBytes: body.length,
          uploadedById: null,
          ...(f.add_time ? { createdAt: new Date(`${String(f.add_time).replace(' ', 'T')}Z`) } : {}),
        },
      });
      await tx.legacyRecord.create({
        data: {
          sourceSystem: 'pipedrive', sourceType: 'file', sourceId: String(f.id),
          entityType: 'DealFile', entityId: df.id,
          importBatchId: `files-${census.censusId}`,
          payload: { ...f, gosDealId: gosId, policy: 'body_copied' },
        },
      });
    });
    copied += 1; bytes += body.length;
    if (copied % 100 === 0) console.log(`  …${copied} copied (${Math.round(bytes / 1048576)} MB, ${used} requests)`);
  } catch (e) {
    if (e.code === 'CEILING') { console.log(`\nceiling reached at ${copied} — resume by re-running`); break; }
    failed += 1;
    failures.push({ id: f.id, name: f.file_name, err: String(e.message).slice(0, 200) });
    if (failed <= 3) console.log(`  ✗ file ${f.id}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 400)}`);
  }
}

console.log(`\nbodies copied: ${copied} (${Math.round(bytes / 1048576)} MB) · failed: ${failed} · requests: ${used}`);
if (failures.length > 5) console.log(`  (${failures.length} total failures — re-run retries them; nothing was crosswalked for a failed download)`);
console.log(`DealFile total now: ${await prisma.dealFile.count()}`);
await prisma.$disconnect();
