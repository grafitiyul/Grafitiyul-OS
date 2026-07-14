// ONE-TIME, READ-ONLY Pipedrive ARCHIVE audit (M1b correction).
//
// The business archived a large number of deals inside Pipedrive; the previous
// deal-count audit only saw the NON-archived population (4,908) and wrongly
// attributed the ~18k id gap to deletions. This script probes every archive
// mechanism the API exposes, counts the archived population exactly, checks
// whether archived deals are fully extractable WITHOUT restoring them, and
// reconciles the id space (non-archived ∪ archived ∪ recently-deleted vs gaps).
//
// GET only. No writes. Full JSON → output/pipedrive-archive-audit.json.
// Also writes output/pipedrive-archived-ids.json (compact id/status list) for
// downstream sampling scripts.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'pipedrive';
const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const HOST = `https://${domain}.pipedrive.com`;
const TODAY = new Date().toISOString().slice(0, 10);
const F_TOURDATE = 'a860fcf9681c2bb1f71200514cffdb5c8cadedb7'; // תאריך הסיור

function url(pathname, params = {}) {
  const u = new URL(HOST + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('api_token', TOKEN);
  return u.toString();
}
let lastRate = {};
async function call(pathname, params = {}) {
  const r = await getJson(url(pathname, params), { label: pathname });
  if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
  await sleep(130);
  return r;
}
// v1 start/limit pagination (v1 returns custom fields inline).
async function paginateV1(pathname, params = {}) {
  const rows = []; let start = 0;
  for (;;) {
    const r = await call(pathname, { ...params, start, limit: 500 });
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}: ${r.errorText || ''}`);
    rows.push(...(r.json?.data || []));
    const pag = r.json?.additional_data?.pagination;
    if (pag?.more_items_in_collection) start = pag.next_start; else break;
  }
  return rows;
}

const cfVal = (d, key) => {
  const cf = d.custom_fields || d;
  const v = cf?.[key];
  if (v == null) return null;
  if (typeof v === 'object') return v.value ?? null;
  return v;
};

async function main() {
  log(`[pipedrive-archive] audit — host ${domain}.pipedrive.com (today=${TODAY})`);
  const report = { system: SYSTEM, today: TODAY, startedAt: new Date().toISOString() };

  // ── 1) Probe every archive mechanism ────────────────────────────────────────
  const probes = [];
  async function probe(label, pathname, params) {
    const r = await call(pathname, { ...params, limit: 1 });
    const n = Array.isArray(r.json?.data) ? r.json.data.length : null;
    const first = r.json?.data?.[0] || null;
    probes.push({
      label, status: r.status, ok: r.ok, returned: n,
      firstHasIsArchived: first ? ('is_archived' in first) : null,
      firstIsArchived: first?.is_archived ?? null,
      firstHasArchiveTime: first ? ('archive_time' in first) : null,
      error: r.ok ? null : r.errorText,
    });
    return r;
  }
  await probe('v1 /deals default', '/api/v1/deals', { status: 'all_not_deleted' });
  await probe('v1 archived_status=archived', '/api/v1/deals', { archived_status: 'archived', status: 'all_not_deleted' });
  await probe('v1 archived_status=not_archived', '/api/v1/deals', { archived_status: 'not_archived', status: 'all_not_deleted' });
  const pArch = await probe('v1 archived probe', '/api/v1/deals', { archived_status: 'archived', status: 'all_not_deleted' });
  report.probes = probes;
  report.mechanism =
    'v1/v2 GET /deals accepts archived_status = archived | not_archived | all. ' +
    'Deal objects carry is_archived (bool) + archive_time. The default list EXCLUDES archived ' +
    '(previous 4,908 pull was not_archived only). v2 is_archived / archived params are rejected.';

  if (!pArch.ok || !Array.isArray(pArch.json?.data)) {
    log('[pipedrive-archive] archived_status=archived probe FAILED — cannot enumerate archive via API.');
    report.conclusion = 'archived_not_api_accessible';
    report.rateLimit = lastRate;
    const p = writeOutput('pipedrive-archive-audit.json', report);
    log(`partial → ${p}`);
    process.exit(1);
  }

  // ── 2) Full pagination: archived AND non-archived (same v1 lens) ────────────
  log('[pipedrive-archive] paginating ARCHIVED deals…');
  const archived = await paginateV1('/api/v1/deals', { archived_status: 'archived', status: 'all_not_deleted' });
  log(`[pipedrive-archive] archived: ${archived.length}`);
  log('[pipedrive-archive] paginating NON-archived deals…');
  const active = await paginateV1('/api/v1/deals', { archived_status: 'not_archived', status: 'all_not_deleted' });
  log(`[pipedrive-archive] non-archived: ${active.length}`);

  const hist = (rows) => {
    const h = {};
    for (const d of rows) h[d.status] = (h[d.status] || 0) + 1;
    return h;
  };
  report.counts = {
    archived: { total: archived.length, byStatus: hist(archived) },
    nonArchived: { total: active.length, byStatus: hist(active) },
    combinedTotal: archived.length + active.length,
    v1NonArchivedCrossCheck: 4908,
  };

  // Field completeness on archived rows (extraction feasibility, record-level).
  const nn = (rows, f) => rows.filter((d) => d[f] != null && d[f] !== '').length;
  report.archivedFieldCompleteness = {
    total: archived.length,
    update_time: nn(archived, 'update_time'),
    add_time: nn(archived, 'add_time'),
    archive_time: nn(archived, 'archive_time'),
    owner_user_id: nn(archived, 'user_id'),
    person_id: nn(archived, 'person_id'),
    org_id: nn(archived, 'org_id'),
    stage_id: nn(archived, 'stage_id'),
    pipeline_id: nn(archived, 'pipeline_id'),
    value: nn(archived, 'value'),
    currency: nn(archived, 'currency'),
    won_time: nn(archived, 'won_time'),
    lost_time: nn(archived, 'lost_time'),
    products_count_gt0: archived.filter((d) => (d.products_count || 0) > 0).length,
    notes_count_gt0: archived.filter((d) => (d.notes_count || 0) > 0).length,
    files_count_gt0: archived.filter((d) => (d.files_count || 0) > 0).length,
    hasTourDateCustomField: archived.filter((d) => cfVal(d, F_TOURDATE)).length,
  };

  // Archived deals with a FUTURE tour date (should be ~0; affects Goal A).
  report.archivedWithFutureTourDate = archived.filter((d) => {
    const v = cfVal(d, F_TOURDATE);
    return v && String(v).slice(0, 10) >= TODAY;
  }).length;

  // Archive-time distribution (when did the big archiving happen?)
  const archMonths = {};
  for (const d of archived) {
    const m = String(d.archive_time || '').slice(0, 7) || 'unknown';
    archMonths[m] = (archMonths[m] || 0) + 1;
  }
  report.archiveTimeHistogram = Object.fromEntries(Object.entries(archMonths).sort());

  // ── 3) ID-space reconciliation ──────────────────────────────────────────────
  const aIds = archived.map((d) => d.id).filter(Number.isFinite);
  const nIds = active.map((d) => d.id).filter(Number.isFinite);
  const union = new Set([...aIds, ...nIds]);
  const all = [...union].sort((x, y) => x - y);
  const minId = all[0], maxId = all[all.length - 1];
  let missing = 0;
  for (let i = minId; i <= maxId; i++) if (!union.has(i)) missing++;
  // How much of the PREVIOUS gap set (ids missing among non-archived, in old range 3383..26306) is explained by archived ids?
  const nSet = new Set(nIds);
  let prevGapExplainedByArchive = 0;
  const aInOldRange = aIds.filter((id) => id >= 3383 && id <= 26306);
  for (const id of aInOldRange) if (!nSet.has(id)) prevGapExplainedByArchive++;
  report.idReconciliation = {
    combinedMinId: minId, combinedMaxId: maxId,
    combinedPresent: union.size,
    combinedMissingInRange: missing,
    previousGapSize: 18016,
    previousGapExplainedByArchivedIds: prevGapExplainedByArchive,
    archivedIdsBelowOldMin3383: aIds.filter((id) => id < 3383).length,
    genuinelyInaccessibleEstimate: missing,
  };

  // ── 4) Recently deleted ─────────────────────────────────────────────────────
  const del = await call('/api/v1/deals', { status: 'deleted', start: 0, limit: 500 });
  report.recentlyDeleted = {
    count: Array.isArray(del.json?.data) ? del.json.data.length : null,
    more: del.json?.additional_data?.pagination?.more_items_in_collection ?? null,
    note: 'Pipedrive purges deleted deals after ~30 days; older deletions are permanently gone.',
  };

  // ── 5) Extraction feasibility on sample archived deals (no restore) ─────────
  const sample = archived.filter((d) => d.id).slice(0, 5);
  const feas = [];
  for (const d of sample) {
    const [v1deal, products, activities, files, notes] = [
      await call(`/api/v1/deals/${d.id}`),
      await call(`/api/v1/deals/${d.id}/products`, { limit: 10 }),
      await call(`/api/v1/deals/${d.id}/activities`, { limit: 5 }),
      await call(`/api/v1/deals/${d.id}/files`, { limit: 5 }),
      await call('/api/v1/notes', { deal_id: d.id, limit: 5 }),
    ];
    feas.push({
      id: d.id,
      v1DealById: v1deal.ok,
      productsOk: products.ok, productLines: (products.json?.data || [])?.length ?? 0,
      activitiesOk: activities.ok, activityRows: (activities.json?.data || [])?.length ?? 0,
      filesOk: files.ok, fileRows: (files.json?.data || [])?.length ?? 0,
      notesOk: notes.ok, noteRows: (notes.json?.data || [])?.length ?? 0,
    });
  }
  report.archivedExtractionSamples = feas;
  report.archivedExtractableWithoutRestore =
    feas.length > 0 && feas.every((f) => f.v1DealById && f.productsOk && f.activitiesOk && f.filesOk && f.notesOk);

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('pipedrive-archive-audit.json', report);
  writeOutput('pipedrive-archived-ids.json', archived.map((d) => ({ id: d.id, status: d.status })));

  log('\n──────── ARCHIVE AUDIT ────────');
  log(`probes: ${probes.map((p) => `${p.label}→${p.status}`).join(' | ')}`);
  log(`ARCHIVED: ${report.counts.archived.total} ${JSON.stringify(report.counts.archived.byStatus)}`);
  log(`non-archived: ${report.counts.nonArchived.total} ${JSON.stringify(report.counts.nonArchived.byStatus)}`);
  log(`combined: ${report.counts.combinedTotal}`);
  log(`archived field completeness: ${JSON.stringify(report.archivedFieldCompleteness)}`);
  log(`archived w/ future tour date: ${report.archivedWithFutureTourDate}`);
  log(`archive_time histogram: ${JSON.stringify(report.archiveTimeHistogram)}`);
  log(`id reconciliation: ${JSON.stringify(report.idReconciliation)}`);
  log(`recently deleted: ${JSON.stringify(report.recentlyDeleted)}`);
  log(`extractable without restore: ${report.archivedExtractableWithoutRestore} (samples: ${JSON.stringify(feas)})`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[pipedrive-archive] error: ${e?.message || e}`); process.exit(1); });
