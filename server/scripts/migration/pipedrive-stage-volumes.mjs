// ONE-TIME, READ-ONLY: per-stage deal volumes across the FULL population
// (archived_status=all), for the owner's stage-mapping approval (Decision 2).
// Also: collection-pipeline paid/unpaid split and open-task counts by status.
// GET only. Full JSON → output/pipedrive-stage-volumes.json.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, 'pipedrive');
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const HOST = `https://${domain}.pipedrive.com`;

function url(pathname, params = {}) {
  const u = new URL(HOST + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('api_token', TOKEN);
  return u.toString();
}
async function call(pathname, params = {}) {
  const r = await getJson(url(pathname, params), { label: pathname });
  await sleep(130);
  return r;
}
async function paginateV1(pathname, params = {}) {
  const rows = []; let start = 0;
  for (;;) {
    const r = await call(pathname, { ...params, start, limit: 500 });
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}`);
    rows.push(...(r.json?.data || []));
    const pag = r.json?.additional_data?.pagination;
    if (pag?.more_items_in_collection) start = pag.next_start; else break;
  }
  return rows;
}

const [stagesRes, pipesRes] = [await call('/api/v1/stages'), await call('/api/v1/pipelines')];
const stageName = {}; const stagePipe = {};
for (const s of stagesRes.json?.data || []) { stageName[s.id] = s.name; stagePipe[s.id] = s.pipeline_id; }
const pipeName = {};
for (const p of pipesRes.json?.data || []) pipeName[p.id] = p.name;

log('[stage-volumes] paginating ALL deals (archived_status=all)…');
const deals = await paginateV1('/api/v1/deals', { status: 'all_not_deleted', archived_status: 'all' });
log(`[stage-volumes] total: ${deals.length}`);

// Per (pipeline, stage) × status × archived
const table = {};
for (const d of deals) {
  const key = `${d.pipeline_id}|${d.stage_id}`;
  table[key] = table[key] || { pipeline: pipeName[d.pipeline_id] || d.pipeline_id, stage: stageName[d.stage_id] || d.stage_id, open: 0, won: 0, lost: 0, archived: 0, total: 0 };
  const t = table[key];
  t.total++; t[d.status] = (t[d.status] || 0) + 1;
  if (d.is_archived) t.archived++;
}
const rows = Object.entries(table)
  .map(([k, v]) => ({ pipelineId: Number(k.split('|')[0]), stageId: Number(k.split('|')[1]), ...v }))
  .sort((a, b) => a.pipelineId - b.pipelineId || b.total - a.total);

// Open tasks by deal status (for the 7a refinement).
const openTasksByStatus = { open: 0, won: 0, lost: 0 };
for (const d of deals) if ((d.undone_activities_count || 0) > 0) openTasksByStatus[d.status] = (openTasksByStatus[d.status] || 0) + 1;

const report = { totalDeals: deals.length, rows, openTaskDealsByStatus: openTasksByStatus, finishedAt: new Date().toISOString() };
const out = writeOutput('pipedrive-stage-volumes.json', report);

log('\n──────── STAGE VOLUMES (full population incl. archived) ────────');
let lastPipe = null;
for (const r of rows) {
  if (r.pipelineId !== lastPipe) { log(`\n■ Pipeline ${r.pipelineId} — ${r.pipeline}`); lastPipe = r.pipelineId; }
  log(`   ${String(r.total).padStart(6)}  ${r.stage}  (open ${r.open} / won ${r.won} / lost ${r.lost} / archived ${r.archived})`);
}
log(`\ndeals with OPEN tasks by status: ${JSON.stringify(openTasksByStatus)}`);
log(`full → ${out}`);
