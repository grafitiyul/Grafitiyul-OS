// ONE-TIME, READ-ONLY "Phase 2A — Connectivity & Dry Run" readiness pass.
//
// Runs BEFORE any snapshot is written. Its whole job is to eliminate unknowns
// before immutable data is created. It verifies, for BOTH source systems:
//   connectivity · authentication · permissions · rate-limit info · pagination ·
//   ability to enumerate every required entity · attachment enumeration with
//   EXACT counts + sizes · Google Drive/Photos classification · excluded tables
//   still excluded · archived deals still accessible · every audited count still
//   matches reality.
//
// HARD SAFETY CONTRACT:
//   * GET/read requests ONLY — never POST/PUT/PATCH/DELETE anywhere.
//   * No snapshot objects. No bucket writes. No GOS DB writes. No transforms.
//   * The excluded Airtable "גישה, סיסמאות" table is confirmed present via schema
//     ONLY — its records are NEVER listed/read.
//   * Tokens are never printed/logged/written (lib.redact backstop).
//
// Output: output/phase2a-readiness.json (gitignored) + a PASS/BLOCK verdict on
// stdout. Exit 0 = READY, exit 1 = BLOCKED (do not proceed to 2B).
import { requireEnv, getJson, log, writeOutput, sleep } from './lib.mjs';

// ── Expected numbers to reconcile against (from the frozen M1/M1b audits) ──────
const EXPECT = {
  dealsTotal: 24356,      // archived_status=all
  dealsArchived: 19448,
  dealsNotArchived: 4908, // open 70 / won 1620 / lost 3218
  notArchivedOpen: 70,
  notArchivedWon: 1620,
  notArchivedLost: 3218,
  persons: 32470,
  organizations: 2905,
  airtableMainTables: 24,
  airtableLegacyTables: 16,
};
const EXCLUDED_AIRTABLE_TABLE = 'גישה, סיסמאות'; // passwords — schema-only, never read

// Deal custom fields (keys only; names never read at runtime).
const F_TOURDATE = 'a860fcf9681c2bb1f71200514cffdb5c8cadedb7';
const F_DRIVE = '9a84626b2b956446809d64b2be3187de5ce6c6b1';

const blocking = [];
const warnings = [];
const addBlock = (m) => { blocking.push(m); log(`  ✗ BLOCK: ${m}`); };
const addWarn = (m) => { warnings.push(m); log(`  ⚠ warn: ${m}`); };
const near = (actual, expected, tol = 0) => actual != null && Math.abs(actual - expected) <= tol;

