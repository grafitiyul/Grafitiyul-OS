// Composing ONE accounting document that covers several deals.
//
// This module answers a single question — "what should the composer be
// pre-filled with?" — and answers it by CALLING the canonical pieces, never by
// re-implementing them:
//
//   per-deal lines   buildDocumentDefaults()      (the deal's own Builder)
//   source lines     fetchBaseDocumentPrefill()   (the real iCount document)
//   per-deal notes   the same defaults the single-deal modal opens with
//   totals           totalsForRows()              (the shared VAT calc)
//
// It ISSUES nothing. The wizard produces a plan, the plan pre-fills the normal
// "הפק מסמך" composer, and the operator issues from there exactly as always.
//
// ── The one accounting judgement made here ───────────────────────────────────
// When a source document is only PARTLY settled by the new document, its real
// product lines cannot be copied: three lines totalling ₪1,000 on a document
// that collects ₪700 would state a false price. Scaling them proportionally
// would be worse — it invents a ₪700 tour that was never sold.
//
// So a partial settlement contributes ONE honest line — "<מסמך> <מס׳> — תשלום
// על החשבון" at the amount actually being collected — plus the mandatory note
// saying exactly how much of what was paid. A FULL settlement copies the source
// document's real lines verbatim, in order. Everything stays editable in the
// composer.

import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  ICOUNT_DEAL_INCLUDE,
  buildDocumentDefaults,
  fetchBaseDocumentPrefill,
  totalsForRows,
  vatRatePercent,
} from '../icountDocs.js';
import { loadVatDefault } from '../quote/importedBuilderSeed.js';
import { getAccountingDocSettings, buildNotesByDoctype } from '../accountingDocNotes.js';
import { reconcileAllocations } from '../../../shared/paymentAllocation.mjs';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ils = (n) => `${Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪`;

function codedError(code, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  if (detail) err.detail = detail;
  return err;
}

// A document is "fully settling" its source when the allocated amount matches
// the source's own total. Ten agorot of VAT rounding is not a partial payment.
const FULL_TOLERANCE_ILS = 0.1;

/**
 * Compose the multi-deal document plan.
 *
 * @param input.doctype  the target document type (canonical DOC_TYPES key)
 * @param input.items    [{ dealId, basedOn:{doctype,docnum}|null, allocationIls }]
 *                       IN OPERATOR ORDER — the line order follows it exactly.
 * @param input.amountIls  the new document's total, when the operator has
 *                       already stated it; otherwise the sum of allocations.
 */
