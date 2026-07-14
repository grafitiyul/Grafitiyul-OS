// ONE-TIME, READ-ONLY Pipedrive PRICING-TEXT audit (M1b).
//
// Locates exactly WHERE the human explanatory wording of pricing lines lives
// (e.g. "עד 10 משתתפים - 1900 ש\"ח"): line comments, line/product names, deal
// quote-notes custom field, deal notes, product-catalog descriptions — and
// measures structured-field completeness (qty/price/sum/discount/tax) plus
// qty×price≠sum mismatches (evidence of package semantics living in the text).
//
// Samples ARCHIVED and non-archived deals with products, stratified across the
// id range (eras). GET only. Full JSON → output/pipedrive-pricing-text-audit.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requireEnv, getJson, log, writeOutput, failMissing, sleep, OUTPUT_DIR } from './lib.mjs';

const SYSTEM = 'pipedrive';
const env = requireEnv(['PIPEDRIVE_API_TOKEN', 'PIPEDRIVE_COMPANY_DOMAIN']);
if (!env.ok) failMissing(env.missing, SYSTEM);

const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/i, '').replace(/\/.*$/, '');
const TOKEN = String(process.env.PIPEDRIVE_API_TOKEN).trim();
const HOST = `https://${domain}.pipedrive.com`;
const F_QUOTE_NOTES = 'הערות להצעת מחיר'; // resolved to a key at runtime from the field audit

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
  await sleep(140);
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
// Evenly-spaced sample of n items from a sorted array.
const stratified = (arr, n) => {
  if (arr.length <= n) return arr;
  const out = []; const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
};
const WORDING = /עד|משתתפ|כולל|מינימום|לקבוצה|ש"ח|₪|per|min|group|participants|up to/i;

