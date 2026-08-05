import { DOC_TYPE_LABELS } from './icountDocs.js';

// Collection (גבייה) — the SINGLE source of truth for a deal's financial
// collection status. Everything that shows paid/balance/status (the Deal גבייה
// card, the Collection screen, the historical reconstruction, the manual
// override UI) resolves through THIS module. The client performs no financial
// math, and no caller is allowed to re-derive these numbers its own way.
//
// ── What counts as money ─────────────────────────────────────────────────────
//   IN   קבלה (receipt), חשבונית מס קבלה (invrec)   — record money received
//   IN   manual payment evidence                     — operator-attested money
//   IN   settlement evidence                         — an explicit "settled" call
//   IN   woo_payment evidence                        — website (Woo) gateway money
//   OUT  חשבונית זיכוי (refund)                      — money returned
//   OUT  manual credit evidence
//
// NOT money: חשבון עסקה ('deal') and חשבונית מס ('invoice') are billing paper —
// a customer can hold an invoice for a year without paying it. Open payment
// links and pending Cardcom requests are intent, not money; a paid Cardcom
// request auto-issues a receipt-type document, and THAT is when it counts.
//
// ── Why a receipt and its invoice are not two payments ───────────────────────
// Structurally, not by de-duplication: only receipt-type documents are ever
// added. An invoice closed by a receipt contributes nothing on its own, so the
// pair can only ever be counted once. The same holds for a חשבון עסקה closed by
// a חשבונית מס קבלה. Cardcom/Woo payments reach GOS as iCount receipt documents,
// so they arrive through the same single door.
//
// ── Amount signs ─────────────────────────────────────────────────────────────
// iCount reports credit notes with a NEGATIVE total. GOS stores IcountDocument
// and DealCollectionEvidence amounts as ALWAYS POSITIVE; the direction lives in
// the doctype / evidence direction and is applied here. That way a sign error in
// imported data can never silently invert a balance.

export const RECEIPT_DOCTYPES = ['receipt', 'invrec'];
export const REFUND_DOCTYPE = 'refund';
const COLLECTION_DOCTYPES = [...RECEIPT_DOCTYPES, REFUND_DOCTYPE];
// Billing paper — surfaced to the operator as context, never as payment.
const BILLING_DOCTYPES = ['deal', 'invoice'];

// Per-line VAT rounding can leave a few agorot either way, and an operator
// should not see "₪0.03 outstanding" on a deal that is settled. Deliberately
// TEN AGOROT and not more: a genuine shortfall — even a symbolic one — is a
// real collection fact the operator must see, not something to absorb. Any
// larger gap between the deal total and the documents is exactly the
// "amounts conflict materially" case that belongs in review.
const ROUNDING_TOLERANCE_MINOR = 10;

export const EVIDENCE_KIND_LABELS = {
  manual_payment: 'תשלום ידני',
  manual_credit: 'זיכוי ידני',
  settlement: 'סגירת יתרה ידנית',
  // Machine-recorded website payment (Woo order webhook) — money received by
  // the store's own gateway. origin 'woo', never operator-attested.
  woo_payment: 'תשלום באתר',
};

const num = (v) => Number(v ?? 0);

// The money a document contributes TO THIS DEAL.
//
//   • allocationMinor wins when set. It exists for SHARED HISTORICAL documents
//     — one consolidated document that settles several deals — where the amount
//     this deal counts is its own payable total, not the document's face value.
//     Linking a ₪30,745 receipt to twenty deals must settle twenty deals, not
//     show ₪30,745 outstanding-and-paid on each of them.
//   • otherwise `totalpaid`: a PARTIAL receipt records less than its face value,
//     and the money received is what counts.
//   • otherwise the gross (older rows, GOS-issued documents).
//
// The company-level total is a DIFFERENT question and is answered separately by
// companyCollectionTotals(), which dedupes by document identity.
function documentMoneyMinor(d) {
  if (d.allocationMinor != null) return Math.abs(num(d.allocationMinor));
  if (d.paidMinor != null) {
    const paid = Math.abs(num(d.paidMinor));
    if (paid > 0) return paid;
  }
  return Math.abs(num(d.amountMinor));
}