export async function composeMultiDealDocument(prisma, input, { readSource = fetchBaseDocumentPrefill } = {}) {
  const doctype = String(input?.doctype || '');
  const typeDef = DOC_TYPES.find((t) => t.key === doctype);
  if (!typeDef) throw codedError('invalid_doctype');

  const items = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) throw codedError('deals_required');
  const seen = new Set();
  for (const it of items) {
    if (!it?.dealId) throw codedError('deal_missing');
    if (seen.has(it.dealId)) throw codedError('deal_duplicate', it.dealId);
    seen.add(it.dealId);
  }

  const vatDefault = await loadVatDefault(prisma);
  // The office's default note blocks — the SAME settings the single-deal modal
  // composes from, read once for the whole document.
  const settings = await getAccountingDocSettings(prisma);
  const perDeal = [];

  for (const item of items) {
    const deal = await prisma.deal.findUnique({
      where: { id: item.dealId },
      include: ICOUNT_DEAL_INCLUDE,
    });
    if (!deal) throw codedError('deal_not_found', item.dealId);

    // The deal's OWN canonical document defaults — the same object the
    // single-deal modal opens with, so nothing about line composition,
    // customer resolution, VAT or notes is re-derived here.
    const defaults = buildDocumentDefaults(deal, { vatDefault });

    const basedOn = item.basedOn?.doctype && item.basedOn?.docnum
      ? { doctype: String(item.basedOn.doctype), docnum: String(item.basedOn.docnum) }
      : null;
    if (basedOn && !typeDef.baseTypes.includes(basedOn.doctype)) {
      throw codedError('base_document_type_invalid', `${basedOn.doctype} → ${doctype}`);
    }

    // The SOURCE document's real content, read live from iCount. A failure is
    // reported per deal rather than failing the whole wizard — the operator can
    // still proceed with the deal's own lines and see why.
    let source = null;
    let sourceError = null;
    if (basedOn) {
      try {
        source = await readSource(prisma, deal, basedOn.doctype, basedOn.docnum);
      } catch (err) {
        sourceError = err?.reason || err?.code || 'source_document_unreadable';
      }
    }

    const sourceAmountIls = source?.amountIls ?? null;
    const allocationIls = item.allocationIls != null
      ? round2(Number(item.allocationIls))
      : (sourceAmountIls ?? round2(totalsForRows(defaults.rows, vatDefault.rate, defaults.vatMode).grossIls));
    if (!Number.isFinite(allocationIls) || allocationIls < 0) throw codedError('allocation_amount_invalid');

    const fullSettlement = sourceAmountIls == null
      ? true
      : Math.abs(sourceAmountIls - allocationIls) <= FULL_TOLERANCE_ILS;

    perDeal.push({
      dealId: deal.id,
      orderNo: deal.orderNo,
      dealTitle: deal.title,
      contactName: defaults.customer.contactName || null,
      organizationName: defaults.customer.organizationName || null,
      customerEmail: defaults.customer.email || null,
      basedOn,
      basedOnLabel: basedOn ? DOC_TYPE_LABELS[basedOn.doctype] : null,
      sourceAmountIls,
      sourceError,
      allocationIls,
      fullSettlement,
      remainingAfterIls: sourceAmountIls == null ? null : round2(sourceAmountIls - allocationIls),
      // The lines THIS deal contributes, already decided (see the module note).
      rows: linesForDeal({ deal, defaults, source, basedOn, allocationIls, fullSettlement }),
      // The deal's own document notes — the canonical per-doctype composition
      // (office blocks + THIS deal's real values), inheriting the source
      // document's notes exactly as the single-deal modal does.
      notes: (buildNotesByDoctype(settings, deal, { inheritedNotes: source?.notes || '' })[doctype] || '').trim() || null,
      language: defaults.language,
      vatMode: defaults.vatMode,
      currency: defaults.currency,
    });
  }

  // The document's own interpretation. Inherited source lines are real iCount
  // gross prices, so any deal that inherited one forces 'included' — the same
  // rule the single-deal modal applies.
  const vatMode = perDeal.some((d) => d.basedOn && !d.sourceError) ? 'included' : (perDeal[0]?.vatMode || 'included');
  const rows = perDeal.flatMap((d) => d.rows);
  const { grossIls } = totalsForRows(rows, vatRatePercent(), vatMode);

  const allocatedIls = round2(perDeal.reduce((s, d) => s + d.allocationIls, 0));
  const amountIls = input?.amountIls != null ? round2(Number(input.amountIls)) : allocatedIls;
  const reconciliation = reconcileAllocations(
    Math.round(amountIls * 100),
    perDeal.map((d) => ({ dealId: d.dealId, amountMinor: Math.round(d.allocationIls * 100) })),
  );

  return {
    doctype,
    doctypeLabel: typeDef.label,
    perDeal,
    rows,
    notes: composeNotes(perDeal),
    basedOnDocs: perDeal.filter((d) => d.basedOn).map((d) => d.basedOn),
    vatMode,
    currency: perDeal[0]?.currency || 'ILS',
    language: perDeal[0]?.language || 'he',
    amountIls,
    allocatedIls,
    // What the COMPOSED LINES actually total — the number the composer will
    // show. Reported separately from the requested amount so a mismatch is
    // visible in the wizard rather than surfacing as an iCount rejection.
    linesTotalIls: round2(grossIls),
    reconciliation,
    // The plan the composer hands back to issueDocument, already in the shape
    // the allocation service expects.
    allocations: perDeal.map((d) => ({
      dealId: d.dealId,
      orderNo: d.orderNo,
      amountMinor: Math.round(d.allocationIls * 100),
    })),
  };
}

/**
 * The lines ONE deal contributes, in the order they will appear.
 *
 *   full settlement of a source → the source document's REAL lines, verbatim
 *   partial settlement         → one honest "תשלום על החשבון" line
 *   no source document         → the deal's own canonical Builder lines
 */
