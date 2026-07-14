// ONE-TIME, READ-ONLY Pipedrive DEALS deep audit (M1).
//
// Verifies the deal count, ID range + gaps, pipeline×status distribution,
// deleted-deal accessibility, "operationally active" candidate scope, historical
// line-item availability (deal products), and Google-Drive folder-link fields.
// GET only. No writes anywhere. Full JSON → output/pipedrive-deals-audit.json.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'pipedrive';
const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const BASE = `https://${domain}.pipedrive.com/api/v1`;
const TODAY = new Date().toISOString().slice(0, 10); // e.g. 2026-07-14

// Custom-field keys (from pipedrive-audit.json) — names never read at runtime.
const F = {
  tourDate: 'a860fcf9681c2bb1f71200514cffdb5c8cadedb7',
  orderNo: 'e44cf2b028cae8882defb89ef25cc2ddec73a9d4',
  tourRegistered: '78ac7b22a9ac9a93b612128799742b0197c0cd5e',
  calEventId: '53c964f7d591b00585b249c659f36a03b37c71f0',
  driveFolder: '9a84626b2b956446809d64b2be3187de5ce6c6b1',
  participants: 'a124d37118d74bd32be8c92abbea93ecdc7af3c8',
};

function url(pathname, params = {}) {
  const u = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('api_token', TOKEN);
  return u.toString();
}
let lastRate = {};
async function pd(pathname, params = {}) {
  const r = await getJson(url(pathname, params), { label: pathname });
  if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
  await sleep(130);
  return r;
}

