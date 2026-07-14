// ONE-TIME, READ-ONLY Airtable migration audit.
//
// Purpose: connection test + schema inventory for BOTH configured bases (main +
// legacy). GET requests only, against the Airtable Meta API and (optionally) a
// bounded record-count pass. Writes a full JSON inventory to
// scripts/migration/output/ plus a concise stdout summary. NEVER writes to
// Airtable and NEVER touches the GOS database.
//
// Auth: Personal Access Token via Bearer header (API keys are deprecated).
// Required PAT scopes: schema.bases:read (metadata) + data.records:read (counts).
// The token is never logged.
//
// Run:
//   node scripts/migration/airtable-audit.mjs            # schema only (fast)
//   node scripts/migration/airtable-audit.mjs --counts   # + bounded record counts
//
// Env: AIRTABLE_PERSONAL_ACCESS_TOKEN, AIRTABLE_MAIN_BASE_ID, AIRTABLE_LEGACY_BASE_ID
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'airtable';
const REQUIRED = ['AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID', 'AIRTABLE_LEGACY_BASE_ID'];

const env = requireEnv(REQUIRED);
if (!env.ok) failMissing(env.missing, SYSTEM);

const TOKEN = String(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN).trim();
const BASES = [
  { role: 'main', id: String(process.env.AIRTABLE_MAIN_BASE_ID).trim() },
  { role: 'legacy', id: String(process.env.AIRTABLE_LEGACY_BASE_ID).trim() },
];
const API = 'https://api.airtable.com/v0';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const WANT_COUNTS = process.argv.includes('--counts');
const COUNT_CAP = 2000; // bounded — never a full extraction

let lastRate = {};
async function at(pathname, { params } = {}) {
  const u = new URL(API + pathname);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await getJson(u.toString(), { headers: AUTH, label: pathname });
  if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
  // Airtable allows ~5 req/sec/base; pace conservatively.
  await sleep(220);
  if (r.status === 429) {
    const wait = Number(r.rate['retry-after'] || 1) * 1000 + 250;
    log(`[airtable] 429 rate-limited on ${pathname} — waiting ${wait}ms`);
    await sleep(wait);
    return at(pathname, { params });
  }
  return r;
}

// Classify a table's fields into the categories Step 3 asks about.
function summarizeTable(t) {
  const fields = Array.isArray(t.fields) ? t.fields : [];
  const typeHist = {};
  const linked = [];
  const formulas = [];
  const rollups = [];
  const lookups = [];
  const attachments = [];
  for (const f of fields) {
    typeHist[f.type] = (typeHist[f.type] || 0) + 1;
    if (f.type === 'multipleRecordLinks') {
      linked.push({
        field: f.name,
        linkedTableId: f.options?.linkedTableId || null,
        prefersSingle: f.options?.prefersSingleRecordLink || false,
        symmetric: f.options?.inverseLinkFieldId ? true : false,
      });
    } else if (f.type === 'formula') {
      formulas.push({ field: f.name, resultType: f.options?.result?.type || null });
    } else if (f.type === 'rollup') {
      rollups.push({ field: f.name });
    } else if (f.type === 'multipleLookupValues') {
      lookups.push({ field: f.name });
    } else if (f.type === 'multipleAttachments') {
      attachments.push({ field: f.name });
    }
  }
  return {
    id: t.id,
    name: t.name,
    primaryFieldId: t.primaryFieldId,
    fieldCount: fields.length,
    typeHistogram: typeHist,
    fields: fields.map((f) => ({ name: f.name, type: f.type })), // NAMES + TYPES only
    linkedRecordFields: linked,
    formulaFields: formulas,
    rollupFields: rollups,
    lookupFields: lookups,
    attachmentFields: attachments,
    views: (t.views || []).map((v) => ({ name: v.name, type: v.type })),
  };
}

// Bounded record count: page with a tiny field projection, capped at COUNT_CAP.
// Returns { count, capped }. NEVER a full extraction of data.
async function boundedCount(baseId, table) {
  const projection = table.primaryFieldId ? { 'fields[]': table.primaryFieldId } : {};
  let count = 0;
  let offset = null;
  do {
    const params = { pageSize: 100, ...projection, ...(offset ? { offset } : {}) };
    const r = await at(`/${baseId}/${encodeURIComponent(table.id)}`, { params });
    if (!r.ok) return { count: null, capped: false, error: `HTTP ${r.status}` };
    const recs = r.json?.records || [];
    count += recs.length;
    offset = r.json?.offset || null;
    if (count >= COUNT_CAP) return { count, capped: true };
  } while (offset);
  return { count, capped: false };
}