function linesForDeal({ defaults, source, basedOn, allocationIls, fullSettlement }) {
  if (source && !fullSettlement) {
    return [{
      description: `${source.doctypeLabel} ${source.docnum} — תשלום על החשבון`,
      details: source.amountIls != null
        ? `מתוך ${ils(source.amountIls)}`
        : null,
      quantity: 1,
      unitPriceIls: round2(allocationIls),
      // A part payment of an exempt document stays exempt.
      vatExempt: source.rows.length > 0 && source.rows.every((r) => r.vatExempt),
    }];
  }
  if (source && source.rows.length) return source.rows.map((r) => ({ ...r }));
  if (basedOn && source) {
    // A readable source with no items: never synthesize a product line.
    return [{
      description: `${source.doctypeLabel} ${source.docnum}`,
      details: null,
      quantity: 1,
      unitPriceIls: round2(allocationIls),
      vatExempt: false,
    }];
  }
  // No source document — the deal's own commercial lines.
  return (defaults.rows || []).map((r) => ({ ...r }));
}

/**
 * Notes, composed IN DEAL ORDER and never mashed together.
 *
 * Each deal gets a headed block carrying its own document's notes, and a
 * partially-settled source gets the mandatory sentence stating exactly how much
 * of it this document pays. A fully-closed source gets no such sentence — it
 * would only add noise.
 */
export function composeNotes(perDeal) {
  const blocks = [];
  for (const d of perDeal) {
    const lines = [];
    const head = `דיל #${d.orderNo}${d.contactName ? ` — ${d.contactName}` : ''}`;
    lines.push(head);
    if (d.basedOn) {
      lines.push(
        d.fullSettlement
          ? `${d.basedOnLabel} ${d.basedOn.docnum} — נסגר במלואו`
          // The owner's exact wording: which document, how much of how much.
          : `${d.basedOnLabel} ${d.basedOn.docnum} שולם ${ils(d.allocationIls)} מתוך ${ils(d.sourceAmountIls ?? d.allocationIls)}`,
      );
    }
    if (d.notes) lines.push(d.notes);
    blocks.push(lines.join('\n'));
  }
  // A blank line between deals — readable separation, plain text, exactly what
  // iCount's hwc field renders (documentNotes.js: "\n" is a real line break).
  return blocks.join('\n\n');
}

/**
 * Rank a deal's candidate source documents for a target doctype.
 *
 * "Do not make me remember document numbers": the documents most likely to be
 * the parent come first, each carrying everything an operator identifies it by.
 *
 * Two things about the input are worth stating, because both were found by
 * verifying against real production data rather than assumed:
 *
 *   • the date arrives as `createdAt` (the deal's document list), not
 *     `issuedAt` — sorting on the latter silently tied every row;
 *   • GOS-issued rows carry NO settlement status at all. GOS genuinely does not
 *     know whether a חשבון עסקה it issued has since been closed at iCount, so
 *     the status is reported as null and ranked as "no evidence it is closed"
 *     — above a known-partial or known-closed document, below a confirmed-open
 *     one. Inventing 'open' for them would be a claim nobody verified.
 */
const STATUS_RANK = { open: 0, partial: 2, closed: 3 };
const UNKNOWN_STATUS_RANK = 1;

export function rankSourceCandidates(candidates, targetDoctype) {
  const typeDef = DOC_TYPES.find((t) => t.key === targetDoctype);
  const allowed = new Set(typeDef?.baseTypes || []);
  return (candidates || [])
    .filter((d) => d.docnum && allowed.has(d.doctype))
    .map((d) => ({
      ...d,
      // ONE date field for the UI, whichever the source supplied.
      issuedAt: d.issuedAt || d.createdAt || null,
      // Explicitly null rather than undefined: the UI renders "unknown" instead
      // of a blank it cannot distinguish from a missing field.
      status: d.status || null,
      amountIls: d.amountIls ?? null,
    }))
    .sort((a, b) => {
      const s = (STATUS_RANK[a.status] ?? UNKNOWN_STATUS_RANK) - (STATUS_RANK[b.status] ?? UNKNOWN_STATUS_RANK);
      if (s !== 0) return s;
      return new Date(b.issuedAt || 0) - new Date(a.issuedAt || 0);
    });
}
