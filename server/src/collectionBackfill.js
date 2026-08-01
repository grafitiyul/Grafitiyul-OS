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
 * @param claimInfo     Map<dealId, {orderNo, valueMinor}> — so a shared-document
 *                      review can name the other deals, not just their ids
 * @param alreadyLinked Set<'doctype:docnum'> — documents already on this deal
 * @param linkedDocs    the already-attached rows themselves. They carry money the
 *                      deal HAS, so the projected totals and the outcome describe
 *                      the deal's real state rather than only this run's delta —
 *                      otherwise a second run would report every deal it already
 *                      settled as "unpaid".
 */
export function decideDeal({
  deal,
  references,
  ledger,
  claims,
  claimInfo = null,
  alreadyLinked = new Set(),
  linkedDocs = [],
}) {
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
      // "זיכוי 240" almost always means a credit of ₪240, not document 240.
      // A number BELOW every document number the provider account has ever
      // issued cannot be a document reference, so it is discarded rather than
      // raised as an unresolved one — a review flag that says "document 240 was
      // not found" is noise, and noise is what makes operators stop reading
      // flags. The threshold comes from the census itself, never hard-coded.
      if (ledger.minDocnum && Number(ref.docnum) < ledger.minDocnum) {
        skipped.push({ docnum: ref.docnum, reason: 'below_document_number_range' });
        continue;
      }
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
      // The review record carries the WHOLE picture — the document's total and
      // every deal that claims it, with its order number and value — so the
      // operator can allocate it without hunting for the other deals first.
      problems.push({
        code: 'shared_document',
        doctype: doc.doctype,
        docnum: doc.docnum,
        amountMinor: Number(doc.totalMinor),
        clientName: doc.clientName,
        issuedAt: doc.issuedAt,
        dealCount: claimants.length,
        deals: claimants.slice(0, 30).map((id) => {
          const info = claimInfo?.get(id);
          return { dealId: id, orderNo: info?.orderNo ?? null, valueMinor: info ? Number(info.valueMinor || 0) : null };
        }),
      });
      skipped.push({ ...key3(doc), reason: 'shared' });
      continue;
    }

    // Customer verification runs on every document the deal RESOLVES to,
    // whether or not this particular run is the one attaching it. A mismatch is
    // a standing fact about the document, not about the act of linking it —
    // checking it only on first attach let a second run silently withdraw 167
    // legitimate flags (observed in production).
    const match = customerMatches(doc, identity);
    if (!match.match) {
      // The document is still attached — the number came from THIS deal's own
      // record, which is strong evidence — but the deal goes to review so a
      // human confirms it.
      problems.push({
        code: 'customer_mismatch',
        doctype: doc.doctype,
        docnum: doc.docnum,
        documentClient: doc.clientName,
      });
    }

    if (alreadyLinked.has(key)) continue; // idempotent: nothing left to write

    attach.push({
      doctype: doc.doctype,
      docnum: doc.docnum,
      ledger: doc,
      linkConfidence: ref.url ? 'note_url' : ref.doctype !== 'unknown' ? 'note_typed_number' : 'note_number_series',
      linkReason: buildLinkReason(ref, doc, match),
      docUrl: ref.url || doc.docUrl || null,
    });
  }

  // ── Cross-checks over everything the deal ends up holding ─────────────────
  // Deliberately NOT limited to this run's additions: every one of these is a
  // standing fact about the deal's evidence, so a repeat run must reach the same
  // conclusion rather than quietly withdrawing a flag it raised before.
  const currency = deal.currency || 'ILS';
  const heldDocs = [
    ...attach.map((a) => ({ doctype: a.doctype, currency: a.ledger.currency, status: 'issued' })),
    ...linkedDocs.map((d) => ({ doctype: d.doctype, currency: d.currency, status: d.status })),
  ];
  const foreign = [
    ...new Set(heldDocs.filter((d) => d.status !== 'cancelled' && (d.currency || 'ILS') !== currency).map((d) => d.currency)),
  ];
  if (foreign.length) problems.push({ code: 'currency_mismatch', currencies: foreign, dealCurrency: currency });

  // The deal's money = what this run attaches PLUS what it already had. Both
  // sides use the same accounting rule as the canonical resolver: only
  // receipt-type documents count, credit notes subtract, cancelled documents
  // never count, and a partial receipt contributes the money it recorded.
  const money = [
    ...attach.map((a) => ({ doctype: a.doctype, doc: a.ledger })),
    ...linkedDocs
      .filter((d) => d.status !== 'cancelled')
      .map((d) => ({ doctype: d.doctype, doc: { ...d, totalMinor: d.amountMinor, currency: d.currency } })),
  ].filter((m) => MONEY_DOCTYPES.has(m.doctype) && (m.doc.currency || 'ILS') === currency);

  const paid = money.filter((m) => m.doctype !== 'refund').reduce((s, m) => s + moneyOf(m.doc), 0);
  const credited = money.filter((m) => m.doctype === 'refund').reduce((s, m) => s + moneyOf(m.doc), 0);
  const net = paid - credited;
  const total = Number(deal.valueMinor || 0);

  if (total > 0 && net > total * OVERPAY_RATIO && net - total > OVERPAY_ABSOLUTE_MINOR) {
    problems.push({ code: 'amount_conflict', totalMinor: total, paidMinor: net });
  }
  // A credit note with no invoice of its own on the deal leaves the chain
  // unresolved — what was credited, and against what? Base documents already on
  // the deal count, so a re-run does not re-raise a chain that is complete.
  const hasBase = (t) => BILLING_DOCTYPES.has(t) || t === 'invrec';
  if (credited > 0 && !attach.some((a) => hasBase(a.doctype)) && !linkedDocs.some((d) => hasBase(d.doctype))) {
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
    outcome: classifyOutcome({ problems, total, net, documentCount: attach.length + linkedDocs.length }),
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
// `documentCount` is what the deal ENDS UP holding, not what this run added, so
// a repeat run classifies the same deal the same way.
function classifyOutcome({ problems, total, net, documentCount }) {
  if (problems.length) return 'review';
  if (total <= 0) return documentCount ? 'no_amount_with_documents' : 'no_amount';
  if (net <= 0) return documentCount ? 'unpaid_with_billing_documents' : 'unpaid';
  if (net >= total - 10) return 'paid';
  return 'partial';
}
