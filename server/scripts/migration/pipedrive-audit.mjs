// ONE-TIME, READ-ONLY Pipedrive migration audit.
//
// Purpose: connection test + structural inventory ONLY. It issues GET requests
// against the Pipedrive REST API v1, captures rate-limit headers, and writes a
// full JSON inventory to scripts/migration/output/ plus a concise stdout
// summary. It NEVER writes to Pipedrive and NEVER touches the GOS database.
//
// Auth: personal API token via the `api_token` query param (Pipedrive v1). The
// token is never logged — URLs are only ever printed by path, and lib.redact()
// scrubs any accidental leak.
//
// Run (see lib.failMissing for the exact commands):
//   node scripts/migration/pipedrive-audit.mjs
//
// Env: PIPEDRIVE_API_TOKEN, PIPEDRIVE_COMPANY_DOMAIN
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'pipedrive';
const REQUIRED = ['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN'];

const env = requireEnv(REQUIRED);
if (!env.ok) failMissing(env.missing, SYSTEM);

// Normalize the company domain: accept "grafitiyul", "grafitiyul.pipedrive.com",
// or a full URL, and reduce to the bare subdomain the API host needs.
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN)
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\.pipedrive\.com.*$/i, '')
  .replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const BASE = `https://${domain}.pipedrive.com/api/v1`;

// Build a URL with the token in the query string. NEVER pass the returned URL to
// a logger except via the `label` (which is the path only).
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
  await sleep(120); // gentle pacing — well under Pipedrive's burst limit
  return r;
}

// Split standard vs custom fields. Pipedrive custom fields carry edit_flag=true
// and a 40-hex key; standard fields do not. We record NAMES + TYPES only.
function summarizeFields(data) {
  const fields = Array.isArray(data?.data) ? data.data : [];
  const custom = fields.filter(
    (f) => f?.edit_flag === true || /^[0-9a-f]{40}$/.test(String(f?.key || '')),
  );
  const typeHist = {};
  for (const f of fields) typeHist[f.field_type] = (typeHist[f.field_type] || 0) + 1;
  return {
    total: fields.length,
    standard: fields.length - custom.length,
    custom: custom.length,
    typeHistogram: typeHist,
    customFields: custom.map((f) => ({ name: f.name, key: f.key, type: f.field_type })),
    // Enum/set option keys are structural (not customer data) — useful for
    // status/stage mapping later.
    optionSets: fields
      .filter((f) => Array.isArray(f.options) && f.options.length)
      .map((f) => ({ name: f.name, type: f.field_type, options: f.options.map((o) => o.label) })),
  };
}