// ── Row projection ───────────────────────────────────────────────────────────
// The evidence list the UI renders. Every row states its OWN provenance, so a
// verified accounting document and an operator's note can never look alike.
//   verified  — an iCount document GOS issued or confirmed against the provider
//   provider  — an iCount document captured from a provider webhook (Cardcom/Woo
//               settle through iCount, so they arrive as documents)
//   manual    — operator-attested money, no accounting document behind it
// What attaching this document MEANS, in business language — the one thing an
// operator cannot infer from a document number alone.
function paymentMeaning(doctype, cancelled) {
  if (cancelled) return 'מסמך מבוטל — אינו נספר';
  if (doctype === REFUND_DOCTYPE) return 'זיכוי — מופחת מהגבייה';
  if (RECEIPT_DOCTYPES.includes(doctype)) return 'הוכחת תשלום';
  return 'מסמך חיוב — אינו הוכחת תשלום';
}

function documentRow(d) {
  const isMoney = COLLECTION_DOCTYPES.includes(d.doctype);
  const cancelled = d.status === 'cancelled';
  return {
    id: d.id,
    rowType: 'document',
    evidenceClass: d.sharedHistorical
      ? 'shared'
      : d.source === 'webhook'
        ? 'provider'
        : 'verified',
    doctype: d.doctype,
    doctypeLabel: DOC_TYPE_LABELS[d.doctype] || d.doctype,
    docnum: d.docnum || null,
    // Everything the panel must show beside the number.
    issuedAt: d.issuedAt || null,
    status: d.status,
    cancelled,
    paymentMeaning: paymentMeaning(d.doctype, cancelled),
    clientVatId: d.clientVatId || null,
    counts: isMoney && !cancelled,
    direction: d.doctype === REFUND_DOCTYPE ? 'out' : 'in',
    amountMinor: Math.abs(num(d.amountMinor)),
    countedMinor: isMoney && !cancelled ? documentMoneyMinor(d) : 0,
    currency: d.currency || 'ILS',
    clientName: d.clientName || null,
    docUrl: d.docUrl || null,
    // A shared historical document must SAY so wherever it appears — an
    // operator seeing "paid" on this deal is entitled to know the same document
    // also settles others, and that company totals count it once.
    sharedHistorical: !!d.sharedHistorical,
    documentAmountMinor: Math.abs(num(d.amountMinor)),
    // The document's REAL accounting date; the row's write time is only a
    // fallback for documents GOS issued itself (where they coincide).
    occurredAt: d.issuedAt || d.createdAt,
    source: d.source || 'user',
    linkConfidence: d.linkConfidence || null,
    linkReason: d.linkReason || null,
    verifiedAt: d.verifiedAt || null,
    basedOn: d.basedOnDoctype && d.basedOnDocnum
      ? { doctype: d.basedOnDoctype, docnum: d.basedOnDocnum, label: DOC_TYPE_LABELS[d.basedOnDoctype] || d.basedOnDoctype }
      : null,
  };
}

function evidenceRow(e) {
  return {
    id: e.id,
    rowType: 'evidence',
    // Machine-recorded provider money (Woo) renders as provider evidence, so
    // it can never be mistaken for an operator's manual attestation.
    evidenceClass: e.origin === 'woo' ? 'provider' : 'manual',
    kind: e.kind,
    kindLabel: EVIDENCE_KIND_LABELS[e.kind] || e.kind,
    counts: true,
    direction: e.direction,
    amountMinor: Math.abs(num(e.amountMinor)),
    countedMinor: Math.abs(num(e.amountMinor)),
    currency: e.currency || 'ILS',
    method: e.method || null,
    reference: e.reference || null,
    note: e.note || null,
    fileId: e.fileId || null,
    occurredAt: e.paidAt,
    createdAt: e.createdAt,
    createdByName: e.createdByName || null,
    origin: e.origin || 'operator',
  };
}