async function main() {
  log(`[pricing-text] audit — host ${domain}.pipedrive.com`);
  const report = { system: SYSTEM, startedAt: new Date().toISOString() };

  // Resolve the quote-notes custom-field key from the earlier field audit.
  let quoteNotesKey = null;
  try {
    const audit = JSON.parse(readFileSync(path.join(OUTPUT_DIR, 'pipedrive-audit.json'), 'utf8'));
    quoteNotesKey = (audit.fields?.deal?.customFields || []).find((f) => f.name === F_QUOTE_NOTES)?.key || null;
  } catch { /* field audit output not present — skip that check */ }

  // ── Build the deal sample: non-archived + archived, products_count>0 ────────
  log('[pricing-text] listing deals (both archive states)…');
  const nonArch = await paginateV1('/api/v1/deals', { status: 'all_not_deleted', archived_status: 'not_archived' });
  const arch = await paginateV1('/api/v1/deals', { status: 'all_not_deleted', archived_status: 'archived' });

  const quoteNotesNonEmpty = quoteNotesKey
    ? [...nonArch, ...arch].filter((d) => String(d[quoteNotesKey] || '').trim()).length
    : null;

  const withProd = (rows) => rows.filter((d) => (d.products_count || 0) > 0).sort((a, b) => a.id - b.id);
  const sampleActive = stratified(withProd(nonArch), 90);
  const sampleArch = stratified(withProd(arch), 90);
  report.population = {
    nonArchived: nonArch.length, archived: arch.length,
    nonArchivedWithProducts: withProd(nonArch).length, archivedWithProducts: withProd(arch).length,
    sampledActive: sampleActive.length, sampledArchived: sampleArch.length,
    dealQuoteNotesFieldKeyFound: !!quoteNotesKey,
    dealsWithQuoteNotesText: quoteNotesNonEmpty,
  };

  // ── Pull product lines for the sample ───────────────────────────────────────
  const lines = [];
  for (const d of [...sampleActive, ...sampleArch]) {
    const r = await call(`/api/v1/deals/${d.id}/products`, { limit: 100 });
    let order = 0;
    for (const li of r.json?.data || []) {
      order += 1;
      lines.push({
        dealId: d.id, archived: !!d.is_archived, order,
        name: li.name ?? null,
        quantity: li.quantity ?? null,
        item_price: li.item_price ?? null,
        sum: li.sum ?? null,
        discount: li.discount ?? li.discount_percentage ?? null,
        currency: li.currency ?? null,
        tax: li.tax ?? null,
        tax_method: li.tax_method ?? null,
        comments: li.comments ?? null,
      });
    }
  }
  const nn = (f) => lines.filter((l) => l[f] != null && l[f] !== '').length;
  const withComments = lines.filter((l) => String(l.comments || '').trim());
  const commentsWording = withComments.filter((l) => WORDING.test(l.comments));
  const nameWording = lines.filter((l) => WORDING.test(String(l.name || '')));
  const mismatch = lines.filter((l) => l.quantity != null && l.item_price != null && l.sum != null
    && Math.abs(l.quantity * l.item_price - l.sum) > 0.5
    && !(l.discount > 0));
  report.lineAnalysis = {
    sampledLines: lines.length,
    structured: {
      name: nn('name'), quantity: nn('quantity'), unitPrice: nn('item_price'), lineTotal: nn('sum'),
      discount: lines.filter((l) => l.discount > 0).length, currency: nn('currency'),
      tax: nn('tax'), taxMethodPresent: nn('tax_method'), orderingPreserved: true,
    },
    text: {
      linesWithComments: withComments.length,
      commentsPctOfLines: lines.length ? Math.round((withComments.length / lines.length) * 100) : null,
      commentsWithPricingWording: commentsWording.length,
      namesWithPricingWording: nameWording.length,
      commentExamples: withComments.slice(0, 8).map((l) => String(l.comments).replace(/\s+/g, ' ').slice(0, 90)),
      nameExamples: nameWording.slice(0, 8).map((l) => String(l.name).replace(/\s+/g, ' ').slice(0, 90)),
    },
    qtyTimesPriceNeqSum_noDiscount: mismatch.length,
    mismatchExamples: mismatch.slice(0, 5).map((l) => ({ qty: l.quantity, unit: l.item_price, sum: l.sum, name: String(l.name || '').slice(0, 50) })),
  };

  // ── Product catalog descriptions ────────────────────────────────────────────
  const prods = await call('/api/v1/products', { limit: 500 });
  const pRows = prods.json?.data || [];
  report.productCatalog = {
    firstPageCount: pRows.length,
    withDescription: pRows.filter((p) => String(p.description || '').trim()).length,
    descriptionsWithWording: pRows.filter((p) => WORDING.test(String(p.description || ''))).length,
  };

  // ── Deal-notes sample: does pricing wording live in notes too? ──────────────
  const noteSampleDeals = stratified(withProd(nonArch), 15);
  let notesChecked = 0, notesWithWording = 0;
  for (const d of noteSampleDeals) {
    const r = await call('/api/v1/notes', { deal_id: d.id, limit: 25 });
    for (const n of r.json?.data || []) {
      notesChecked++;
      if (WORDING.test(String(n.content || ''))) notesWithWording++;
    }
  }
  report.dealNotesSample = { dealsSampled: noteSampleDeals.length, notesChecked, notesWithPricingWording: notesWithWording };

  report.rateLimit = lastRate;
  report.finishedAt = new Date().toISOString();
  const out = writeOutput('pipedrive-pricing-text-audit.json', report);

  log('\n──────── PRICING TEXT AUDIT ────────');
  log(`population: ${JSON.stringify(report.population)}`);
  log(`lines sampled: ${lines.length}`);
  log(`structured presence: ${JSON.stringify(report.lineAnalysis.structured)}`);
  log(`text: ${JSON.stringify({ ...report.lineAnalysis.text, commentExamples: undefined, nameExamples: undefined })}`);
  log(`comment examples: ${JSON.stringify(report.lineAnalysis.text.commentExamples)}`);
  log(`name examples: ${JSON.stringify(report.lineAnalysis.text.nameExamples)}`);
  log(`qty×price≠sum (no discount): ${report.lineAnalysis.qtyTimesPriceNeqSum_noDiscount} ${JSON.stringify(report.lineAnalysis.mismatchExamples)}`);
  log(`product catalog: ${JSON.stringify(report.productCatalog)}`);
  log(`deal notes sample: ${JSON.stringify(report.dealNotesSample)}`);
  log(`\nfull → ${out}`);
}
main().catch((e) => { log(`[pricing-text] error: ${e?.message || e}`); process.exit(1); });