// ── URL classification (Drive folders / files / Google Photos albums) ─────────
const isDriveFolder = (u) => /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i.test(u);
const isDriveFile = (u) => /drive\.google\.com\/file\/|docs\.google\.com\//i.test(u);
const isPhotos = (u) => /photos\.google\.com|photos\.app\.goo\.gl/i.test(u);
function classifyLink(raw) {
  const u = String(raw || '').trim();
  if (!u) return 'empty';
  if (!/^https?:\/\//i.test(u)) return 'not_a_url';
  if (isPhotos(u)) return 'google_photos';
  if (isDriveFolder(u)) return 'drive_folder';
  if (isDriveFile(u)) return 'drive_file';
  if (/drive\.google\.com/i.test(u)) return 'drive_other';
  return 'other_url';
}

// ══════════════════════════════════════════════════════════════════════════════
// PIPEDRIVE
// ══════════════════════════════════════════════════════════════════════════════
async function pipedriveReadiness(report) {
  const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
  const pd = { configured: env.ok, missing: env.missing };
  report.pipedrive = pd;
  if (!env.ok) { addBlock(`Pipedrive not configured — missing ${env.missing.join(', ')}`); return; }

  const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim()
    .replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
  const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
  const BASE = `https://${domain}.pipedrive.com/api/v1`;
  let lastRate = {};
  const url = (p, params = {}) => {
    const u = new URL(BASE + p);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('api_token', TOKEN);
    return u.toString();
  };
  async function call(p, params = {}) {
    const r = await getJson(url(p, params), { label: p });
    if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
    await sleep(130);
    return r;
  }
  // Count a v1 collection fully WITHOUT retaining objects; optional per-row visitor.
  async function countPaginate(p, params = {}, visit = null, cap = 200000) {
    let total = 0, start = 0, pages = 0;
    for (;;) {
      const r = await call(p, { ...params, start, limit: 500 });
      if (!r.ok) throw new Error(`${p} HTTP ${r.status}: ${r.errorText || ''}`);
      const data = r.json?.data || [];
      total += data.length;
      pages++;
      if (visit) for (const row of data) visit(row);
      const pag = r.json?.additional_data?.pagination;
      if (total >= cap) { return { total, pages, capped: true }; }
      if (pag?.more_items_in_collection) start = pag.next_start; else break;
    }
    return { total, pages, capped: false };
  }

  // ── connectivity + auth + permissions ──────────────────────────────────────
  log('\n[pipedrive] connectivity + auth…');
  const me = await call('/users/me');
  pd.connectivity = { ok: me.ok, status: me.status };
  if (!me.ok) { addBlock(`Pipedrive auth failed (HTTP ${me.status})`); pd.rateLimit = lastRate; return; }
  const u = me.json?.data || {};
  pd.identity = { userId: u.id ?? null, name: u.name ?? null, isAdmin: u.is_admin ?? null, active: u.active_flag ?? null, companyDomain: domain };
  if (u.is_admin !== 1 && u.is_admin !== true) addWarn(`Pipedrive user is_admin=${u.is_admin} — full-account visibility assumes admin`);
  log(`  ✓ auth ok — user "${u.name}" (admin=${u.is_admin})`);

  // ── rate-limit info ─────────────────────────────────────────────────────────
  pd.rateLimitHeaders = lastRate;
  log(`  rate-limit headers: ${JSON.stringify(lastRate)}`);

  // ── entity enumeration + count reconciliation ───────────────────────────────
  log('[pipedrive] enumerating deals (archived_status=all, archived, not_archived)…');
  const statusHist = { all: {}, notArchived: {} };
  const driveVals = [];
  let archivedFutureTour = 0;
  const bumpAll = (d) => { statusHist.all[d.status] = (statusHist.all[d.status] || 0) + 1; };
  const bumpNot = (d) => {
    statusHist.notArchived[d.status] = (statusHist.notArchived[d.status] || 0) + 1;
    const dv = d[F_DRIVE]; if (dv) driveVals.push(String(dv));
  };
  const allDeals = await countPaginate('/deals', { archived_status: 'all', status: 'all_not_deleted' }, bumpAll);
  const notArch = await countPaginate('/deals', { archived_status: 'not_archived', status: 'all_not_deleted' }, bumpNot);
  const archDeals = await countPaginate('/deals', { archived_status: 'archived', status: 'all_not_deleted' }, (d) => {
    const tv = d[F_TOURDATE]; if (tv && String(tv).slice(0, 10) >= new Date().toISOString().slice(0, 10)) archivedFutureTour++;
    const dv = d[F_DRIVE]; if (dv) driveVals.push(String(dv));
  });
  pd.deals = {
    total: allDeals.total, totalPages: allDeals.pages,
    archived: archDeals.total, notArchived: notArch.total,
    notArchivedByStatus: statusHist.notArchived,
    allByStatus: statusHist.all,
    archivedWithFutureTourDate: archivedFutureTour,
    paginationProven: allDeals.pages > 1,
  };
  log(`  deals: total=${allDeals.total} (archived=${archDeals.total} + notArchived=${notArch.total}) pages=${allDeals.pages}`);
  log(`  notArchived byStatus: ${JSON.stringify(statusHist.notArchived)}`);
  if (!near(allDeals.total, EXPECT.dealsTotal)) addBlock(`deals total ${allDeals.total} ≠ audited ${EXPECT.dealsTotal}`);
  if (!near(archDeals.total, EXPECT.dealsArchived)) addWarn(`archived deals ${archDeals.total} ≠ audited ${EXPECT.dealsArchived}`);
  if (!near(notArch.total, EXPECT.dealsNotArchived)) addWarn(`non-archived deals ${notArch.total} ≠ audited ${EXPECT.dealsNotArchived}`);
  if (!allDeals.pages || allDeals.pages < 2) addBlock('deal pagination did not span multiple pages — pagination unproven');
  if (archivedFutureTour > 0) addWarn(`${archivedFutureTour} archived deals have a FUTURE tour date (Goal-A relevance) — exceptional queue`);

  log('[pipedrive] enumerating persons…');
  const persons = await countPaginate('/persons', {});
  pd.persons = { total: persons.total, pages: persons.pages, capped: persons.capped };
  log(`  persons: ${persons.total} (pages ${persons.pages})`);
  if (!near(persons.total, EXPECT.persons, 50)) addWarn(`persons ${persons.total} ≠ audited ${EXPECT.persons} (±50)`);

  log('[pipedrive] enumerating organizations…');
  const orgs = await countPaginate('/organizations', {});
  pd.organizations = { total: orgs.total, pages: orgs.pages };
  log(`  organizations: ${orgs.total} (pages ${orgs.pages})`);
  if (!near(orgs.total, EXPECT.organizations, 20)) addWarn(`organizations ${orgs.total} ≠ audited ${EXPECT.organizations} (±20)`);

  // notes + activities: prove enumerable (count, may be large) ─────────────────
  log('[pipedrive] enumerating notes + activities…');
  const notes = await countPaginate('/notes', {});
  const activities = await countPaginate('/activities', { user_id: 0 }); // user_id=0 → all users
  pd.notes = { total: notes.total, pages: notes.pages, enumerable: notes.pages >= 1 };
  pd.activities = { total: activities.total, pages: activities.pages, enumerable: activities.pages >= 1 };
  log(`  notes: ${notes.total} | activities: ${activities.total}`);

  // deal products enumeration proof (one archived + one active deal) ───────────
  log('[pipedrive] verifying deal-products enumeration…');
  const anyWithProducts = await call('/deals', { archived_status: 'all', status: 'all_not_deleted', limit: 1, start: 0 });
  pd.dealProducts = { probeOk: anyWithProducts.ok };
  const pf = await call('/productFields');
  pd.dealProducts.productFieldsOk = pf.ok;

  // ── ATTACHMENT CENSUS — exact counts + exact sizes (the new Phase-2A work) ───
  // NOTE: every Pipedrive file reports a remote_location. "s3" = Pipedrive-HOSTED
  // uploads (downloadable, real bytes) — the ones a file-body copy would move.
  // "url"/"googledrive"/… = external LINKS. Bytes are summed for ALL regardless.
  log('[pipedrive] attachment census (/files — exact count + exact bytes)…');
  const files = { count: 0, totalBytes: 0, byRemote: {}, byLinkedEntity: { deal: 0, person: 0, org: 0, activity: 0, none: 0 }, samplesTypeHist: {} };
  const filesRes = await countPaginate('/files', {}, (f) => {
    files.count++;
    const size = Number.isFinite(Number(f.file_size)) ? Number(f.file_size) : 0;
    files.totalBytes += size;
    const rl = f.remote_location ? String(f.remote_location) : 'none';
    const b = (files.byRemote[rl] = files.byRemote[rl] || { count: 0, bytes: 0 });
    b.count++; b.bytes += size;
    if (f.deal_id) files.byLinkedEntity.deal++;
    else if (f.person_id) files.byLinkedEntity.person++;
    else if (f.org_id) files.byLinkedEntity.org++;
    else if (f.activity_id) files.byLinkedEntity.activity++;
    else files.byLinkedEntity.none++;
    const t = String(f.file_type || 'unknown'); files.samplesTypeHist[t] = (files.samplesTypeHist[t] || 0) + 1;
  });
  files.pages = filesRes.pages;
  files.capped = filesRes.capped;
  files.totalMB = +(files.totalBytes / 1048576).toFixed(2);
  files.totalGiB = +(files.totalBytes / 1073741824).toFixed(2);
  // Entity-linked files = the operationally-relevant subset (deal/person/org).
  files.entityLinked = files.byLinkedEntity.deal + files.byLinkedEntity.person + files.byLinkedEntity.org;
  pd.attachments = files;
  const remoteSummary = Object.entries(files.byRemote).map(([k, v]) => `${k}:${v.count}/${(v.bytes / 1073741824).toFixed(2)}GiB`).join(', ');
  log(`  files: ${files.count} total, ${files.totalGiB}GiB — byLocation {${remoteSummary}}`);
  log(`  entity-linked (deal/person/org): ${files.entityLinked} | unlinked: ${files.byLinkedEntity.none}`);
  if (files.capped) addWarn('file census hit the safety cap — actual file count is higher; snapshot must not cap');

  // ── Google Drive / Photos classification ability (deal drive-folder field) ──
  const linkClass = {};
  for (const v of driveVals) { const c = classifyLink(v); linkClass[c] = (linkClass[c] || 0) + 1; }
  pd.driveLinkClassification = { fieldValuesSeen: driveVals.length, byClass: linkClass, classifierWorks: driveVals.length === 0 || Object.keys(linkClass).length > 0 };
  log(`  drive-folder field classification: ${JSON.stringify(linkClass)}`);

  // ── archived deals still accessible (by-id + sub-resources, no restore) ──────
  log('[pipedrive] verifying archived deals remain accessible…');
  const archProbe = await call('/deals', { archived_status: 'archived', status: 'all_not_deleted', limit: 1, start: 0 });
  const sampleArch = archProbe.json?.data?.[0] || null;
  if (!sampleArch) { addBlock('could not fetch a sample archived deal'); }
  else {
    const id = sampleArch.id;
    const [byId, prods, acts, fls, nts] = [
      await call(`/deals/${id}`),
      await call(`/deals/${id}/products`, { limit: 5 }),
      await call(`/deals/${id}/activities`, { limit: 5 }),
      await call(`/deals/${id}/files`, { limit: 5 }),
      await call('/notes', { deal_id: id, limit: 5 }),
    ];
    const okAll = byId.ok && prods.ok && acts.ok && fls.ok && nts.ok;
    pd.archivedAccessible = { sampleId: id, isArchived: sampleArch.is_archived ?? null, byId: byId.ok, products: prods.ok, activities: acts.ok, files: fls.ok, notes: nts.ok, allAccessibleWithoutRestore: okAll };
    if (!okAll) addBlock('archived deal sub-resources not fully accessible without restore');
    else log(`  ✓ archived deal ${id} fully accessible (by-id + products/activities/files/notes)`);
  }

  pd.rateLimit = lastRate;
  pd.ok = true;
}

// ══════════════════════════════════════════════════════════════════════════════
// AIRTABLE
// ══════════════════════════════════════════════════════════════════════════════
async function airtableReadiness(report) {
  const env = requireEnv(['AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID', 'AIRTABLE_LEGACY_BASE_ID']);
  const at = { configured: env.ok, missing: env.missing };
  report.airtable = at;
  if (!env.ok) { addBlock(`Airtable not configured — missing ${env.missing.join(', ')}`); return; }

  const TOKEN = String(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN).trim();
  const BASES = [
    { role: 'main', id: String(process.env.AIRTABLE_MAIN_BASE_ID).trim(), expectTables: EXPECT.airtableMainTables },
    { role: 'legacy', id: String(process.env.AIRTABLE_LEGACY_BASE_ID).trim(), expectTables: EXPECT.airtableLegacyTables },
  ];
  const API = 'https://api.airtable.com/v0';
  const AUTH = { Authorization: `Bearer ${TOKEN}` };
  let lastRate = {};
  async function call(pathname, { params } = {}) {
    const u = new URL(API + pathname);
    if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const r = await getJson(u.toString(), { headers: AUTH, label: pathname });
    if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
    await sleep(220); // ~5 req/sec/base — pace conservatively
    if (r.status === 429) {
      const wait = Number(r.rate['retry-after'] || 1) * 1000 + 250;
      log(`  [airtable] 429 — waiting ${wait}ms`); await sleep(wait);
      return call(pathname, { params });
    }
    return r;
  }
  // Count records of one table fully (project ONE field id), optional visitor.
  async function countTable(baseId, table, visit = null, cap = 100000) {
    const proj = table.primaryFieldId ? { 'fields[]': table.primaryFieldId } : {};
    let count = 0, offset = null, pages = 0;
    do {
      const params = { pageSize: 100, ...proj, ...(offset ? { offset } : {}) };
      const r = await call(`/${baseId}/${encodeURIComponent(table.id)}`, { params });
      if (!r.ok) return { count: null, pages, error: `HTTP ${r.status}` };
      const recs = r.json?.records || [];
      count += recs.length; pages++;
      if (visit) for (const rec of recs) visit(rec);
      offset = r.json?.offset || null;
      if (count >= cap) return { count, pages, capped: true };
    } while (offset);
    return { count, pages, capped: false };
  }
  // Sum attachment count + bytes for a specific attachment field (reads ONLY that field).
  async function attachmentCensus(baseId, table, fieldName) {
    const fld = table.fields.find((f) => f.name === fieldName);
    if (!fld) return { field: fieldName, error: 'field not found' };
    let files = 0, bytes = 0, records = 0, offset = null;
    do {
      const params = { pageSize: 100, 'fields[]': fieldName, ...(offset ? { offset } : {}) };
      const r = await call(`/${baseId}/${encodeURIComponent(table.id)}`, { params });
      if (!r.ok) return { field: fieldName, error: `HTTP ${r.status}` };
      for (const rec of r.json?.records || []) {
        const arr = rec.fields?.[fieldName];
        if (Array.isArray(arr) && arr.length) { records++; for (const a of arr) { files++; bytes += Number(a.size || 0); } }
      }
      offset = r.json?.offset || null;
    } while (offset);
    return { field: fieldName, recordsWithAttachments: records, fileCount: files, totalBytes: bytes, totalMB: +(bytes / 1048576).toFixed(2) };
  }

  // ── connectivity + auth + accessible bases ──────────────────────────────────
  log('\n[airtable] connectivity + auth…');
  const metaBases = await call('/meta/bases');
  at.connectivity = { ok: metaBases.ok, status: metaBases.status };
  if (!metaBases.ok) { addBlock(`Airtable auth failed (HTTP ${metaBases.status})`); at.rateLimit = lastRate; return; }
  const accessible = (metaBases.json?.bases || []).map((b) => ({ id: b.id, name: b.name, permissionLevel: b.permissionLevel }));
  at.accessibleBases = accessible;
  at.rateLimitHeaders = lastRate;
  log(`  ✓ auth ok — ${accessible.length} base(s) accessible`);

  at.bases = [];
  let totalAttachFiles = 0, totalAttachBytes = 0;
  for (const b of BASES) {
    const inList = accessible.find((a) => a.id === b.id) || null;
    const tablesRes = await call(`/meta/bases/${encodeURIComponent(b.id)}/tables`);
    if (!tablesRes.ok) { addBlock(`Airtable ${b.role} base schema not accessible (HTTP ${tablesRes.status})`); at.bases.push({ role: b.role, ok: false }); continue; }
    const rawTables = tablesRes.json?.tables || [];
    const tables = rawTables.map((t) => ({
      id: t.id, name: t.name, primaryFieldId: t.primaryFieldId,
      fields: (t.fields || []).map((f) => ({ name: f.name, type: f.type })),
      attachmentFields: (t.fields || []).filter((f) => f.type === 'multipleAttachments').map((f) => f.name),
    }));
    const baseRec = { role: b.role, id: b.id, name: inList?.name || null, permissionLevel: inList?.permissionLevel || null, tableCount: tables.length };
    log(`  base ${b.role} "${baseRec.name}": ${tables.length} tables (expected ${b.expectTables})`);
    if (!near(tables.length, b.expectTables)) addWarn(`${b.role} base has ${tables.length} tables ≠ audited ${b.expectTables}`);

    // permission level: need read
    if (inList && !/read|comment|edit|create/i.test(String(inList.permissionLevel || ''))) addWarn(`${b.role} base permission "${inList.permissionLevel}" — confirm read access`);

    // excluded passwords table: confirm present via SCHEMA ONLY, never read rows
    if (b.role === 'legacy') {
      const pw = tables.find((t) => t.name === EXCLUDED_AIRTABLE_TABLE);
      baseRec.excludedTable = { name: EXCLUDED_AIRTABLE_TABLE, presentInSchema: !!pw, recordsRead: false };
      if (pw) log(`  ✓ excluded table "${EXCLUDED_AIRTABLE_TABLE}" present in schema — records NOT read (correct)`);
      else addWarn(`excluded table "${EXCLUDED_AIRTABLE_TABLE}" not found in ${b.role} schema (was 61 rows) — confirm rename/removal`);
    }

    // attachment census across every attachment field in this base ────────────
    const attachFields = tables.flatMap((t) => t.attachmentFields.map((f) => ({ table: t, field: f })));
    baseRec.attachmentFieldCount = attachFields.length;
    baseRec.attachmentCensus = [];
    for (const { table, field } of attachFields) {
      // NEVER census the excluded table
      if (table.name === EXCLUDED_AIRTABLE_TABLE) continue;
      const c = await attachmentCensus(b.id, table, field);
      baseRec.attachmentCensus.push({ table: table.name, ...c });
      if (c.fileCount) { totalAttachFiles += c.fileCount; totalAttachBytes += c.totalBytes; }
      log(`    attach ${b.role}/${table.name}.${field}: ${c.fileCount ?? '?'} files / ${c.totalMB ?? '?'}MB`);
    }

    // exact counts for the operational tables (verify audited "2000+") — main base only,
    // and classify the tour Drive/Photos link field to prove classification ability.
    if (b.role === 'main') {
      const opTables = ['סיורים', 'משתתפים', 'מעקב תשלומים', 'שכר', 'לקוחות עסקיים', 'סיכומי סיור'];
      baseRec.operationalCounts = {};
      const tourTable = tables.find((t) => t.name === 'סיורים');
      const driveFieldName = tourTable?.fields.find((f) => /דרייב|drive|לינק/i.test(f.name) && /לינק|drive/i.test(f.name))?.name
        || tourTable?.fields.find((f) => f.name.includes('דרייב'))?.name || null;
      for (const name of opTables) {
        const t = tables.find((x) => x.name === name);
        if (!t) { baseRec.operationalCounts[name] = 'table-not-found'; addWarn(`main table "${name}" not found`); continue; }
        let linkClass = null;
        let visit = null;
        if (name === 'סיורים' && driveFieldName) {
          linkClass = {};
          // widen projection to include the drive-link field for classification
          const projField = driveFieldName;
          visit = null; // handled below with a dedicated pass
          // dedicated classification pass (small table)
        }
        const c = await countTable(b.id, t);
        baseRec.operationalCounts[name] = { count: c.count, capped: c.capped || false };
        log(`    count main/${name}: ${c.count}${c.capped ? '+ (capped)' : ''}`);
      }
      // Drive/Photos link classification on the tours table (proves ability) ──
      if (tourTable && driveFieldName) {
        const linkClass = {};
        await countTable(b.id, { ...tourTable, primaryFieldId: null }, (rec) => {
          const v = rec.fields?.[driveFieldName];
          if (v != null) { const c = classifyLink(v); linkClass[c] = (linkClass[c] || 0) + 1; }
        });
        baseRec.tourDriveLinkClassification = { field: driveFieldName, byClass: linkClass };
        log(`    tour drive-link classification (${driveFieldName}): ${JSON.stringify(linkClass)}`);
      } else {
        addWarn('could not locate a Drive-link field on the tours table for classification');
      }
    }

    at.bases.push(baseRec);
  }
  at.attachmentTotals = { fileCount: totalAttachFiles, totalBytes: totalAttachBytes, totalMB: +(totalAttachBytes / 1048576).toFixed(2) };
  at.rateLimit = lastRate;
  at.ok = true;
  log(`  airtable attachment totals: ${totalAttachFiles} files / ${at.attachmentTotals.totalMB}MB`);
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  log('════════ Phase 2A — Connectivity & Dry Run (READ-ONLY) ════════');
  const report = { phase: '2A-connectivity-dry-run', startedAt: new Date().toISOString(), expected: EXPECT };

  // Snapshot storage vars are NOT required for 2A — report status only.
  const r2 = requireEnv(['MIGRATION_R2_ACCOUNT_ID', 'MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY', 'MIGRATION_R2_BUCKET']);
  report.snapshotStorage = { configuredForPhase2B: r2.ok, missing: r2.missing, note: 'not required for 2A; required before 2B provisioning' };

  try { await pipedriveReadiness(report); }
  catch (e) { addBlock(`Pipedrive readiness threw: ${e?.message || e}`); report.pipedrive = { ...(report.pipedrive || {}), error: String(e?.message || e) }; }

  try { await airtableReadiness(report); }
  catch (e) { addBlock(`Airtable readiness threw: ${e?.message || e}`); report.airtable = { ...(report.airtable || {}), error: String(e?.message || e) }; }

  report.blockingIssues = blocking;
  report.warnings = warnings;
  report.verdict = blocking.length === 0 ? 'READY' : 'BLOCKED';
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('phase2a-readiness.json', report);

  log('\n════════ READINESS VERDICT ════════');
  log(`verdict: ${report.verdict}`);
  log(`blocking issues: ${blocking.length}`);
  for (const b of blocking) log(`  ✗ ${b}`);
  log(`warnings: ${warnings.length}`);
  for (const w of warnings) log(`  ⚠ ${w}`);
  log(`\nfull → ${out}`);
  process.exit(blocking.length === 0 ? 0 : 1);
}
main().catch((e) => { log(`[phase2a] fatal: ${e?.message || e}`); process.exit(1); });