// ── The calculation ──────────────────────────────────────────────────────────
// Pure. `deal` supplies the agreed total + currency + review flag; `documents`
// are IcountDocument rows already filtered to status 'issued'; `evidence` are
// DealCollectionEvidence rows already filtered to status 'active'.
export function computeCollection(deal, documents = [], evidence = []) {
  const total = num(deal?.totalMinor ?? deal?.valueMinor);
  const currency = deal?.currency || 'ILS';

  const docRows = (documents || []).map(documentRow);
  const evRows = (evidence || []).map(evidenceRow);
  const moneyRows = [...docRows, ...evRows].filter((r) => r.counts);

  // Currencies are never silently combined. Anything that moved money in a
  // currency other than the deal's is reported, and the deal goes to review
  // rather than producing a number that adds shekels to dollars.
  const foreignCurrencies = [
    ...new Set(moneyRows.filter((r) => r.currency !== currency).map((r) => r.currency)),
  ];

  let paid = 0;
  let credited = 0;
  let lastPaymentAt = null;
  for (const r of moneyRows) {
    if (r.currency !== currency) continue; // counted only through the review flag
    if (r.direction === 'out') {
      credited += r.countedMinor;
    } else {
      paid += r.countedMinor;
      if (r.occurredAt && (!lastPaymentAt || new Date(r.occurredAt) > new Date(lastPaymentAt))) {
        lastPaymentAt = r.occurredAt;
      }
    }
  }

  const net = paid - credited;
  const balance = total - net;
  const paidPct = total > 0 ? Math.round((net / total) * 100) : null;

  // Status ladder. `review` OUTRANKS every computed answer: when the evidence
  // is contradictory the honest output is "a human must look", not a confident
  // number — but the numbers are still returned beside it.
  const review = normalizeReview(deal?.collectionReview, foreignCurrencies);
  let status;
  if (review) status = 'review';
  else if (total <= 0) status = 'no_amount';
  else if (net <= 0) status = 'unpaid';
  else if (balance > ROUNDING_TOLERANCE_MINOR) status = 'partial';
  else if (balance < -ROUNDING_TOLERANCE_MINOR) status = 'overpaid';
  else status = 'paid';

  // Rows are shown newest-first by their real accounting date.
  const rows = [...docRows, ...evRows].sort(
    (a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0),
  );

  return {
    totalMinor: total,
    paidMinor: net,
    grossPaidMinor: paid,
    creditedMinor: credited,
    balanceMinor: balance,
    paidPct,
    status,
    currency,
    lastPaymentAt,
    review,
    foreignCurrencies,
    // `payments` keeps its historical name (money movements only) so existing
    // callers do not change meaning; `evidence` is the full picture including
    // billing paper.
    payments: rows.filter((r) => r.counts),
    billingDocuments: docRows.filter((r) => BILLING_DOCTYPES.includes(r.doctype)),
    evidence: rows,
  };
}

// A review flag is either the deal's stored one, or one derived here because
// the numbers themselves are not combinable. Stored flags that were already
// cleared are inert.
function normalizeReview(stored, foreignCurrencies) {
  if (Array.isArray(foreignCurrencies) && foreignCurrencies.length) {
    return {
      code: 'currency_mismatch',
      reason: `התקבל תשלום במטבע שונה ממטבע העסקה (${foreignCurrencies.join(', ')}) — לא ניתן לחבר מטבעות.`,
      details: { foreignCurrencies },
      derived: true,
    };
  }
  if (!stored || typeof stored !== 'object') return null;
  if (stored.clearedAt) return null;
  if (!stored.code && !stored.reason) return null;
  return {
    code: stored.code || 'manual',
    reason: stored.reason || '',
    details: stored.details || null,
    flaggedAt: stored.flaggedAt || null,
    derived: false,
  };
}

// Back-compat shim for the payment-row projection (kept: several tests and the
// webhook path import it).
export function paymentRows(docs) {
  return (docs || []).filter((d) => COLLECTION_DOCTYPES.includes(d.doctype)).map(documentRow);
}

// ── Data access — ONE query shape, reused by both surfaces ───────────────────

// Cancelled documents are excluded at the QUERY level: a voided document must
// never reach the math, not even to be filtered out later.
const DOC_WHERE = { status: 'issued' };
const EVIDENCE_WHERE = { status: 'active' };