async function main() {
  log(`[airtable] read-only audit — Meta API${WANT_COUNTS ? ' + bounded counts' : ' (schema only)'}`);
  const report = { system: SYSTEM, startedAt: new Date().toISOString(), countsRequested: WANT_COUNTS };

  // ── STEP 2: connection test + list accessible bases ────────────────────────
  const metaBases = await at('/meta/bases');
  report.connection = { ok: metaBases.ok, status: metaBases.status, error: metaBases.errorText };
  if (!metaBases.ok) {
    log(`[airtable] connection FAILED (HTTP ${metaBases.status}). ${metaBases.errorText || ''}`);
    report.rateLimit = lastRate;
    const p = writeOutput('airtable-audit.json', report);
    log(`[airtable] partial report → ${p}`);
    process.exit(1);
  }
  const accessible = (metaBases.json?.bases || []).map((b) => ({ id: b.id, name: b.name, permissionLevel: b.permissionLevel }));
  report.accessibleBases = accessible;
  log(`[airtable] connected — ${accessible.length} base(s) accessible to this PAT`);

  // Validate the two configured base IDs (match against the accessible list AND
  // confirm direct schema access). Base identity is confirmed by name.
  report.configuredBases = [];
  for (const b of BASES) {
    const inList = accessible.find((a) => a.id === b.id) || null;
    const tablesRes = await at(`/meta/bases/${encodeURIComponent(b.id)}/tables`);
    const ok = tablesRes.ok;
    const tables = ok ? (tablesRes.json?.tables || []).map(summarizeTable) : [];
    report.configuredBases.push({
      role: b.role,
      id: b.id,
      inAccessibleList: !!inList,
      name: inList?.name || null,
      permissionLevel: inList?.permissionLevel || null,
      schemaAccessible: ok,
      schemaError: ok ? null : `HTTP ${tablesRes.status} ${tablesRes.errorText || ''}`,
      tableCount: tables.length,
      tables,
    });
    log(`[airtable] base ${b.role} (${b.id}): ${ok ? `OK — "${inList?.name || '?'}", ${tables.length} tables` : `NOT accessible (HTTP ${tablesRes.status})`}`);
  }

  // ── STEP 3 (optional): bounded record counts ───────────────────────────────
  if (WANT_COUNTS) {
    for (const base of report.configuredBases) {
      if (!base.schemaAccessible) continue;
      for (const t of base.tables) {
        const c = await boundedCount(base.id, t);
        t.recordCount = c.count;
        t.recordCountCapped = c.capped || false;
        if (c.error) t.recordCountError = c.error;
        log(`[airtable]   ${base.role}/${t.name}: ${c.count == null ? 'count failed' : c.count}${c.capped ? '+ (capped)' : ''}`);
      }
    }
  }

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const outPath = writeOutput('airtable-audit.json', report);

  // ── Concise stdout summary ─────────────────────────────────────────────────
  log('\n──────── AIRTABLE SUMMARY ────────');
  for (const base of report.configuredBases) {
    const linkedTotal = base.tables.reduce((n, t) => n + t.linkedRecordFields.length, 0);
    const attachTotal = base.tables.reduce((n, t) => n + t.attachmentFields.length, 0);
    const formulaTotal = base.tables.reduce((n, t) => n + t.formulaFields.length + t.rollupFields.length + t.lookupFields.length, 0);
    log(`${base.role}: "${base.name || '?'}" — ${base.tableCount} tables, ${linkedTotal} linked-record fields, ${attachTotal} attachment fields, ${formulaTotal} formula/rollup/lookup fields`);
  }
  log(`rate-limit headers: ${JSON.stringify(report.rateLimit)}`);
  log(`\nfull inventory → ${outPath}`);
}

main().catch((e) => {
  log(`[airtable] audit error: ${e?.message || e}`);
  process.exit(1);
});
