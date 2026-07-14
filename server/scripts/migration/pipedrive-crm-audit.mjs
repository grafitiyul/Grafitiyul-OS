// ONE-TIME, READ-ONLY Pipedrive CRM audit (M1): organizations (dedup + Unit
// candidates) and persons (per-field Hebrew/Latin name classification).
// GET only. No writes. Full JSON → output/pipedrive-crm-audit.json.
// The committed report shows AGGREGATES + a few samples; raw PII stays gitignored.
import { requireEnv, getJson, log, writeOutput, failMissing, sleep } from './lib.mjs';

const SYSTEM = 'pipedrive';
const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const BASE = `https://${domain}.pipedrive.com/api/v1`;
const ORG_TAXID = '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac'; // ח.פ/עוסק מורשה
const ORG_ICOUNT = 'b57596667582c03433c8f2d05d60ad0d8efba283'; // iCount_id

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
async function paginateAll(pathname, params = {}) {
  const rows = []; let start = 0;
  for (;;) {
    const r = await pd(pathname, { ...params, start, limit: 500 });
    if (!r.ok) throw new Error(`${pathname} HTTP ${r.status}`);
    rows.push(...(r.json?.data || []));
    const pag = r.json?.additional_data?.pagination;
    if (pag?.more_items_in_collection) start = pag.next_start; else break;
  }
  return rows;
}

// ── Script classifier: classify ONE name field independently ────────────────
const HEB = /[֐-׿]/;
const LAT = /[A-Za-z]/;
const DIGIT = /[0-9]/;
function classifyField(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return 'missing';
  const heb = HEB.test(v), lat = LAT.test(v);
  if (heb && lat) return 'mixed';
  if (heb) return 'hebrew';
  if (lat) return 'latin';
  if (DIGIT.test(v) || /[^\s]/.test(v)) return 'ambiguous'; // numeric/punct/other-script
  return 'ambiguous';
}
// Whitespace-only normalization audit: does trimming/collapsing change the value?
const needsWsNorm = (raw) => {
  const v = String(raw == null ? '' : raw);
  return v !== v.trim() || /\s{2,}/.test(v);
};

