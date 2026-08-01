import { parseDocumentReferences, mergeDealReferences } from './collectionEvidence.js';
import { DOC_TYPE_LABELS } from './icountDocs.js';

// Historical collection reconstruction — the DECISION layer.
//
// It answers one question per WON deal: which iCount documents genuinely belong
// to this deal, and is the answer trustworthy enough to apply automatically?
//
// Everything here is PURE. The engine takes the deal, the references parsed out
// of its own text, and the local iCount ledger census, and returns a decision.
// Persisting it is a separate step, so the whole policy can be dry-run over the
// real production corpus and read before a single row is written.
//
// ── The matching hierarchy (highest confidence first) ────────────────────────
//   1. gos_issued          an IcountDocument already linked to the deal
//   2. note_url            the note carries iCount's own document link
//   3. note_typed_number   the note names the document TYPE and its number
//   4. note_number_series  a bare number that resolves to exactly ONE document
//                          in the whole iCount account
//
// A document is NEVER attached on customer name, amount or date similarity. Those
// signals are used only to VERIFY a reference the deal itself already stated —
// a disagreement sends the deal to review, it never creates a link.
//
// ── When the engine refuses to decide ────────────────────────────────────────
// The deal is flagged for review and its numbers are still shown. Refusing is a
// FEATURE: forcing every deal into paid/unpaid would quietly corrupt the books.

// Documents whose existence proves nothing about payment. Attached for context
// (the operator should see the customer holds an invoice) but never counted.
const BILLING_DOCTYPES = new Set(['deal', 'invoice']);
const MONEY_DOCTYPES = new Set(['receipt', 'invrec', 'refund']);

// A document may cover more than the deal's own price (rounding, an extra the
// Builder never captured). Beyond BOTH of these it is not a rounding artefact —
// it means the link or the total is wrong, and a human should look.
const OVERPAY_RATIO = 1.2;
const OVERPAY_ABSOLUTE_MINOR = 10_000; // ₪100

export const REVIEW_CODES = {
  shared_document: 'מסמך אחד משויך למספר עסקאות',
  ambiguous_reference: 'מספר מסמך שמתאים ליותר ממסמך אחד',
  unresolved_reference: 'מספר מסמך שלא נמצא באייקאונט',
  doctype_conflict: 'אותו מספר מסמך נרשם בשני סוגי מסמך',
  cancelled_document: 'המסמך שאליו מפנה העסקה מבוטל',
  customer_mismatch: 'שם הלקוח במסמך שונה מהלקוח בעסקה',
  amount_conflict: 'הסכום שהתקבל גבוה מהותית מסכום העסקה',
  credit_without_base: 'חשבונית זיכוי ללא מסמך מקור משויך',
  currency_mismatch: 'תשלום במטבע שונה ממטבע העסקה',
};