// Paginate a v1 collection fully (start/limit). Returns all rows.
async function paginateAll(pathname, params = {}, cap = 100000) {
  const rows = [];
  let start = 0;
  const limit = 500;
  for (;;) {
    const r = await pd(pathname, { ...params, start, limit });
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}: ${r.errorText || ''}`);
    const data = r.json?.data || [];
    rows.push(...data);
    const pag = r.json?.additional_data?.pagination;
    if (rows.length >= cap) break;
    if (pag?.more_items_in_collection) start = pag.next_start;
    else break;
  }
  return rows;
}

const daysBetween = (iso) => {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

async function main() {
  log(`[pipedrive-deals] deep audit — host ${domain}.pipedrive.com (today=${TODAY})`);
  const report = { system: SYSTEM, apiVersion: 'v1', today: TODAY, startedAt: new Date().toISOString() };

  // ── 1) Summary cross-check (server-side counts) ─────────────────────────────
  const sums = {};
  for (const status of ['open', 'won', 'lost']) {
    const s = await pd('/deals/summary', { status });
    sums[status] = s.json?.data?.total_count ?? null;
  }
  const sumAll = await pd('/deals/summary');
  report.summaryCounts = { ...sums, totalAllStatuses: sumAll.json?.data?.total_count ?? null };

  // ── 2) Full pagination (default filter = all_not_deleted) ───────────────────
  log('[pipedrive-deals] paginating ALL non-deleted deals…');
  const deals = await paginateAll('/deals', { status: 'all_not_deleted' });
  report.paginatedCount = deals.length;

  // ID range + gaps
  const ids = deals.map((d) => d.id).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const minId = ids[0] ?? null;
  const maxId = ids[ids.length - 1] ?? null;
  const idSet = new Set(ids);
  let missing = 0;
  const gapRuns = [];
  if (minId != null) {
    let runStart = null;
    for (let i = minId; i <= maxId; i++) {
      if (!idSet.has(i)) { missing++; if (runStart == null) runStart = i; }
      else if (runStart != null) { gapRuns.push([runStart, i - 1]); runStart = null; }
    }
    if (runStart != null) gapRuns.push([runStart, maxId]);
  }
  report.idRange = {
    minId, maxId,
    span: minId != null ? maxId - minId + 1 : 0,
    present: ids.length,
    missingInRange: missing,
    gapRunCount: gapRuns.length,
    largestGaps: gapRuns.map(([a, b]) => ({ from: a, to: b, size: b - a + 1 })).sort((x, y) => y.size - x.size).slice(0, 10),
  };

  // Count by pipeline × status
  const byPipeStatus = {};
  const statusHist = {};
  for (const d of deals) {
    statusHist[d.status] = (statusHist[d.status] || 0) + 1;
    const k = `p${d.pipeline_id}`;
    byPipeStatus[k] = byPipeStatus[k] || { open: 0, won: 0, lost: 0, other: 0 };
    if (['open', 'won', 'lost'].includes(d.status)) byPipeStatus[k][d.status]++; else byPipeStatus[k].other++;
  }
  report.statusHistogram = statusHist;
  report.byPipelineStatus = byPipeStatus;

  // ── 3) Deleted-deal accessibility probe ─────────────────────────────────────
  const del = await pd('/deals', { status: 'deleted', start: 0, limit: 500 });
  report.deletedProbe = {
    httpOk: del.ok,
    status: del.status,
    returnedOnFirstPage: Array.isArray(del.json?.data) ? del.json.data.length : null,
    moreItems: del.json?.additional_data?.pagination?.more_items_in_collection ?? null,
    note: 'Pipedrive purges deleted deals after ~30 days; only recently-deleted are returned.',
  };

  // ── 4) Operationally-active candidate scope (measured) ──────────────────────
  const cf = (d, key) => d[key];
  const buckets = {
    open: [], wonFutureTour: [], anyFutureTour: [], lostRecent90: [],
    hasOpenActivity: [], nextActivityFuture: [], recentlyModified30: [], hasOrderNo: [], hasDriveFolder: [],
  };
  const activeSet = new Set();
  for (const d of deals) {
    const tourDate = cf(d, F.tourDate);
    const futureTour = tourDate && tourDate >= TODAY;
    const upd = daysBetween(d.update_time);
    const nextAct = d.next_activity_date;
    const isOpen = d.status === 'open';
    if (isOpen) { buckets.open.push(d.id); activeSet.add(d.id); }
    if (d.status === 'won' && futureTour) { buckets.wonFutureTour.push(d.id); activeSet.add(d.id); }
    if (futureTour) { buckets.anyFutureTour.push(d.id); activeSet.add(d.id); }
    if (d.status === 'lost' && upd != null && upd <= 90) { buckets.lostRecent90.push(d.id); }
    if ((d.undone_activities_count || 0) > 0) { buckets.hasOpenActivity.push(d.id); }
    if (nextAct && nextAct >= TODAY) { buckets.nextActivityFuture.push(d.id); activeSet.add(d.id); }
    if (upd != null && upd <= 30) { buckets.recentlyModified30.push(d.id); }
    if (cf(d, F.orderNo)) buckets.hasOrderNo.push(d.id);
    if (cf(d, F.driveFolder)) buckets.hasDriveFolder.push(d.id);
  }
  // Non-terminal open-activity deals also count as active (ongoing work).
  for (const id of buckets.hasOpenActivity) activeSet.add(id);
  report.activeScope = {
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    proposedActiveUnionSize: activeSet.size,
    unionDefinition: 'open ∪ (won & future tour) ∪ any future tour ∪ future next-activity ∪ has open activity',
  };

  // ── 5) Google-Drive folder-link field inventory (from deal custom field) ────
  const driveVals = deals.map((d) => cf(d, F.driveFolder)).filter(Boolean).map(String);
  const isDriveFolder = (u) => /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i.test(u);
  const isDriveFile = (u) => /drive\.google\.com\/file\/|docs\.google\.com\//i.test(u);
  const dupes = {};
  for (const v of driveVals) dupes[v] = (dupes[v] || 0) + 1;
  report.driveLinks = {
    field: 'תיקייה בדרייב (deal custom field)',
    dealsWithLink: driveVals.length,
    lookLikeFolder: driveVals.filter(isDriveFolder).length,
    lookLikeFile: driveVals.filter(isDriveFile).length,
    other_or_malformed: driveVals.filter((v) => !isDriveFolder(v) && !isDriveFile(v)).length,
    duplicateLinkValues: Object.values(dupes).filter((n) => n > 1).length,
    sampleShapes: [...new Set(driveVals.slice(0, 2000).map((v) => v.replace(/[A-Za-z0-9_-]{15,}/g, '<ID>').slice(0, 60)))].slice(0, 8),
  };

  // ── 6) Historical line-item availability (deal products) ────────────────────
  const withProducts = deals.filter((d) => (d.products_count || 0) > 0);
  report.lineItems = { dealsWithProductsCount: withProducts.length };
  const pf = await pd('/productFields');
  report.lineItems.productFieldNames = (pf.json?.data || []).map((f) => f.name);
  const sample = withProducts.slice(0, 25);
  const shapes = [];
  for (const d of sample) {
    const dp = await pd(`/deals/${d.id}/products`);
    for (const line of dp.json?.data || []) {
      shapes.push({
        hasName: !!(line.name || line.product_id), hasQuantity: line.quantity != null,
        hasItemPrice: line.item_price != null, hasSum: line.sum != null,
        hasDiscount: (line.discount != null) || (line.discount_percentage != null),
        hasCurrency: !!line.currency, hasTax: line.tax != null, hasComments: !!line.comments,
      });
    }
  }
  const agg = (k) => shapes.filter((s) => s[k]).length;
  report.lineItems.sampledLines = shapes.length;
  report.lineItems.fieldPresence = shapes.length ? {
    name: agg('hasName'), quantity: agg('hasQuantity'), unitPrice: agg('hasItemPrice'),
    lineTotal: agg('hasSum'), discount: agg('hasDiscount'), currency: agg('hasCurrency'),
    taxVat: agg('hasTax'), notes: agg('hasComments'),
  } : 'no product lines in sample';

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('pipedrive-deals-audit.json', report);

  // ── stdout summary ──────────────────────────────────────────────────────────
  log('\n──────── DEALS DEEP AUDIT ────────');
  log(`summary counts: ${JSON.stringify(report.summaryCounts)}`);
  log(`paginated (all_not_deleted): ${report.paginatedCount} | statusHist: ${JSON.stringify(statusHist)}`);
  log(`id range: min=${minId} max=${maxId} span=${report.idRange.span} present=${report.idRange.present} missingInRange=${report.idRange.missingInRange} gapRuns=${report.idRange.gapRunCount}`);
  log(`deleted probe: page1=${report.deletedProbe.returnedOnFirstPage} more=${report.deletedProbe.moreItems}`);
  log(`active buckets: ${JSON.stringify(report.activeScope.counts)}`);
  log(`→ proposed active union: ${report.activeScope.proposedActiveUnionSize}`);
  log(`drive links: ${JSON.stringify(report.driveLinks)}`);
  log(`line items: dealsWithProducts=${report.lineItems.dealsWithProductsCount} sampledLines=${report.lineItems.sampledLines} presence=${JSON.stringify(report.lineItems.fieldPresence)}`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[pipedrive-deals] error: ${e?.message || e}`); process.exit(1); });