async function loadEvidence(prisma, dealIds) {
  const [documents, evidence] = await Promise.all([
    prisma.icountDocument.findMany({
      where: { dealId: { in: dealIds }, ...DOC_WHERE },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.dealCollectionEvidence.findMany({
      where: { dealId: { in: dealIds }, ...EVIDENCE_WHERE },
      orderBy: { paidAt: 'desc' },
    }),
  ]);
  return { documents, evidence };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

// Single-deal summary — what the Deal גבייה card renders.
export async function dealCollection(prisma, deal) {
  const { documents, evidence } = await loadEvidence(prisma, [deal.id]);
  return computeCollection(deal, documents, evidence);
}

// Batch summaries for a set of deals — the ONE way any other module asks "is
// this deal collected?". Two bulk queries regardless of the deal count, and the
// identical math the Deal card uses. Callers must never assemble the document
// query themselves: doing so is how a surface quietly starts ignoring manual
// payments or counting cancelled documents.
// `deals` must carry id + valueMinor + currency + collectionReview.
export async function collectionSummariesFor(prisma, deals) {
  const list = deals || [];
  if (!list.length) return new Map();
  const { documents, evidence } = await loadEvidence(prisma, list.map((d) => d.id));
  const docsByDeal = groupBy(documents, 'dealId');
  const evByDeal = groupBy(evidence, 'dealId');
  return new Map(
    list.map((d) => [d.id, computeCollection(d, docsByDeal.get(d.id) || [], evByDeal.get(d.id) || [])]),
  );
}

// A deal "requires collection" when the money has not fully arrived — including
// WON deals that were never priced (no_amount) and deals whose evidence is
// contradictory (review): those are exactly the deals that fall through cracks.
export function requiresCollection(summary) {
  return summary.status !== 'paid';
}

// ── Company-level totals ─────────────────────────────────────────────────────
// The per-deal question ("is this deal settled?") and the company question
// ("how much money came in?") have DIFFERENT answers whenever one document
// settles several deals, and conflating them is how a consolidated receipt
// turns into fictional revenue.
//
// Per deal:    a shared document contributes the deal's own payable total.
// Company-wide: each DOCUMENT contributes its own amount exactly ONCE, no
//               matter how many deals it is linked to.
//
// Manual evidence is per-deal by nature (an operator records money for one
// deal), so it is summed as-is — but it is reported on its own line, never
// blended into the provider-verified figure.
export async function companyCollectionTotals(prisma, { currency = 'ILS' } = {}) {
  const [docs, evidence, deals] = await Promise.all([
    prisma.icountDocument.findMany({
      where: { status: 'issued', doctype: { in: COLLECTION_DOCTYPES }, currency },
      select: {
        dealId: true, doctype: true, docnum: true, amountMinor: true,
        paidMinor: true, sharedHistorical: true, allocationMinor: true,
      },
    }),
    prisma.dealCollectionEvidence.findMany({
      where: { status: 'active', currency },
      select: { direction: true, amountMinor: true },
    }),
    prisma.deal.findMany({ where: { status: 'won', currency }, select: { valueMinor: true } }),
  ]);

  // Dedupe by DOCUMENT IDENTITY. A document with no number (should not happen,
  // but data is data) falls back to its row id so it is never merged with
  // another document by accident.
  const seen = new Map();
  for (const d of docs) {
    const key = d.docnum ? `${d.doctype}:${d.docnum}` : `row:${d.dealId}:${d.doctype}`;
    if (seen.has(key)) {
      seen.get(key).dealIds.add(d.dealId);
      continue;
    }
    seen.set(key, {
      doctype: d.doctype,
      // The DOCUMENT's own money, never the per-deal allocation.
      money: d.paidMinor != null && Math.abs(num(d.paidMinor)) > 0
        ? Math.abs(num(d.paidMinor))
        : Math.abs(num(d.amountMinor)),
      shared: !!d.sharedHistorical,
      dealIds: new Set([d.dealId]),
    });
  }

  let received = 0;
  let refunded = 0;
  let sharedDocs = 0;
  let sharedFaceValue = 0;
  let sharedLinks = 0;
  for (const v of seen.values()) {
    if (v.doctype === REFUND_DOCTYPE) refunded += v.money;
    else received += v.money;
    if (v.shared || v.dealIds.size > 1) {
      sharedDocs += 1;
      sharedFaceValue += v.money;
      sharedLinks += v.dealIds.size;
    }
  }

  let manualIn = 0;
  let manualOut = 0;
  for (const e of evidence) {
    if (e.direction === 'out') manualOut += Math.abs(num(e.amountMinor));
    else manualIn += Math.abs(num(e.amountMinor));
  }

  const wonValue = deals.reduce((s, d) => s + num(d.valueMinor), 0);
  const collected = received - refunded + manualIn - manualOut;
  return {
    currency,
    wonValueMinor: wonValue,
    // Provider-verified money, each document counted once.
    documentsReceivedMinor: received,
    documentsRefundedMinor: refunded,
    uniqueDocuments: seen.size,
    // Operator-attested money, reported separately on purpose.
    manualReceivedMinor: manualIn,
    manualRefundedMinor: manualOut,
    collectedMinor: collected,
    outstandingMinor: wonValue - collected,
    sharedDocuments: {
      documents: sharedDocs,
      faceValueMinor: sharedFaceValue,
      dealLinks: sharedLinks,
      note:
        'מסמכים משותפים סוגרים כמה עסקאות אך נספרים פעם אחת בלבד בסך הגבייה של החברה.',
    },
  };
}

// The Collection screen's rows: every WON deal that still requires collection.
// Two bulk queries for the whole population (no N+1), and the SAME
// computeCollection the Deal card uses — the two surfaces cannot disagree.
// `reviewStatus` filters the OPERATIONAL work queue — which deals a human
// should be chasing. It changes nothing about the money: every row's numbers
// still come from computeCollection() below, and requiresCollection() still
// decides what "not settled" means. Passing null returns the full accounting
// picture, exactly as before this filter existed.
export async function collectionDeals(prisma, { reviewStatus = null } = {}) {
  const deals = await prisma.deal.findMany({
    where: {
      status: 'won',
      ...(reviewStatus ? { collectionReviewStatus: reviewStatus } : {}),
    },
    orderBy: { wonAt: 'desc' },
    include: {
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
      // Operational context the work queue filters on. Read-only — none of it
      // enters the collection math.
      product: { select: { id: true, nameHe: true } },
      // A ProductVariant has no name of its own — it IS a Product × Location
      // pair, and its identity to an operator is the city.
      productVariant: { select: { id: true, location: { select: { nameHe: true } } } },
      location: { select: { id: true, nameHe: true } },
      // The guide is a property of the TOUR, reached through the deal's live
      // booking — the same canonical relationship the Tours module uses.
      bookings: {
        where: { status: 'active' },
        select: {
          tourEvent: {
            select: {
              date: true,
              // TourAssignment carries a displayName snapshot alongside its PersonRef —
              // the canonical way the Tours module reads a guide name.
              assignments: { select: { role: true, displayName: true, personRef: { select: { displayName: true } } } },
            },
          },
        },
      },
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: {
          contact: {
            select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
          },
        },
      },
    },
  });
  if (!deals.length) return [];
  const { documents, evidence } = await loadEvidence(prisma, deals.map((d) => d.id));
  const docsByDeal = groupBy(documents, 'dealId');
  const evByDeal = groupBy(evidence, 'dealId');

  return deals
    .map((deal) => {
      const summary = computeCollection(deal, docsByDeal.get(deal.id) || [], evByDeal.get(deal.id) || []);
      if (!requiresCollection(summary)) return null;
      const c = deal.contacts[0]?.contact || null;
      const contactName = c
        ? `${c.firstNameHe || c.firstNameEn || ''} ${c.lastNameHe || c.lastNameEn || ''}`.trim()
        : null;
      return {
        id: deal.id,
        // For the business-facing Deal URL (dealPath) on the Collection screen.
        orderNo: deal.orderNo,
        title: deal.title,
        wonAt: deal.wonAt,
        tourDate: deal.tourDate,
        ownerUserId: deal.ownerUserId || null,
        organization: deal.organization,
        organizationUnit: deal.organizationUnit,
        primaryContactName: contactName || null,
        // ── Operational context for the work queue's filters ───────────────
        // Presentation/filtering only; none of it touches the numbers below.
        collectionReviewStatus: deal.collectionReviewStatus || null,
        collectionReviewStatusSource: deal.collectionReviewStatusSource || null,
        // Deposit-vs-full payment review (see schema) — presentation/filtering
        // only; the money stays computeCollection()'s answer.
        paymentReviewStatus: deal.paymentReviewStatus || null,
        paymentReviewSource: deal.paymentReviewSource || null,
        activityType: deal.activityType || null,
        product: deal.product ? { id: deal.product.id, name: deal.product.nameHe } : null,
        productVariant: deal.productVariant
          ? { id: deal.productVariant.id, name: deal.productVariant.location?.nameHe || null }
          : null,
        // The deal's operational city — usually the variant's location, but it
        // may be a manual override, which is why it is read from the deal.
        city: deal.location ? { id: deal.location.id, name: deal.location.nameHe } : null,
        // Business when an organisation is linked (the canonical rule — a
        // linked org IS the classification SSOT) or when explicitly classified.
        customerKind: deal.organizationId || deal.activityType === 'business' ? 'business' : 'private',
        guides: [
          ...new Set(
            (deal.bookings || [])
              .flatMap((b) => b.tourEvent?.assignments || [])
              .map((a) => a.personRef?.displayName || a.displayName)
              .filter(Boolean),
          ),
        ],
        createdAt: deal.createdAt,
        ...summary,
        // The screen's table does not need the full evidence payload.
        payments: undefined,
        evidence: undefined,
        billingDocuments: undefined,
        evidenceCount: summary.payments.length,
      };
    })
    .filter(Boolean);
}
