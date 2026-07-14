// ONE-TIME, READ-ONLY Airtable TOURS audit (M1): future-tour detection, the
// Deal↔Tour linkage completeness (פייפ דיל ID coverage), and Google-Drive
// folder-link inventory. GET only. No writes, no downloads of Drive content.
// Full JSON → output/airtable-tours-audit.json.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'airtable';
const env = requireEnv(['AIRTABLE_PERSONAL_ACCESS_TOKEN', 'AIRTABLE_MAIN_BASE_ID']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const TOKEN = String(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN).trim();
const BASE_ID = String(process.env.AIRTABLE_MAIN_BASE_ID).trim();
const API = 'https://api.airtable.com/v0';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const TOURS = 'tblTI7iaGm6qsQA4a';
const TODAY = new Date().toISOString().slice(0, 10);

const FIELDS = ['ת.סיור', 'סטטוס', 'לינק לתיקייה בדרייב', 'מזהה תיקייה בדרייב', 'Pipedrive', 'פייפ דיל ID (from משתתפים)', 'מזהה ארוע ביומן', 'link for calendar event'];

let lastRate = {};
async function at(pathname, params = {}) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, String(v));
  }
  const r = await getJson(u.toString(), { headers: AUTH, label: pathname });
  if (r.rate && Object.keys(r.rate).length) lastRate = r.rate;
  await sleep(230);
  if (r.status === 429) { await sleep(1500); return at(pathname, params); }
  return r;
}
// Page a table with a formula + field projection, capped.
async function pageRecords(formula, cap = 5000) {
  const rows = []; let offset = null;
  do {
    const params = { pageSize: 100, 'fields[]': FIELDS, ...(formula ? { filterByFormula: formula } : {}), ...(offset ? { offset } : {}) };
    const r = await at(`/${BASE_ID}/${TOURS}`, params);
    if (!r.ok) throw new Error(`tours HTTP ${r.status}: ${r.errorText || ''}`);
    rows.push(...(r.json?.records || []));
    offset = r.json?.offset || null;
  } while (offset && rows.length < cap);
  return rows;
}

const firstVal = (v) => Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const isFolder = (u) => /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i.test(String(u));
const isFile = (u) => /drive\.google\.com\/file\/|docs\.google\.com\//i.test(String(u));

async function main() {
  log(`[airtable-tours] audit — base ${BASE_ID} (today=${TODAY})`);
  const report = { system: SYSTEM, base: BASE_ID, today: TODAY, startedAt: new Date().toISOString() };

  // ── Future tours (server-side date filter) ──────────────────────────────────
  log('[airtable-tours] fetching FUTURE tours (ת.סיור >= today)…');
  const future = await pageRecords(`IS_AFTER({ת.סיור}, DATEADD(TODAY(), -1, 'days'))`);
  let withPipeId = 0, withDrive = 0, withCal = 0, cancelled = 0;
  for (const rec of future) {
    const f = rec.fields || {};
    const pipeId = firstVal(f['פייפ דיל ID (from משתתפים)']) ?? firstVal(f['Pipedrive']);
    if (pipeId) withPipeId++;
    if (f['לינק לתיקייה בדרייב']) withDrive++;
    if (f['מזהה ארוע ביומן'] || f['link for calendar event']) withCal++;
    if (/בוט|cancel|ביטול/i.test(String(f['סטטוס'] || ''))) cancelled++;
  }
  report.futureTours = {
    count: future.length,
    withPipedriveDealId: withPipeId,
    withoutPipedriveDealId: future.length - withPipeId,
    withDriveFolderLink: withDrive,
    withCalendarEventId: withCal,
    cancelledLike: cancelled,
    linkageCoveragePct: future.length ? Math.round((withPipeId / future.length) * 100) : null,
  };

  // ── Drive-link inventory over a bounded sample of ALL tours ─────────────────
  log('[airtable-tours] sampling tours for Drive-link inventory…');
  const sample = await pageRecords(null, 3000);
  const links = sample.map((r) => r.fields?.['לינק לתיקייה בדרייב']).filter(Boolean).map(String);
  const folderIds = sample.map((r) => r.fields?.['מזהה תיקייה בדרייב']).filter(Boolean).map(String);
  const dupes = {}; for (const v of links) dupes[v] = (dupes[v] || 0) + 1;
  report.driveLinks = {
    sampledTours: sample.length,
    fieldUrl: 'לינק לתיקייה בדרייב (url)',
    fieldId: 'מזהה תיקייה בדרייב (singleLineText)',
    toursWithLinkUrl: links.length,
    toursWithFolderId: folderIds.length,
    lookLikeFolder: links.filter(isFolder).length,
    lookLikeFile: links.filter(isFile).length,
    other_or_malformed: links.filter((v) => !isFolder(v) && !isFile(v)).length,
    duplicateLinkValues: Object.values(dupes).filter((n) => n > 1).length,
    sampleShapes: [...new Set(links.slice(0, 3000).map((v) => v.replace(/[A-Za-z0-9_-]{15,}/g, '<ID>').slice(0, 60)))].slice(0, 8),
  };

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('airtable-tours-audit.json', report);

  log('\n──────── AIRTABLE TOURS AUDIT ────────');
  log(`future tours: ${JSON.stringify(report.futureTours)}`);
  log(`drive links: ${JSON.stringify(report.driveLinks)}`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[airtable-tours] error: ${e?.message || e}`); process.exit(1); });
