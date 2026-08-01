// READ-ONLY scope + capability audit for the 2026-only file resume.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/files-2026-scope.mjs [--probe]
//
// Answers, without fetching a single Deal from Pipedrive:
//   * which Pipedrive deals were created in calendar 2026 (from the R2 snapshot
//     of raw deal rows — already-captured metadata, zero API cost);
//   * which census file rows belong to them (the census already holds every
//     file's metadata: 170k rows listed once, at 500/page);
//   * which of those already have a body in GOS/R2, and which are genuinely
//     missing;
//   * the exact number of API requests the remainder needs under the REAL
//     endpoint contract — one request per body, because Pipedrive exposes no
//     bulk body download.
//
// --probe adds ONE cheap metadata request to read the live rate-limit headers.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const SNAP = arg('--snapshot') || 'snap-20260730T081731Z-44cb';
const YEAR = '2026';

// ── 1. the 2026 deal population, from the snapshot of raw Pipedrive deals ────
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
const man = await reader.entityManifest('pipedrive/deals');
const addTimeById = new Map();
for (const s of man.shards || []) {
  for (const row of await reader.readShard(s.key)) {
    const id = row?.id ?? row?.fields?.id;
    const add = row?.add_time ?? row?.fields?.add_time;
    if (id != null && add) addTimeById.set(String(id), String(add));
  }
  reader._shardCache.clear();
}
const dealsByYear = {};
const deals2026 = new Set();
for (const [id, add] of addTimeById) {
  const yr = add.slice(0, 4);
  dealsByYear[yr] = (dealsByYear[yr] || 0) + 1;
  if (yr === YEAR) deals2026.add(id);
}
console.log(`snapshot ${SNAP}: ${addTimeById.size} pipedrive deals with add_time`);
console.log('  by creation year:', JSON.stringify(dealsByYear));
console.log(`  → ${YEAR} deals: ${deals2026.size}`);

// ── 2. census (already listed — no new list calls) ──────────────────────────
const keys = (await r2.listKeys('files-census/')).map((k) => String(k.Key || k.key || k));
const censusKey = keys.filter((k) => k.includes('files-census-')).sort().at(-1);
const census = JSON.parse(await r2.getObjectText(censusKey));
console.log(`\ncensus ${census.censusId}: ${census.files.length} file rows (listed once, reused)`);

// ── 3. crosswalks: what GOS already has ─────────────────────────────────────
const [dealLinks, fileRows] = await Promise.all([
  prisma.legacyRecord.findMany({
    where: { sourceSystem: 'pipedrive', sourceType: 'deal', entityId: { not: null } },
    select: { sourceId: true, entityId: true },
  }),
  prisma.legacyRecord.findMany({
    where: { sourceSystem: 'pipedrive', sourceType: 'file' },
    select: { sourceId: true, entityId: true, payload: true },
  }),
]);
const gosDealByLegacy = new Map(dealLinks.map((l) => [l.sourceId, l.entityId]));
const doneById = new Map(fileRows.map((r) => [r.sourceId, { hasBody: !!r.entityId, policy: r.payload?.policy || null }]));
const gosStatus = new Map(
  (await prisma.deal.findMany({ where: { id: { in: [...gosDealByLegacy.values()] } }, select: { id: true, status: true } }))
    .map((d) => [d.id, d.status]),
);

// ── 4. classify the 2026 slice under the SAME owner-approved policy C ───────
const b = {
  total2026Files: 0, alreadyBody: 0, alreadyMetadataOnly: 0,
  emailAttachment: 0, noDeal: 0, dealNotInGos: 0,
  remoteLink: [], closedDeal: [], missingBody: [],
};
for (const f of census.files) {
  if (!f.deal_id || !deals2026.has(String(f.deal_id))) continue;
  b.total2026Files += 1;
  const done = doneById.get(String(f.id));
  if (done?.hasBody) { b.alreadyBody += 1; continue; }
  if (f.mail_message_id) { b.emailAttachment += 1; continue; }   // Gmail owns these
  const gosId = gosDealByLegacy.get(String(f.deal_id));
  if (!gosId) { b.dealNotInGos += 1; continue; }
  const remote = f.remote_location && f.remote_location !== 'pipedrive' && f.remote_location !== 's3';
  if (remote) { b.remoteLink.push({ f, gosId }); continue; }     // link preserved, no body
  if (done) { b.alreadyMetadataOnly += 1; continue; }            // crosswalked, body deliberately skipped
  if (!['open', 'won'].includes(gosStatus.get(gosId))) { b.closedDeal.push({ f, gosId }); continue; }
  b.missingBody.push({ f, gosId });
}

const mb = b.missingBody.reduce((s, x) => s + (Number(x.f.file_size) || 0), 0);
console.log(`\n── ${YEAR} SCOPE ──`);
console.log(`  file rows on ${YEAR} deals            : ${b.total2026Files}`);
console.log(`  already have a body in GOS/R2       : ${b.alreadyBody}`);
console.log(`  already crosswalked metadata-only   : ${b.alreadyMetadataOnly}`);
console.log(`  email attachments (Gmail owns them) : ${b.emailAttachment}`);
console.log(`  remote links (Drive — link kept)    : ${b.remoteLink.length}`);
console.log(`  closed-deal files (policy C: no body): ${b.closedDeal.length}`);
console.log(`  deal not in GOS                     : ${b.dealNotInGos}`);
console.log(`  BODIES GENUINELY MISSING            : ${b.missingBody.length}  (${(mb / 1048576).toFixed(1)} MB)`);
console.log(`\n  API requests required: ${b.missingBody.length} downloads (1 body per request — Pipedrive has no bulk body endpoint)`);
console.log('  list requests required: 0 (census reused)');

// ── 5. optional live capability probe — ONE request ─────────────────────────
if (process.argv.includes('--probe')) {
  const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
  const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();
  const res = await fetch(`https://${domain}.pipedrive.com/api/v1/files?limit=1&api_token=${encodeURIComponent(token)}`);
  const h = Object.fromEntries([...res.headers].filter(([k]) => /ratelimit|retry|daily/i.test(k)));
  console.log('\n── live capability probe (1 request) ──');
  console.log('  status:', res.status);
  console.log('  rate-limit headers:', JSON.stringify(h, null, 1));
  const j = await res.json().catch(() => null);
  console.log('  pagination:', JSON.stringify(j?.additional_data?.pagination || null));
}

await prisma.$disconnect();