async function main() {
  log(`[pipedrive-crm] audit — host ${domain}.pipedrive.com`);
  const report = { system: SYSTEM, startedAt: new Date().toISOString() };

  // ── ORGANIZATIONS ───────────────────────────────────────────────────────────
  log('[pipedrive-crm] paginating organizations…');
  const orgs = await paginateAll('/organizations');
  report.organizations = { total: orgs.length };

  const normName = (n) => String(n || '').toLowerCase()
    .replace(/["'’`.,\-–_()|]/g, ' ')
    .replace(/\b(בע"?מ|בעמ|ltd|inc|llc|co|company|עמותה|בית ספר|ביה"?ס|עיריית|מועצה|חברת)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  const byName = {}, byTax = {}, byIcount = {};
  for (const o of orgs) {
    const nn = normName(o.name);
    if (nn) (byName[nn] = byName[nn] || []).push(o);
    const tax = String(o[ORG_TAXID] || '').replace(/\D/g, '');
    if (tax.length >= 8) (byTax[tax] = byTax[tax] || []).push(o);
    const ic = String(o[ORG_ICOUNT] || '').trim();
    if (ic) (byIcount[ic] = byIcount[ic] || []).push(o);
  }
  const clustersFrom = (idx, kind) => Object.entries(idx)
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ kind, key: kind === 'taxId' ? '<taxid>' : key, size: arr.length, members: arr.map((o) => ({ id: o.id, name: o.name, address: o.address || null })) }))
    .sort((a, b) => b.size - a.size);

  const taxClusters = clustersFrom(byTax, 'taxId');       // strongest signal
  const nameClusters = clustersFrom(byName, 'normName');  // needs review
  report.orgDedup = {
    exactTaxIdClusters: { count: taxClusters.length, orgsInvolved: taxClusters.reduce((n, c) => n + c.size, 0), top: taxClusters.slice(0, 15) },
    normalizedNameClusters: { count: nameClusters.length, orgsInvolved: nameClusters.reduce((n, c) => n + c.size, 0), top: nameClusters.slice(0, 20) },
    icountIdClusters: clustersFrom(byIcount, 'icountId').length,
    orgsWithTaxId: Object.values(byTax).reduce((n, a) => n + a.length, 0),
    orgsWithIcountId: Object.values(byIcount).reduce((n, a) => n + a.length, 0),
  };
  // Unit-candidate heuristic: a tax-id cluster whose member names share a prefix
  // but differ by suffix → one canonical Org + Units.
  report.unitCandidates = taxClusters.filter((c) => {
    const names = c.members.map((m) => normName(m.name));
    return new Set(names).size > 1; // same tax id, different names ⇒ likely branches
  }).slice(0, 15);

  // ── PERSONS: per-field name language classification ─────────────────────────
  log('[pipedrive-crm] paginating persons…');
  const persons = await paginateAll('/persons');
  report.persons = { total: persons.length };

  const cat = { bothHebrew: 0, bothLatin: 0, hebFirstLatinLast: 0, latinFirstHebLast: 0, mixedOrAmbiguous: 0, missingFirstOrLast: 0 };
  const examples = { bothHebrew: [], bothLatin: [], hebFirstLatinLast: [], latinFirstHebLast: [], mixedOrAmbiguous: [], missingFirstOrLast: [] };
  const fieldClass = { first: {}, last: {} };
  let wsNormFirst = 0, wsNormLast = 0;
  const pushEx = (bucket, f, l) => { if (examples[bucket].length < 5) examples[bucket].push(`${f || '∅'} | ${l || '∅'}`); };

  for (const p of persons) {
    const first = p.first_name, last = p.last_name;
    const cf = classifyField(first), cl = classifyField(last);
    fieldClass.first[cf] = (fieldClass.first[cf] || 0) + 1;
    fieldClass.last[cl] = (fieldClass.last[cl] || 0) + 1;
    if (needsWsNorm(first)) wsNormFirst++;
    if (needsWsNorm(last)) wsNormLast++;

    if (cf === 'missing' || cl === 'missing') { cat.missingFirstOrLast++; pushEx('missingFirstOrLast', first, last); continue; }
    if (cf === 'mixed' || cl === 'mixed' || cf === 'ambiguous' || cl === 'ambiguous') { cat.mixedOrAmbiguous++; pushEx('mixedOrAmbiguous', first, last); continue; }
    if (cf === 'hebrew' && cl === 'hebrew') { cat.bothHebrew++; pushEx('bothHebrew', first, last); }
    else if (cf === 'latin' && cl === 'latin') { cat.bothLatin++; pushEx('bothLatin', first, last); }
    else if (cf === 'hebrew' && cl === 'latin') { cat.hebFirstLatinLast++; pushEx('hebFirstLatinLast', first, last); }
    else if (cf === 'latin' && cl === 'hebrew') { cat.latinFirstHebLast++; pushEx('latinFirstHebLast', first, last); }
    else { cat.mixedOrAmbiguous++; pushEx('mixedOrAmbiguous', first, last); }
  }
  report.personNameClassification = {
    categories: cat,
    examples,
    perFieldScript: fieldClass,
    whitespaceNormalizationNeeded: { firstName: wsNormFirst, lastName: wsNormLast },
    gosTarget: 'Contact.firstNameHe/lastNameHe/firstNameEn/lastNameEn; ≥1 first name required; all stored non-null (empty ""), .trim() applied (src/routes/contacts.js)',
  };

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('pipedrive-crm-audit.json', report);

  log('\n──────── CRM AUDIT ────────');
  log(`organizations: ${orgs.length}`);
  log(`  tax-id clusters: ${report.orgDedup.exactTaxIdClusters.count} (orgs involved ${report.orgDedup.exactTaxIdClusters.orgsInvolved})`);
  log(`  normalized-name clusters: ${report.orgDedup.normalizedNameClusters.count} (orgs involved ${report.orgDedup.normalizedNameClusters.orgsInvolved})`);
  log(`  unit candidates (same tax id, diff names): ${report.unitCandidates.length}`);
  log(`persons: ${persons.length}`);
  log(`  name buckets: ${JSON.stringify(cat)}`);
  log(`  per-field first: ${JSON.stringify(fieldClass.first)}`);
  log(`  per-field last:  ${JSON.stringify(fieldClass.last)}`);
  log(`  whitespace-norm needed: first=${wsNormFirst} last=${wsNormLast}`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[pipedrive-crm] error: ${e?.message || e}`); process.exit(1); });