async function main() {
  log(`[pipedrive] read-only audit — host ${domain}.pipedrive.com (API v1)`);
  const report = { system: SYSTEM, apiVersion: 'v1', host: `${domain}.pipedrive.com`, startedAt: new Date().toISOString() };

  // ── STEP 2: connection test ────────────────────────────────────────────────
  const me = await pd('/users/me');
  report.connection = {
    ok: me.ok,
    status: me.status,
    error: me.errorText,
  };
  if (!me.ok) {
    log(`[pipedrive] connection FAILED (HTTP ${me.status}). ${me.errorText || ''}`);
    report.rateLimit = lastRate;
    const p = writeOutput('pipedrive-audit.json', report);
    log(`[pipedrive] partial report → ${p}`);
    process.exit(1);
  }
  const u = me.json?.data || {};
  report.identity = {
    userName: u.name,
    userEmail: u.email ? '(present)' : null, // presence only, not the value
    companyId: u.company_id,
    companyName: u.company_name,
    companyDomain: u.company_domain,
    companyCountry: u.company_country,
    defaultCurrency: u.default_currency,
    isAdmin: u.is_admin === 1 || u.is_admin === true,
    // Effective access we can verify from the identity payload.
    access: Array.isArray(u.access) ? u.access.map((a) => ({ app: a.app, admin: a.admin })) : null,
  };
  log(`[pipedrive] connected as "${u.name}" @ ${u.company_name} (company ${u.company_id}); admin=${report.identity.isAdmin}`);

  // ── STEP 3: structure inventory ────────────────────────────────────────────
  const [pipelines, stages, dealF, personF, orgF, actF, actTypes] = await Promise.all([
    pd('/pipelines'),
    pd('/stages'),
    pd('/dealFields'),
    pd('/personFields'),
    pd('/organizationFields'),
    pd('/activityFields'),
    pd('/activityTypes'),
  ]);

  report.pipelines = (pipelines.json?.data || []).map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active_flag,
    dealProbability: p.deal_probability,
  }));
  report.stages = (stages.json?.data || []).map((s) => ({
    id: s.id,
    name: s.name,
    pipelineId: s.pipeline_id,
    order: s.order_nr,
    dealProbability: s.deal_probability,
    rottenFlag: s.rotten_flag,
  }));

  report.fields = {
    deal: summarizeFields(dealF.json),
    person: summarizeFields(personF.json),
    organization: summarizeFields(orgF.json),
    activity: summarizeFields(actF.json),
  };
  report.activityTypes = (actTypes.json?.data || []).map((t) => ({ id: t.id, name: t.name, keyString: t.key_string }));

  // Deal counts + status distribution via the summary endpoint (no paging).
  const summaries = {};
  for (const status of ['open', 'won', 'lost']) {
    const s = await pd('/deals/summary', { status });
    summaries[status] = s.json?.data?.total_count ?? null;
  }
  const summaryAll = await pd('/deals/summary');
  report.deals = {
    totalByStatus: summaries,
    totalCount: summaryAll.json?.data?.total_count ?? null,
    totalValueByCurrency: summaryAll.json?.data?.values_total ?? summaryAll.json?.data?.total_count ?? null,
    weightedValue: summaryAll.json?.data?.weighted_values_total ?? null,
  };

  // Cheap presence probes (limit=1) — availability + pagination hints, NOT a
  // full count. A precise count for persons/orgs/activities is an M1 counting
  // pass (deliberately not run here to stay read-minimal).
  async function probe(name, pathname, params = {}) {
    const r = await pd(pathname, { limit: 1, ...params });
    const items = r.json?.data;
    const pag = r.json?.additional_data?.pagination || null;
    return {
      accessible: r.ok,
      status: r.status,
      hasAtLeastOne: Array.isArray(items) && items.length > 0,
      moreItems: pag?.more_items_in_collection ?? null,
    };
  }
  report.probes = {
    persons: await probe('persons', '/persons'),
    organizations: await probe('organizations', '/organizations'),
    activities: await probe('activities', '/activities'),
    activitiesDone: await probe('activitiesDone', '/activities', { done: 1 }),
    activitiesUndone: await probe('activitiesUndone', '/activities', { done: 0 }),
    notes: await probe('notes', '/notes'),
    files: await probe('files', '/files'),
    products: await probe('products', '/products'),
    deals: await probe('deals', '/deals'),
  };

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();

  const outPath = writeOutput('pipedrive-audit.json', report);

  // ── Concise stdout summary ─────────────────────────────────────────────────
  log('\n──────── PIPEDRIVE SUMMARY ────────');
  log(`pipelines: ${report.pipelines.length} | stages: ${report.stages.length}`);
  log(`deal fields: ${report.fields.deal.total} (${report.fields.deal.custom} custom)`);
  log(`person fields: ${report.fields.person.total} (${report.fields.person.custom} custom)`);
  log(`org fields: ${report.fields.organization.total} (${report.fields.organization.custom} custom)`);
  log(`activity fields: ${report.fields.activity.total} (${report.fields.activity.custom} custom); activity types: ${report.activityTypes.length}`);
  log(`deals: total=${report.deals.totalCount} open=${summaries.open} won=${summaries.won} lost=${summaries.lost}`);
  log(`probes: persons=${report.probes.persons.accessible} orgs=${report.probes.organizations.accessible} notes=${report.probes.notes.accessible} files=${report.probes.files.accessible} products=${report.probes.products.accessible}`);
  log(`rate-limit headers: ${JSON.stringify(report.rateLimit)}`);
  log(`\nfull inventory → ${outPath}`);
}

main().catch((e) => {
  log(`[pipedrive] audit error: ${e?.message || e}`);
  process.exit(1);
});
