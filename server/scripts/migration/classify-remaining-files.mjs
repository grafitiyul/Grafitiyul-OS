// READ-ONLY classification of the remaining file bodies. ZERO Pipedrive calls —
// every input is local: the R2 census (filenames, mime, size), the R2 snapshot
// of raw deal rows (source deal creation year) and the GOS crosswalks.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/classify-remaining-files.mjs [--samples N]
//
// Purpose: the account's daily Pipedrive budget is ~4,500 requests, and a large
// share of what is left are automatically generated proforma/חשבונית עסקה PDFs.
// Spending the budget on those instead of signed agreements and customer
// documents would be the wrong trade.
import { PrismaClient } from '@prisma/client';
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';
import { classifyFile, PROFORMA } from './fileClassification.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const SAMPLES = Number(arg('--samples') || 25);
const SNAP = arg('--snapshot') || 'snap-20260730T081731Z-44cb';
const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DB_URL || process.env.DATABASE_URL });

// ── source-deal creation year, from the snapshot (no API) ───────────────────
const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId: SNAP });
const man = await reader.entityManifest('pipedrive/deals');
const yearByDeal = new Map();
for (const s of man.shards || []) {
  for (const row of await reader.readShard(s.key)) {
    const id = row?.id ?? row?.fields?.id;
    const add = String(row?.add_time ?? row?.fields?.add_time ?? '');
    if (id != null && add) yearByDeal.set(String(id), add.slice(0, 4));
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

// Exactly the importer's remaining-work rule.
const remaining = [];
for (const f of census.files) {
  if (!f.deal_id) continue;
  if (done.get(String(f.id))) continue;
  if (f.mail_message_id) continue;
  const gosId = gosDealByLegacy.get(String(f.deal_id));
  if (!gosId) continue;
  if (f.remote_location && f.remote_location !== 'pipedrive' && f.remote_location !== 's3') continue;
  if (done.has(String(f.id))) continue;
  if (!['open', 'won'].includes(status.get(gosId))) continue;
  remaining.push({ f, gosId, year: yearByDeal.get(String(f.deal_id)) || 'unknown' });
}

const buckets = { proformaPre2026: [], proforma2026: [], other: [], uncertain: [] };
for (const row of remaining) {
  const c = classifyFile(row.f);
  row.classification = c;
  if (c.kind === PROFORMA) (row.year === '2026' ? buckets.proforma2026 : buckets.proformaPre2026).push(row);
  else if (c.kind === 'uncertain') buckets.uncertain.push(row);
  else buckets.other.push(row);
}

const mb = (list) => (list.reduce((s, r) => s + (Number(r.f.file_size) || 0), 0) / 1048576).toFixed(1);
console.log(`── REMAINING FILE CLASSIFICATION (zero Pipedrive calls) ──`);
console.log(`1. total remaining                    : ${remaining.length} (${mb(remaining)} MB)`);
console.log(`2. proforma, source deal PRE-2026     : ${buckets.proformaPre2026.length} (${mb(buckets.proformaPre2026)} MB)  → DEFERRED`);
console.log(`3. proforma, source deal 2026         : ${buckets.proforma2026.length} (${mb(buckets.proforma2026)} MB)  → import`);
console.log(`4. all other (distinct) files         : ${buckets.other.length} (${mb(buckets.other)} MB)  → import FIRST`);
console.log(`5. uncertain                          : ${buckets.uncertain.length} (${mb(buckets.uncertain)} MB)  → treated as important, imported`);
const actionable = buckets.other.length + buckets.uncertain.length + buckets.proforma2026.length;
console.log(`6. Pipedrive requests under policy    : ${actionable} downloads + 1 preflight  (vs ${remaining.length} unfiltered)`);
console.log(`   saved                              : ${remaining.length - actionable} requests (${((1 - actionable / remaining.length) * 100).toFixed(1)}%)`);
console.log(`7. token cost                         : v1 /files/{id}/download = 1 request each; Pipedrive exposes no`);
console.log(`                                        per-request token cost or remaining-budget header on this account`);
console.log(`                                        (only Retry-After), so 1 request == 1 unit. Measured daily`);
console.log(`                                        ceiling from the 2026-08-01 run: ~4,494 before 429.`);

const show = (label, list) => {
  console.log(`\n── ${label} — ${Math.min(SAMPLES, list.length)} of ${list.length} ──`);
  for (const r of list.slice(0, SAMPLES)) {
    console.log(`  [${r.year}] ${String(r.f.file_name || '(no name)').slice(0, 92)}  · ${r.f.mime || 'no-mime'} · ${Math.round((r.f.file_size || 0) / 1024)}KB · ${r.classification.why}`);
  }
};
show('OTHER (distinct files)', buckets.other);
show('UNCERTAIN', buckets.uncertain);
show('PROFORMA pre-2026 (deferred)', buckets.proformaPre2026);
show('PROFORMA 2026 (import)', buckets.proforma2026);

// Extension / mime distribution of what we are DEFERRING — the safety check
// that nothing non-PDF or oddly-shaped is hiding in the deferred pile.
const ext = {};
for (const r of buckets.proformaPre2026) {
  const e = String(r.f.file_name || '').split('.').pop().toLowerCase();
  ext[e] = (ext[e] || 0) + 1;
}
console.log('\ndeferred pile — extensions:', JSON.stringify(ext));
const mimes = {};
for (const r of buckets.proformaPre2026) mimes[r.f.mime || 'null'] = (mimes[r.f.mime || 'null'] || 0) + 1;
console.log('deferred pile — mime types:', JSON.stringify(mimes));
await prisma.$disconnect();