// ── Identity comparison ──────────────────────────────────────────────────────
// Hebrew business names arrive with gershayim, hyphens and inconsistent
// spacing; comparison must survive that without becoming so loose it matches
// everything. Tokens of 2+ characters, punctuation stripped.
export function nameTokens(s) {
  return String(s || '')
    .replace(/["'״׳`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .split(' ')
    .filter((t) => t.length >= 2);
}

// Does the document's customer plausibly match the deal's? A shared tax id is
// decisive; otherwise ANY shared name token counts as a match. Deliberately
// permissive: this check exists to catch a document that clearly belongs to a
// different customer, not to police formatting.
export function customerMatches(ledgerDoc, dealIdentity) {
  const docVat = String(ledgerDoc.clientVatId || '').replace(/\D/g, '');
  if (docVat && dealIdentity.taxIds.some((t) => String(t || '').replace(/\D/g, '') === docVat)) {
    return { match: true, basis: 'tax_id' };
  }
  const docTokens = new Set(nameTokens(ledgerDoc.clientName));
  if (!docTokens.size) return { match: true, basis: 'no_document_name' };
  for (const name of dealIdentity.names) {
    for (const t of nameTokens(name)) {
      if (docTokens.has(t)) return { match: true, basis: 'name_token' };
    }
  }
  return { match: false, basis: 'no_overlap' };
}

// The names/ids a document could legitimately be issued to for this deal.
export function dealIdentityOf(deal) {
  const contacts = (deal.contacts || []).map((dc) => dc.contact).filter(Boolean);
  return {
    names: [
      deal.organization?.name,
      deal.organizationUnit?.name,
      deal.title,
      ...contacts.flatMap((c) => [
        `${c.firstNameHe || ''} ${c.lastNameHe || ''}`,
        `${c.firstNameEn || ''} ${c.lastNameEn || ''}`,
      ]),
    ].filter(Boolean),
    taxIds: [deal.organization?.taxId, deal.organizationUnit?.taxId, ...contacts.map((c) => c.taxId)].filter(Boolean),
  };
}

// ── Reference extraction for one deal ────────────────────────────────────────
// `texts`: [{ text, source }] — the deal's notes, customer info and every
// timeline entry body. All of it is the deal's OWN record, which is what makes a
// number found here evidence about THIS deal.
export function referencesForDeal(texts) {
  const all = [];
  for (const { text, source } of texts || []) {
    for (const ref of parseDocumentReferences(text)) all.push({ ...ref, source });
  }
  const merged = mergeDealReferences(all);
  // A document link and a document number stated in the SAME note describe the
  // same document — the link is what upgrades that reference's confidence.
  return merged;
}

// ── The decision ─────────────────────────────────────────────────────────────
/**
 * @param deal          { id, orderNo, valueMinor, currency, contacts, organization, ... }
 * @param references    from referencesForDeal()
 * @param ledger        { byKey: Map<'doctype:docnum', row>, byNum: Map<docnum, row[]> }
 * @param claims        Map<'doctype:docnum', dealId[]> — every deal whose text
 *                      claims this document, across the whole population
 * @param alreadyLinked Set<'doctype:docnum'> — documents already on this deal
 */
export function decideDeal({ deal, references, ledger, claims, alreadyLinked = new Set() }) {
  const identity = dealIdentityOf(deal);
  const attach = [];
  const problems = [];
  const skipped = [];

  for (const ref of references.references) {
    if (ref.doctype === 'conflict') {
      problems.push({ code: 'doctype_conflict', docnum: ref.docnum, statedDoctypes: ref.statedDoctypes });
      continue;
    }

    // Resolve the reference against the local iCount census.
    let candidates;
    if (ref.doctype && ref.doctype !== 'unknown') {
      const exact = ledger.byKey.get(`${ref.doctype}:${ref.docnum}`);
      // A stated type that iCount does not have under that number is not a
      // reason to give up — operators write "חשבונית 38474" for an invrec. Fall
      // back to the number across all types, which still has to be unique.
      candidates = exact ? [exact] : ledger.byNum.get(ref.docnum) || [];
    } else {
      candidates = ledger.byNum.get(ref.docnum) || [];
    }

    if (candidates.length === 0) {
      problems.push({ code: 'unresolved_reference', docnum: ref.docnum, statedDoctype: ref.doctype });
      continue;
    }
    if (candidates.length > 1) {
      problems.push({
        code: 'ambiguous_reference',
        docnum: ref.docnum,
        candidates: candidates.map((c) => ({ doctype: c.doctype, docnum: c.docnum, issuedAt: c.issuedAt })),
      });
      continue;
    }

    const doc = candidates[0];
    const key = `${doc.doctype}:${doc.docnum}`;

    if (doc.isCancelled || doc.isCancellation) {
      // A voided document must never count. It is still worth saying out loud,
      // because a deal whose only evidence is a cancelled document looks
      // identical to a deal with no evidence at all.
      problems.push({ code: 'cancelled_document', doctype: doc.doctype, docnum: doc.docnum });
      skipped.push({ ...key3(doc), reason: 'cancelled' });
      continue;
    }

    // One document, several deals. Attaching it to each would count the same
    // money two-to-nineteen times; splitting it needs an allocation only a human
    // knows. Neither is something an importer may decide.
    const claimants = claims.get(key) || [];
    if (claimants.length > 1) {
      problems.push({
        code: 'shared_document',
        doctype: doc.doctype,
        docnum: doc.docnum,
        amountMinor: Number(doc.totalMinor),
        clientName: doc.clientName,
        dealCount: claimants.length,
        dealIds: claimants.slice(0, 25),
      });
      skipped.push({ ...key3(doc), reason: 'shared' });
      continue;
    }

    if (alreadyLinked.has(key)) continue; // idempotent: nothing to do

    const match = customerMatches(doc, identity);
    if (!match.match) {
      // Still attached — the number came from THIS deal's own record, which is
      // strong evidence — but the deal goes to review so a human confirms it.
      problems.push({
        code: 'customer_mismatch',
        doctype: doc.doctype,
        docnum: doc.docnum,
        documentClient: doc.clientName,
      });
    }

    attach.push({
      doctype: doc.doctype,
      docnum: doc.docnum,
      ledger: doc,
      linkConfidence: ref.url ? 'note_url' : ref.doctype !== 'unknown' ? 'note_typed_number' : 'note_number_series',
      linkReason: buildLinkReason(ref, doc, match),
      docUrl: ref.url || doc.docUrl || null,
    });
  }

  // ── Cross-checks over what we are about to attach ──────────────────────────
  const currency = deal.currency || 'ILS';
  const foreign = [...new Set(attach.filter((a) => a.ledger.currency !== currency).map((a) => a.ledger.currency))];
  if (foreign.length) problems.push({ code: 'currency_mismatch', currencies: foreign, dealCurrency: currency });

  const attachedMoney = attach.filter((a) => MONEY_DOCTYPES.has(a.doctype) && a.ledger.currency === currency);
  const paid = attachedMoney
    .filter((a) => a.doctype !== 'refund')
    .reduce((s, a) => s + moneyOf(a.ledger), 0);
  const credited = attachedMoney
    .filter((a) => a.doctype === 'refund')
    .reduce((s, a) => s + moneyOf(a.ledger), 0);
  const net = paid - credited;
  const total = Number(deal.valueMinor || 0);

  if (total > 0 && net > total * OVERPAY_RATIO && net - total > OVERPAY_ABSOLUTE_MINOR) {
    problems.push({ code: 'amount_conflict', totalMinor: total, paidMinor: net });
  }
  // A credit note with no invoice of its own on the deal leaves the chain
  // unresolved — what was credited, and against what?
  if (credited > 0 && !attach.some((a) => BILLING_DOCTYPES.has(a.doctype) || a.doctype === 'invrec')) {
    problems.push({ code: 'credit_without_base', creditedMinor: credited });
  }

  return {
    dealId: deal.id,
    orderNo: deal.orderNo,
    attach,
    skipped,
    problems,
    projected: { totalMinor: total, paidMinor: net, balanceMinor: total - net },
    review: problems.length ? buildReview(problems) : null,
    outcome: classifyOutcome({ problems, total, net, attach }),
  };
}

const key3 = (d) => ({ doctype: d.doctype, docnum: d.docnum, amountMinor: Number(d.totalMinor) });

// The money a document moved: `totalpaid` when the provider reported it (a
// partial receipt records less than its face), else the gross. Always positive —
// iCount reports credit notes negative and the direction lives in the doctype.
function moneyOf(ledgerDoc) {
  const paid = ledgerDoc.paidMinor != null ? Math.abs(Number(ledgerDoc.paidMinor)) : 0;
  if (paid > 0) return paid;
  return Math.abs(Number(ledgerDoc.totalMinor || 0));
}

function buildLinkReason(ref, doc, match) {
  const label = DOC_TYPE_LABELS[doc.doctype] || doc.doctype;
  const how = ref.url
    ? 'קישור למסמך שנמצא ברשומת העסקה'
    : ref.doctype !== 'unknown'
      ? `${label} ומספר מסמך שנרשמו ברשומת העסקה`
      : 'מספר מסמך שנרשם ברשומת העסקה, שזוהה חד־ערכית באייקאונט';
  const verified = match.basis === 'tax_id' ? ' · אומת לפי ח.פ' : match.match ? ' · אומת לפי שם הלקוח' : ' · שם הלקוח שונה';
  return `שוחזר מהיסטוריית העסקה: ${how}${verified}`;
}

// The single review record stored on the deal. The FIRST problem by severity
// becomes the headline; everything found is kept in `details` so the operator
// sees the whole picture and knows exactly what to answer.
const SEVERITY = [
  'shared_document',
  'amount_conflict',
  'currency_mismatch',
  'ambiguous_reference',
  'doctype_conflict',
  'customer_mismatch',
  'credit_without_base',
  'cancelled_document',
  'unresolved_reference',
];

export function buildReview(problems) {
  const sorted = [...problems].sort((a, b) => SEVERITY.indexOf(a.code) - SEVERITY.indexOf(b.code));
  const head = sorted[0];
  return {
    code: head.code,
    reason: REVIEW_CODES[head.code] || head.code,
    details: { problems: sorted },
    flaggedAt: new Date().toISOString(),
    flaggedBy: 'collection_backfill',
  };
}

// What the historical policy did with this deal — the report's categories.
function classifyOutcome({ problems, total, net, attach }) {
  if (problems.length) return 'review';
  if (total <= 0) return attach.length ? 'no_amount_with_documents' : 'no_amount';
  if (net <= 0) return attach.length ? 'unpaid_with_billing_documents' : 'unpaid';
  if (net >= total - 10) return 'paid';
  return 'partial';
}
