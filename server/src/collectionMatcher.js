// Second-stage collection matching — identity + amount + date.
//
// The first stage linked only documents a deal NAMED in its own text. That is
// unarguable evidence, and it reached 3,610 of 14,788 documents. The rest were
// never written down anywhere in GOS: the money exists in iCount, the deal
// exists in GOS, and nothing textual joins them.
//
// This module joins them from what both sides already know — WITHOUT ever
// linking on a resemblance. The whole design is one idea:
//
//   A link is automatic ONLY when the document and the deal are each other's
//   ONLY candidate. Anything a human could reasonably disagree with becomes a
//   question, not a row.
//
// Everything here is pure. The runner supplies the indexes; this file decides.

// ── Identity normalisation ───────────────────────────────────────────────────
// Hebrew business names arrive with gershayim, hyphens, "בע\"מ" spelled three
// ways and inconsistent spacing. Normalisation must survive that without
// collapsing genuinely different customers together, so it strips punctuation
// and whitespace but keeps every letter.
export function normName(s) {
  return String(s || '')
    .replace(/["'״׳`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ /g, '');
}

export const normTaxId = (s) => String(s || '').replace(/\D/g, '');

// An Israeli phone reduced to comparable digits (0501234567 / +972501234567 /
// 050-123-4567 all collapse to the same key).
export function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  return d.length >= 9 ? d : '';
}

export const normEmail = (s) => String(s || '').trim().toLowerCase();

// ── Date compatibility ───────────────────────────────────────────────────────
// A document may be issued well before the tour (a deposit, an advance invoice)
// or well after it (a bookkeeper catching up). The window is deliberately
// generous — it exists to EXCLUDE nonsense, not to prove a match. Precision
// comes from identity + amount + mutual uniqueness.
const DAYS = 86_400_000;
const WINDOW_BEFORE_DAYS = 120; // before the deal was created
const WINDOW_AFTER_DAYS = 365; // after the tour / after the deal was won

export function dateCompatible(docIssuedAt, deal) {
  const t = new Date(docIssuedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const anchors = [deal.createdAt, deal.wonAt, deal.tourDate ? `${deal.tourDate}T00:00:00.000Z` : null]
    .filter(Boolean)
    .map((x) => new Date(x).getTime())
    .filter(Number.isFinite);
  if (!anchors.length) return true; // no anchor to contradict
  const lo = Math.min(...anchors) - WINDOW_BEFORE_DAYS * DAYS;
  const hi = Math.max(...anchors) + WINDOW_AFTER_DAYS * DAYS;
  return t >= lo && t <= hi;
}

// How far apart, in days, for scoring/ranking (0 when inside the tour window).
export function dateDistanceDays(docIssuedAt, deal) {
  const t = new Date(docIssuedAt).getTime();
  const anchors = [deal.tourDate ? `${deal.tourDate}T00:00:00.000Z` : null, deal.wonAt, deal.createdAt]
    .filter(Boolean)
    .map((x) => new Date(x).getTime())
    .filter(Number.isFinite);
  if (!anchors.length) return 9999;
  return Math.round(Math.min(...anchors.map((a) => Math.abs(t - a))) / DAYS);
}

// ── Amount comparison ────────────────────────────────────────────────────────
// Exact means exact: these are accounting figures, not estimates. The tolerance
// only absorbs per-line VAT rounding.
const AMOUNT_TOLERANCE_MINOR = 10;
export const amountsEqual = (a, b) => Math.abs(Number(a) - Number(b)) <= AMOUNT_TOLERANCE_MINOR;

// ── Identity resolution ──────────────────────────────────────────────────────
/**
 * Which GOS customers could this iCount document belong to?
 *
 * `idx` supplies the lookups the runner built:
 *   clientIdToCustomers  learned from stage-1 links — the single strongest
 *                        signal, because it was PROVEN by a document the deal
 *                        itself named
 *   taxIdToCustomers     Organization.taxId / Contact.taxId
 *   nameToCustomers      exact normalised organisation and contact names
 *
 * Returns [{ customerKey, basis }] — `customerKey` is 'org:<id>' or 'contact:<id>'.
 */
export function resolveDocumentIdentity(doc, idx) {
  const hits = new Map(); // customerKey -> strongest basis

  const add = (keys, basis) => {
    for (const k of keys || []) if (!hits.has(k)) hits.set(k, basis);
  };

  // 1. Learned client_id mapping — proven by stage-1 evidence.
  if (doc.clientId) add(idx.clientIdToCustomers.get(String(doc.clientId)), 'icount_client_id');
  // 2. Company/tax number.
  const tax = normTaxId(doc.clientVatId);
  if (tax.length >= 8) add(idx.taxIdToCustomers.get(tax), 'tax_id');
  // 3. Exact normalised name.
  const name = normName(doc.clientName);
  if (name.length >= 3) add(idx.nameToCustomers.get(name), 'exact_name');

  return [...hits.entries()].map(([customerKey, basis]) => ({ customerKey, basis }));
}

// Basis strength — used only for ordering and scoring, never to override
// uniqueness. A weaker basis can still produce a Tier A link if it is the ONLY
// candidate; a stronger one can still be Tier B if it is ambiguous.
const BASIS_WEIGHT = { icount_client_id: 45, tax_id: 40, exact_name: 30 };

// ── Candidate construction ───────────────────────────────────────────────────
/**
 * All (document → deal) candidate pairs, with their evidence.
 *
 * `deals` are the WON deals still lacking money evidence, each carrying
 * `customerKeys` (its organisation and contacts) precomputed by the runner.
 */
export function buildCandidates(doc, idx, { dealsByCustomer }) {
  const identities = resolveDocumentIdentity(doc, idx);
  if (!identities.length) return [];

  const docMoney = Math.abs(Number(doc.paidMinor ?? doc.totalMinor ?? 0)) || Math.abs(Number(doc.totalMinor || 0));
  const out = new Map(); // dealId -> candidate

  for (const { customerKey, basis } of identities) {
    for (const deal of dealsByCustomer.get(customerKey) || []) {
      if (out.has(deal.id)) continue;
      if ((deal.currency || 'ILS') !== (doc.currency || 'ILS')) continue; // currencies never mix
      if (!dateCompatible(doc.issuedAt, deal)) continue;

      const dealValue = Number(deal.valueMinor || 0);
      const exactAmount = dealValue > 0 && amountsEqual(docMoney, dealValue);
      // A document SMALLER than the deal is a plausible deposit; a document
      // LARGER may be a consolidated one. Neither is a match on its own.
      const partial = dealValue > 0 && docMoney < dealValue;
      const over = dealValue > 0 && docMoney > dealValue && !exactAmount;

      const reasons = [{ code: basis, detail: doc.clientName || doc.clientId || null }];
      if (exactAmount) reasons.push({ code: 'exact_amount', detail: docMoney });
      else if (partial) reasons.push({ code: 'amount_below_deal', detail: `${docMoney} < ${dealValue}` });
      else if (over) reasons.push({ code: 'amount_above_deal', detail: `${docMoney} > ${dealValue}` });

      const days = dateDistanceDays(doc.issuedAt, deal);
      reasons.push({ code: 'date_distance_days', detail: days });

      out.set(deal.id, {
        dealId: deal.id,
        orderNo: deal.orderNo,
        dealValueMinor: dealValue,
        doctype: doc.doctype,
        docnum: doc.docnum,
        docMoneyMinor: docMoney,
        basis,
        exactAmount,
        partial,
        over,
        days,
        reasons,
        score: scoreCandidate({ basis, exactAmount, partial, days }),
      });
    }
  }
  return [...out.values()];
}

// Deterministic 0-100. Identity carries the most weight, an exact amount is the
// decisive confirmation, and date proximity only breaks ties.
export function scoreCandidate({ basis, exactAmount, partial, days }) {
  let s = BASIS_WEIGHT[basis] || 20;
  if (exactAmount) s += 40;
  else if (partial) s += 10;
  if (days <= 30) s += 15;
  else if (days <= 120) s += 8;
  else if (days <= 365) s += 3;
  return Math.max(0, Math.min(100, s));
}

// ── Tier assignment ──────────────────────────────────────────────────────────
// THE rule: automatic only on MUTUAL uniqueness under an exact amount.
//
//   docCandidates[docKey]  — every deal this document could belong to
//   dealCandidates[dealId] — every document that could settle this deal
//
// A pair is Tier A when, restricted to exact-amount candidates, the document
// has exactly one deal and that deal has exactly one document. Everything else
// with identity is Tier B; no identity at all is Tier C and is never queued.
export function assignTiers({ docCandidates, dealCandidates }) {
  const tierA = [];
  const tierB = [];

  for (const [docKey, cands] of docCandidates) {
    if (!cands.length) continue;
    const exact = cands.filter((c) => c.exactAmount);

    if (exact.length === 1) {
      const c = exact[0];
      const dealExact = (dealCandidates.get(c.dealId) || []).filter((x) => x.exactAmount);
      if (dealExact.length === 1 && dealExact[0].docnum === c.docnum && dealExact[0].doctype === c.doctype) {
        tierA.push({
          ...c,
          tier: 'A',
          reasons: [...c.reasons, { code: 'mutual_unique_exact_amount', detail: 'זהות + סכום מדויק, מועמד יחיד משני הצדדים' }],
        });
        continue;
      }
    }

    // Not automatic. Everything with identity becomes an answerable question,
    // ranked so the operator sees the most likely first.
    const ranked = [...cands].sort((a, b) => b.score - a.score);
    const competingDeals = ranked.map((c) => ({ dealId: c.dealId, orderNo: c.orderNo, valueMinor: c.dealValueMinor, score: c.score }));
    for (const c of ranked) {
      const competingDocs = (dealCandidates.get(c.dealId) || [])
        .filter((x) => x.docnum !== c.docnum || x.doctype !== c.doctype)
        .map((x) => ({ doctype: x.doctype, docnum: x.docnum, amountMinor: x.docMoneyMinor, score: x.score }));
      tierB.push({
        ...c,
        tier: 'B',
        docKey,
        competingDeals: competingDeals.filter((x) => x.dealId !== c.dealId),
        competingDocs,
        question: buildQuestion(c, competingDeals, competingDocs),
      });
    }
  }
  return { tierA, tierB };
}

// The ONE thing the operator has to decide, in business language.
export function buildQuestion(c, competingDeals, competingDocs) {
  const others = competingDeals.filter((x) => x.dealId !== c.dealId).length;
  const ils = (m) => `₪${(Number(m) / 100).toLocaleString('he-IL')}`;
  if (others > 0 && c.exactAmount) {
    return `המסמך בסכום ${ils(c.docMoneyMinor)} מתאים במדויק גם ל־${others} עסקאות אחרות של אותו לקוח. האם הוא שייך לעסקה הזו?`;
  }
  if (others > 0) {
    return `לאותו לקוח יש ${others + 1} עסקאות אפשריות למסמך הזה. האם המסמך שייך לעסקה הזו?`;
  }
  if (c.partial) {
    return `המסמך בסכום ${ils(c.docMoneyMinor)} קטן מסכום העסקה (${ils(c.dealValueMinor)}). האם זו מקדמה על חשבון העסקה?`;
  }
  if (c.over) {
    return `המסמך בסכום ${ils(c.docMoneyMinor)} גדול מסכום העסקה (${ils(c.dealValueMinor)}). האם הוא מסמך משותף שסוגר גם עסקאות אחרות?`;
  }
  if (competingDocs.length) {
    return `לעסקה הזו מתאימים ${competingDocs.length + 1} מסמכים שונים. איזה מהם שייך לה?`;
  }
  return `האם המסמך שייך לעסקה הזו?`;
}

// ── Shared historical documents ──────────────────────────────────────────────
// The owner's cutover ruling: when a single document evidently covers a GROUP of
// deals, link it to all of them and let each read as settled — rather than
// reconstructing five-year-old allocations.
//
// "Evidently" is not a guess: the candidate deals' own values must SUM to the
// document's amount (within tolerance). That is the arithmetic signature of a
// consolidated document, and it is the only shape accepted here. A document
// merely bigger than several deals is not enough — that goes to review.
const SHARED_SUM_TOLERANCE_MINOR = 100;

export function detectSharedDocument(docMoneyMinor, candidates) {
  const exactCurrency = candidates.filter((c) => c.dealValueMinor > 0);
  if (exactCurrency.length < 2) return null;
  const sum = exactCurrency.reduce((s, c) => s + c.dealValueMinor, 0);
  if (Math.abs(sum - docMoneyMinor) > SHARED_SUM_TOLERANCE_MINOR) return null;
  return {
    deals: exactCurrency.map((c) => ({ dealId: c.dealId, orderNo: c.orderNo, allocationMinor: c.dealValueMinor })),
    sumMinor: sum,
    documentMinor: docMoneyMinor,
  };
}
