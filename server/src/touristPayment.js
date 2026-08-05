import crypto from 'node:crypto';
import { createLowProfile, getLpResult, isCardcomConfigured, isoCoinId, SUPPORTED_CURRENCIES } from './cardcom.js';
import { emitPaymentCompleted, PAYMENT_SOURCE_LINK } from './payments/paymentCompleted.js';
import { settleDealWonFromPayment } from './deals/paymentWon.js';
import { ICOUNT_DEAL_INCLUDE, issueDocument, systemOrigin } from './icountDocs.js';
import { emitTimelineEvent, userOrigin } from './timeline/events.js';
import { newPaymentToken, pickPaymentContact, resolvePublicOrigin } from './dealPayment.js';
// Tourist Cardcom uses the PRODUCT-ONLY English resolver (Product.nameEn, no
// variant wording) — owner decision, Slice G. The variant-first resolver stays
// for agent-reservation surfaces only.
import { PRODUCT_LABEL_EN_INCLUDE, resolveTouristPaymentLabelEn } from './productLabelEn.js';
import { dealVatExempt } from './pricing/dealVat.js';

// Cardcom tourist-payment domain logic — the "קישור לתשלום כרטיס תייר" flow.
//
// CANONICAL STATE MACHINE (duplicate-payment protection):
//   pending → awaiting_payment → payment_returned → paid
//                              ↘ failed → (explicit retry) → pending
//   canceled from any payable state; 'expired' reserved.
//
//   * A LowProfile is minted at most once per attempt — DB compare-and-set
//     (ensureCurrentCardcomLowProfile), never an in-memory lock. Concurrent
//     opens converge on ONE stored session; refresh always reuses it.
//   * The customer RETURN URL is never proof of payment: it only moves the
//     request to payment_returned. Only server-side GetLpResult verification
//     (webhook or reconciliation) can mark paid / failed — and paid requires
//     the transaction identity + amount (+ currency when reported) to match,
//     otherwise the request is HELD (verifyHold) for office review.
//   * While payment_returned: no payment page, no new LowProfile, ever.
//
// Lifecycle model (business rule):
//   PENDING/AWAITING → synchronized with the Deal. The Deal stays the Single Source of
//   Truth for the BUSINESS fields (amount, currency, VAT treatment, product
//   identity, and the English description when the product changes): editing
//   the Deal automatically flows into the pending request on every read/open.
//   The customer keeps the exact same GOS URL /payment/cardcom/<token> — the
//   Cardcom LowProfile behind it is minted LAZILY on open and transparently
//   regenerated when the synced snapshot drifted. A second link is never needed.
//   Operator-owned fields (customer name/email/phone, English description
//   wording, quantity) live on the request and are edited via the modal.
//
//   PAID → frozen forever. The row records exactly what was actually paid: the
//   amount is taken from the VERIFIED Cardcom result (GetLpResult), never from a
//   newer Deal state, and no code path mutates a paid/canceled request.
//
// Cardcom only clears (3DS tourist cards, configured on the terminal). It issues
// NO accounting document. After a verified payment we auto-issue the iCount
// document (fixed policy: חשבונית מס קבלה / invrec, English, GOS English product,
// VAT inherited from the Deal), reusing the existing issueDocument pipeline —
// always from the paid (frozen) values.
//
// INVARIANT: at most one PENDING cardcom request per deal (DB partial unique
// index + reopen-on-conflict here).

const DOCTYPE = 'invrec'; // חשבונית מס קבלה — fixed accounting policy
const DOC_LANG = 'en'; // always English

// State sets (single home). ACTIVE = the partial-unique-index predicate — the
// one-active-request-per-deal invariant. PAYABLE = states where the public
// link may create/reuse a LowProfile and redirect to Cardcom.
export const ACTIVE_STATUSES = ['pending', 'awaiting_payment', 'payment_returned', 'failed'];
export const PAYABLE_STATUSES = ['pending', 'awaiting_payment'];
const EDITABLE_STATUSES = ['pending', 'awaiting_payment', 'failed'];

// GetLpResult calls are rate-limited per request via lastVerifyAt CAS — polling
// customers and the sweep can never stampede Cardcom.
const VERIFY_MIN_INTERVAL_MS = 10_000;

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// The deal shape needed to prefill/freeze a request: the accounting include
// (also used by the auto-issue path) plus the ENGLISH-STRICT product-label
// shape, so the canonical resolver can see the variant as well as the product.
export const TOURIST_DEAL_INCLUDE = {
  ...ICOUNT_DEAL_INCLUDE,
  ...PRODUCT_LABEL_EN_INCLUDE,
};

function contactNames(contact) {
  const en = [contact?.firstNameEn, contact?.lastNameEn].filter(Boolean).join(' ').trim();
  const he = [contact?.firstNameHe, contact?.lastNameHe].filter(Boolean).join(' ').trim();
  return { en, he };
}

// VAT treatment is inherited from the Deal pricing builder via THE canonical
// deal-level resolution (pricing/dealVat.js, on shared/vatMode.mjs): the
// order-level QuoteVersion.vatMode governs and 'inherit' lines follow it.
// (The previous local check read only line.vatMode, so an exempt ORDER whose
// lines inherit was wrongly treated as VAT-liable — the document-defaults bug
// class, reintroduced here.) Mixed orders → not exempt. Synced while pending.

// Modal prefill — customer-facing values + the English product, straight from
// the Deal. `deal` must be loaded with TOURIST_DEAL_INCLUDE.
//
// The English description prefills from THE canonical English-strict resolver
// (productLabelEn.js): variant commercial name → product name → nothing. It is
// never the Hebrew name (the customer reading the Cardcom page cannot read it)
// and never Deal.title. `productDescriptionEnSource` tells the modal whether it
// prefilled and from where, so it can warn instead of silently opening empty.
export function buildTouristDefaults(deal) {
  const contact = pickPaymentContact(deal.contacts)?.contact || null;
  const { en, he } = contactNames(contact);
  const productEn = resolveTouristPaymentLabelEn(deal);
  return {
    cardcomConfigured: isCardcomConfigured(),
    supportedCurrencies: SUPPORTED_CURRENCIES,
    customerName: en || he || deal.organization?.name || '',
    customerEmail: contact?.emails?.[0]?.value || '',
    customerPhone: contact?.phones?.[0]?.value || '',
    productDescriptionEn: productEn.label || '',
    productDescriptionEnSource: productEn.source,
    amountIls: Number(deal.valueMinor || 0n) / 100,
    currency: deal.currency || 'ILS',
    quantity: 1,
  };
}

// Validate + normalize the OPERATOR-owned fields (modal input). Business fields
// (amount / currency / VAT / product identity) are never taken from the modal —
// they derive from the Deal (see dealBusinessFields).
function normalizeOperatorInput(input) {
  const productDescriptionEn = String(input.productDescriptionEn || '').trim();
  if (!productDescriptionEn) throw codedError('product_description_required');
  const quantity = Math.max(1, Math.round(Number(input.quantity) || 1));
  const customerEmail = String(input.customerEmail || '').trim() || null;
  // "שלח את החשבונית ללקוח לאחר התשלום" — FROZEN onto the request at
  // create/update time (never re-read from UI state after payment). Requesting
  // it without a customer email is refused up front — the system must never
  // silently claim it will email a document it has no address for.
  const emailInvoiceToCustomer = input.emailInvoiceToCustomer === true;
  if (emailInvoiceToCustomer && !customerEmail) throw codedError('invoice_email_requires_customer_email');
  return {
    quantity,
    productDescriptionEn,
    customerName: String(input.customerName || '').trim() || null,
    customerEmail,
    customerPhone: String(input.customerPhone || '').trim() || null,
    emailInvoiceToCustomer,
  };
}

// THE decision: who owns the English wording after this write.
//
// Ownership is claimed ONLY by an explicit operator intent flag
// (`productDescriptionOverride: true`, sent by the modal when the operator
// actually edited the field) AND only when the text really differs from the
// canonical label — re-saving the canonical value is not an override.
//
// Everything else resolves to 'auto' and STORES THE CANONICAL LABEL, ignoring
// whatever text came in. That is what makes a QA restore, a migration script or
// any other machine write incapable of freezing stale wording: without the
// explicit flag, a write cannot invent operator ownership (#26617).
//
// The one exception: a deal with NO English label at all has no canonical value
// to fall back to, so any text there is necessarily human-authored and is
// recorded as an override rather than thrown away.
function resolveDescriptionOwnership(deal, submittedText, wantsOverride) {
  const canonical = resolveTouristPaymentLabelEn(deal).label;
  if (!canonical) {
    return { productDescriptionEn: submittedText, productDescriptionSource: 'operator' };
  }
  const claims = wantsOverride === true && submittedText !== canonical;
  return claims
    ? { productDescriptionEn: submittedText, productDescriptionSource: 'operator' }
    : { productDescriptionEn: canonical, productDescriptionSource: 'auto' };
}

// The business fields the DEAL owns while the request is pending — recomputed
// from the live Deal on every create / edit / sync, so a Deal edit through the
// normal workflow flows into the pending request automatically.
function dealBusinessFields(deal) {
  return {
    amountMinor: deal.valueMinor ?? 0n,
    currency: String(deal.currency || 'ILS').toUpperCase(),
    vatExempt: dealVatExempt(deal),
    productId: deal.productId || null,
    productVariantId: deal.productVariantId || null,
    quoteVersionId: deal.quoteVersions?.[0]?.id || null,
  };
}

// Fingerprint of the customer-visible fields the Cardcom page was built from —
// when it drifts (after an edit), the next open regenerates the LowProfile.
function snapshotHashOf(fields) {
  const basis = JSON.stringify([
    String(fields.amountMinor),
    fields.currency,
    fields.productDescriptionEn,
    fields.customerName || '',
    fields.customerEmail || '',
    fields.customerPhone || '',
  ]);
  return crypto.createHash('sha256').update(basis).digest('hex');
}

// Pinned Deal-timeline event (FOCUS area) — same pin convention as the iCount
// accounting events.
async function emitPinnedEvent(client, { dealId, kind, data, origin }) {
  const last = await client.timelineEntry.findFirst({
    where: { subjectType: 'deal', subjectId: dealId, isPinned: true, deletedAt: null },
    orderBy: { pinSortOrder: 'desc' },
    select: { pinSortOrder: true },
  });
  const entry = await emitTimelineEvent(client, { subjectType: 'deal', subjectId: dealId, kind, data, origin });
  return client.timelineEntry.update({
    where: { id: entry.id },
    data: { isPinned: true, pinSortOrder: (last?.pinSortOrder ?? -1) + 1 },
  });
}

export function toClientRequest(req) {
  return {
    id: req.id,
    status: req.status,
    token: req.token,
    currency: req.currency,
    amountIls: Number(req.amountMinor) / 100,
    quantity: req.quantity,
    productDescriptionEn: req.productDescriptionEn,
    customerName: req.customerName,
    customerEmail: req.customerEmail,
    customerPhone: req.customerPhone,
    docStatus: req.docStatus,
    paidAt: req.paidAt,
    createdAt: req.createdAt,
    // Frozen "email the invoice to the customer" choice + the delivery audit.
    emailInvoiceToCustomer: !!req.emailInvoiceToCustomer,
    invoiceEmailOutcome: req.invoiceEmailOutcome || null,
    // Who owns the English wording — drives the modal's override badge and
    // whether "reset to default" is offered.
    productDescriptionSource: req.productDescriptionSource || 'auto',
    // Operator visibility — payment-attempt lifecycle (Cardcom session, return,
    // webhook, verification) so the office can see exactly where a payment is.
    attemptNo: req.attemptNo ?? 1,
    cardcomLowProfileId: req.cardcomLowProfileId || null,
    returnedAt: req.returnedAt || null,
    webhookAt: req.webhookAt || null,
    lastVerifyAt: req.lastVerifyAt || null,
    failReason: req.failReason || null,
    verifyHold: req.verifyHold || null,
    needsReview: !!req.verifyHold || (req.status === 'payment_returned' && !!req.returnedAt && Date.now() - new Date(req.returnedAt).getTime() > 10 * 60 * 1000),
  };
}

export function publicPaymentUrl(req, token) {
  return `${resolvePublicOrigin(req)}/payment/cardcom/${token}`;
}

// The deal's active cardcom request (any non-terminal state), or null. Enforces
// the one-active invariant at read time (the DB partial unique index enforces
// it at write time).
export async function findActiveRequest(prisma, dealId) {
  return prisma.paymentRequest.findFirst({
    where: { dealId, provider: 'cardcom', status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
}

// Create a new request, OR reopen+update the existing pending one (business
// invariant: one active tourist link per deal). Concurrency-safe: a racing
// second create hits the partial unique index (P2002) and reopens the winner.
export async function createOrReopenRequest(prisma, deal, input, userId) {
  const existing = await findActiveRequest(prisma, deal.id);
  if (existing) return editRequest(prisma, deal, existing, input, userId, { reopened: true });

  const op = normalizeOperatorInput(input);
  const biz = dealBusinessFields(deal);
  if (biz.amountMinor <= 0n) throw codedError('amount_missing');
  const owned = resolveDescriptionOwnership(deal, op.productDescriptionEn, input.productDescriptionOverride);
  const fields = { ...op, ...biz, ...owned };
  const data = {
    dealId: deal.id,
    provider: 'cardcom',
    status: 'pending',
    token: newPaymentToken(),
    ...fields,
    snapshotHash: snapshotHashOf(fields),
    createdBy: userId || null,
  };

  let request;
  try {
    request = await prisma.paymentRequest.create({ data });
  } catch (e) {
    if (e?.code === 'P2002') {
      const winner = await findActiveRequest(prisma, deal.id);
      if (winner) return editRequest(prisma, deal, winner, input, userId, { reopened: true });
    }
    throw e;
  }

  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'accounting',
    data: {
      event: 'cardcom_link',
      amountIls: Number(request.amountMinor) / 100,
      currency: request.currency,
      productDescriptionEn: request.productDescriptionEn,
    },
    origin: await userOrigin(userId),
  });
  return { request, reopened: false };
}

// Edit a PENDING request's operator-owned fields (also the "reopen" path) AND
// resync the business fields from the Deal in the same write. Resets the
// Cardcom target when page inputs drifted — the GOS public URL is unchanged.
export async function editRequest(prisma, deal, req, input, userId, { reopened = false } = {}) {
  // payment_returned is FROZEN for editing: the customer may already have paid
  // and verification is in flight — nothing may change what they owe.
  if (!EDITABLE_STATUSES.includes(req.status)) throw codedError('request_not_editable');
  const op = normalizeOperatorInput(input);
  const biz = dealBusinessFields(deal);
  // Ownership is re-decided on every save: an operator edit claims it, and a
  // save WITHOUT the explicit flag (or one that just re-saves the canonical
  // text) hands it back to 'auto' — that is the reset-to-default path.
  const owned = resolveDescriptionOwnership(deal, op.productDescriptionEn, input.productDescriptionOverride);
  const fields = { ...op, ...biz, ...owned };
  const pageChanged =
    String(req.amountMinor) !== String(fields.amountMinor) ||
    req.currency !== fields.currency ||
    req.productDescriptionEn !== fields.productDescriptionEn ||
    (req.customerName || null) !== fields.customerName ||
    (req.customerEmail || null) !== fields.customerEmail ||
    (req.customerPhone || null) !== fields.customerPhone;
  const changed = pageChanged || req.quantity !== fields.quantity || req.vatExempt !== fields.vatExempt;

  // Editing a provider-verified FAILED request is the operator-side retry path:
  // the dead attempt is archived and the request returns to 'pending' (a fresh
  // LowProfile is minted on next open, attemptNo increments).
  const retryReset = req.status === 'failed' ? retryResetData(req) : null;

  const request = await prisma.paymentRequest.update({
    where: { id: req.id },
    data: {
      ...fields,
      // Force LowProfile regeneration on next open when the page inputs drifted.
      ...(pageChanged ? { cardcomLowProfileId: null, cardcomPayUrl: null, snapshotHash: snapshotHashOf(fields) } : {}),
      ...(retryReset || {}),
    },
  });

  if (changed && !reopened) {
    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: req.dealId,
      kind: 'accounting',
      data: {
        event: 'cardcom_link_updated',
        amountIls: Number(request.amountMinor) / 100,
        currency: request.currency,
        productDescriptionEn: request.productDescriptionEn,
      },
      origin: await userOrigin(userId),
    });
  }
  return { request, reopened };
}

// PENDING ↔ DEAL sync — the Deal stays the Single Source of Truth while the
// request is pending: recompute the business fields from the live Deal and
// silently update the row when they drifted (Deal edits already produce their
// own changelog events; this sync adds no timeline noise).
//
// The English description follows OWNERSHIP, not change-detection: an 'auto'
// row is kept EQUAL to the Deal's canonical English label on every read, so a
// product/variant change refreshes it and a value that went stale for any
// reason repairs itself on the next open. An 'operator' row is never touched.
//
// (The previous rule fired only when the request's stored identity differed
// from the Deal's. Any write that updated identity and wording together — a QA
// restore, a script, a product changed and changed back between opens —
// satisfied the trigger and froze stale wording forever. That is exactly how
// Deal #26617 ended up advertising a wall-mural package for a plain tour.)
// Paid/canceled requests are never touched (frozen forever).
export async function syncPendingRequestWithDeal(prisma, deal, req) {
  // Deal stays SSOT only while the request is still PAYABLE. Once the customer
  // returned (verification pending) or the request went terminal, it is frozen.
  if (!req || !PAYABLE_STATUSES.includes(req.status)) return req;
  const biz = dealBusinessFields(deal);
  // Same canonical English-strict resolver as the modal prefill — one mapping,
  // so the page can never disagree with what the operator was shown.
  const resolvedEn = resolveTouristPaymentLabelEn(deal).label;
  const productDescriptionEn =
    req.productDescriptionSource !== 'operator' && resolvedEn ? resolvedEn : req.productDescriptionEn;
  const changed =
    String(req.amountMinor) !== String(biz.amountMinor) ||
    req.currency !== biz.currency ||
    req.vatExempt !== biz.vatExempt ||
    (req.productId || null) !== biz.productId ||
    (req.productVariantId || null) !== biz.productVariantId ||
    (req.quoteVersionId || null) !== biz.quoteVersionId ||
    req.productDescriptionEn !== productDescriptionEn;
  if (!changed) return req;

  const pageChanged =
    String(req.amountMinor) !== String(biz.amountMinor) ||
    req.currency !== biz.currency ||
    req.productDescriptionEn !== productDescriptionEn;
  const fields = {
    ...biz,
    productDescriptionEn,
    customerName: req.customerName,
    customerEmail: req.customerEmail,
    customerPhone: req.customerPhone,
  };
  console.log(`[cardcom] pending request ${req.id} resynced from deal ${deal.id} (pageChanged=${pageChanged})`);
  return prisma.paymentRequest.update({
    where: { id: req.id },
    data: {
      ...biz,
      productDescriptionEn,
      // Page inputs drifted → the next open transparently mints a fresh
      // LowProfile; the customer's GOS URL never changes.
      ...(pageChanged ? { cardcomLowProfileId: null, cardcomPayUrl: null, snapshotHash: snapshotHashOf(fields) } : {}),
    },
  });
}

// The update-data that archives a provider-verified FAILED attempt and returns
// the request to 'pending' for a fresh attempt. THE only replacement policy:
// a proven failure — never a refresh, timeout, missing webhook or back-button.
function retryResetData(req) {
  const history = Array.isArray(req.attemptHistory) ? req.attemptHistory : [];
  return {
    status: 'pending',
    attemptNo: (req.attemptNo ?? 1) + 1,
    attemptHistory: [
      ...history,
      {
        attemptNo: req.attemptNo ?? 1,
        lowProfileId: req.cardcomLowProfileId || null,
        payUrl: req.cardcomPayUrl || null,
        failReason: req.failReason || null,
        returnedAt: req.returnedAt || null,
        archivedAt: new Date().toISOString(),
      },
    ],
    cardcomLowProfileId: null,
    cardcomPayUrl: null,
    snapshotHash: null,
    failReason: null,
    returnedAt: null,
    lastVerifyAt: null,
  };
}

// Customer-initiated retry after a provider-VERIFIED failure (the public failed
// page's "Try again"). CAS failed→pending so a double click / two tabs archive
// the dead attempt exactly once.
export async function retryAfterFailure(prisma, req) {
  if (req.status !== 'failed') return req;
  const upd = await prisma.paymentRequest.updateMany({
    where: { id: req.id, status: 'failed' },
    data: retryResetData(req),
  });
  if (upd.count > 0) console.log(`[cardcom] request ${req.id} retry after verified failure → attempt ${(req.attemptNo ?? 1) + 1}`);
  return prisma.paymentRequest.findUnique({ where: { id: req.id } });
}

// Customer returned from Cardcom (success redirect). CAS payable→payment_returned:
// from this moment the link NEVER shows a payment page again until verification
// resolves. The return itself proves nothing — verification is separate.
export async function markReturned(prisma, req) {
  const upd = await prisma.paymentRequest.updateMany({
    where: { id: req.id, status: { in: PAYABLE_STATUSES } },
    data: { status: 'payment_returned', returnedAt: new Date() },
  });
  if (upd.count > 0) console.log(`[cardcom] request ${req.id} → payment_returned (customer back from Cardcom)`);
  return prisma.paymentRequest.findUnique({ where: { id: req.id } });
}

// Cancel a pending request → the GOS link becomes unusable, a timeline event is
// written. No-op-safe if already terminal. payment_returned is NOT cancelable —
// the money may already be real; reconcile/hold must resolve it first.
export async function cancelRequest(prisma, req, userId) {
  if (!['pending', 'awaiting_payment', 'failed'].includes(req.status)) throw codedError('request_not_cancelable');
  // CAS — a racing verified-paid transition must win over a cancel click.
  const upd = await prisma.paymentRequest.updateMany({
    where: { id: req.id, status: { in: ['pending', 'awaiting_payment', 'failed'] } },
    data: { status: 'canceled', cardcomLowProfileId: null, cardcomPayUrl: null },
  });
  if (upd.count === 0) throw codedError('request_not_cancelable');
  const request = await prisma.paymentRequest.findUnique({ where: { id: req.id } });
  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: req.dealId,
    kind: 'accounting',
    data: { event: 'cardcom_link_canceled', amountIls: Number(request.amountMinor) / 100, currency: request.currency },
    origin: await userOrigin(userId),
  });
  return request;
}

// Ensure the request has a CURRENT Cardcom LowProfile and return its pay URL.
// Called ONLY from the public /payment/cardcom/<token> route (customer open) —
// never at create/edit, so editing a never-opened request creates zero
// LowProfiles. Reuses the active LowProfile when the snapshot still matches;
// regenerates (new LowProfile, same GOS token) when it drifted.
//
// CONCURRENCY (DB compare-and-set, no in-memory lock): two simultaneous opens
// may both call Cardcom, but only ONE result is persisted — the CAS is
// conditioned on the exact LowProfile id the caller read (usually null) AND on
// the request still being payable. The loser discards its orphan session
// (never exposed, never stored) and redirects to the winner's URL, so every
// customer converges on the single stored LowProfile. A request that raced
// into payment_returned/paid can NEVER be given a payment page: the CAS
// refuses and `state_changed` sends the route back to state dispatch.
export async function ensureCurrentCardcomLowProfile(prisma, req, { req: httpReq, deps = {} } = {}) {
  const mint = deps.createLowProfile || createLowProfile;
  if (!PAYABLE_STATUSES.includes(req.status)) throw codedError('state_changed');
  const currentHash = snapshotHashOf({
    amountMinor: req.amountMinor,
    currency: req.currency,
    productDescriptionEn: req.productDescriptionEn,
    customerName: req.customerName,
    customerEmail: req.customerEmail,
    customerPhone: req.customerPhone,
  });
  if (req.cardcomPayUrl && req.cardcomLowProfileId && req.snapshotHash === currentHash) {
    return req.cardcomPayUrl;
  }

  if (req.amountMinor <= 0n) throw codedError('amount_missing');
  if (!isCardcomConfigured()) throw codedError('cardcom_not_configured');

  const origin = String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '') || resolvePublicOrigin(httpReq);
  const secret = process.env.CARDCOM_WEBHOOK_SECRET;
  if (!secret) {
    // REFUSE to mint without a webhook receiver: the customer could pay for
    // real and GOS would never learn about it (no paid state, no document).
    // A clean failure now beats silent money later.
    console.error('[cardcom] refusing to mint LowProfile — CARDCOM_WEBHOOK_SECRET is not set (payment confirmations would never arrive)');
    throw codedError('cardcom_webhook_not_configured');
  }
  const webHookUrl = `${origin}/api/webhooks/cardcom/${secret}`;
  // Success/failure land on DISTINCT return URLs — the return handler moves the
  // request to payment_returned (success) or verifies the failure. Neither is
  // trusted as a payment outcome by itself.
  const successUrl = `${origin}/payment/cardcom/${req.token}/return?outcome=success`;
  const failedUrl = `${origin}/payment/cardcom/${req.token}/return?outcome=failed`;

  const { lowProfileId, url, raw } = await mint({
    amountMajor: Number(req.amountMinor) / 100,
    currency: req.currency,
    productName: req.productDescriptionEn,
    returnValue: req.token, // echoed back on the webhook / result → correlates
    webHookUrl,
    successUrl,
    failedUrl,
    language: DOC_LANG,
  });

  const won = await prisma.paymentRequest.updateMany({
    where: { id: req.id, status: { in: PAYABLE_STATUSES }, cardcomLowProfileId: req.cardcomLowProfileId ?? null },
    data: {
      cardcomLowProfileId: lowProfileId,
      cardcomPayUrl: url,
      snapshotHash: currentHash,
      status: 'awaiting_payment',
      rawProviderResponse: raw ?? undefined,
    },
  });
  if (won.count > 0) return url;

  // Lost the race — converge on whatever the winner stored (or refuse if the
  // request left the payable states while we were minting).
  console.warn(`[cardcom] request ${req.id}: concurrent mint lost the CAS — discarding orphan LowProfile ${lowProfileId}`);
  const fresh = await prisma.paymentRequest.findUnique({ where: { id: req.id } });
  if (!fresh || !PAYABLE_STATUSES.includes(fresh.status)) throw codedError('state_changed');
  if (fresh.cardcomPayUrl && fresh.cardcomLowProfileId && fresh.snapshotHash === currentHash) return fresh.cardcomPayUrl;
  throw codedError('state_changed');
}

// Mark a request PAID from a verified Cardcom result, exactly once, then
// best-effort auto-issue the iCount document. The pending→paid transition is a
// conditional update (guard) so concurrent webhook retries can't double-process.
// Payment success NEVER depends on the accounting document succeeding.
//
// FREEZE AT REALITY: the paid row must represent exactly what was actually
// charged, so the amount is taken from the VERIFIED GetLpResult value (never
// from a newer Deal state — e.g. the deal was edited after the customer opened
// the page). From this moment the request is immutable.
export async function markPaidFromResult(prisma, req, result, deps = {}) {
  const settleWon = deps.settleWon || settleDealWonFromPayment;
  const emitCompleted = deps.emitCompleted || emitPaymentCompleted;
  const issueDoc = deps.issueDoc || autoIssueDocument;
  const verifiedAmountMinor =
    Number.isFinite(result.amount) && result.amount > 0
      ? BigInt(Math.round(result.amount * 100))
      : req.amountMinor;
  if (verifiedAmountMinor !== req.amountMinor) {
    console.warn(
      `[cardcom] request ${req.id}: verified paid amount ${Number(verifiedAmountMinor) / 100} differs from stored ${Number(req.amountMinor) / 100} — freezing the verified amount`,
    );
  }
  const paid = { ...req, amountMinor: verifiedAmountMinor };

  // Atomic guard + pinned payment event — only the winner of the race emits.
  // Every ACTIVE state may become paid (verified money is reality even when the
  // customer is mid-return or the attempt was thought failed); canceled/paid
  // never transition, so duplicate webhooks / reconcile / out-of-order
  // notifications all converge on exactly one processing.
  const won = await prisma.$transaction(async (tx) => {
    const upd = await tx.paymentRequest.updateMany({
      where: { id: req.id, status: { in: ACTIVE_STATUSES } },
      data: {
        status: 'paid',
        paidAt: new Date(),
        amountMinor: verifiedAmountMinor,
        cardcomTransactionId: result.transactionId || null,
        paidRaw: result.raw ?? undefined,
        verifyHold: null,
        failReason: null,
      },
    });
    if (upd.count === 0) return false;
    await emitPinnedEvent(tx, {
      dealId: req.dealId,
      kind: 'accounting',
      data: {
        event: 'cardcom_payment',
        amountIls: Number(paid.amountMinor) / 100,
        currency: paid.currency,
        transactionId: result.transactionId || null,
        cardLast4: result.cardLast4 || null,
        customerName: paid.customerName,
        productDescriptionEn: paid.productDescriptionEn,
      },
      origin: systemOrigin(),
    });
    return true;
  });
  if (!won) return { alreadyProcessed: true };

  // A successful credit-card payment closes the deal: canonical WON transition
  // (status + final stage + Report #26), idempotent — an already-WON deal is a
  // no-op, and that no-op result IS the pre-payment status Report #1 needs.
  // Only the race winner settles, so a stale webhook replay can never re-close
  // a deliberately reopened deal. A settle failure must not fail the payment —
  // the money is real and recorded; the gap is logged for the office.
  let dealWasWonBeforePayment = false;
  try {
    const settle = await settleWon(prisma, {
      dealId: req.dealId,
      origin: systemOrigin(),
      paymentAmountMinor: verifiedAmountMinor,
      // Names the real source in Deal.wonActor / Report #26.
      cause: 'cardcom_payment',
    });
    dealWasWonBeforePayment = settle?.alreadyWon === true;
  } catch (err) {
    console.error(`[cardcom] WON settlement failed for deal ${req.dealId} (payment stays paid): ${err?.code || ''} ${err?.message || err}`);
  }

  // THE canonical online-payment-completion event. Only the race winner gets
  // here, so this is exactly-once per payment. Previously Cardcom completions
  // announced nothing at all — no trigger, no report could react to them.
  emitCompleted({
    dealId: req.dealId,
    amountMinor: verifiedAmountMinor, // the VERIFIED amount, never the deal total
    currency: paid.currency,
    provider: 'cardcom',
    reference: result.transactionId || req.token,
    source: PAYMENT_SOURCE_LINK,
    dealWasWonBeforePayment,
  });

  // The document is generated from the PAID (frozen) values — never the Deal.
  await issueDoc(prisma, paid, result);
  return { alreadyProcessed: false };
}

// Auto-issue the fixed accounting document (חשבונית מס קבלה, English, GOS English
// product, VAT inherited from the Deal). Idempotent via the Cardcom-derived key
// so webhook retries never create a second document. A single reconciled line
// (quantity 1 × the charged gross) guarantees the document total equals the
// amount actually cleared — `quantity` stays frozen on the request for reporting.
async function autoIssueDocument(prisma, req, result) {
  const grossIls = Number(req.amountMinor) / 100;
  const lowProfileId = req.cardcomLowProfileId || result.lowProfileId;
  try {
    const deal = await prisma.deal.findUnique({ where: { id: req.dealId }, include: ICOUNT_DEAL_INCLUDE });
    if (!deal) throw codedError('deal_missing');
    const { doc } = await issueDocument(
      prisma,
      deal,
      {
        doctype: DOCTYPE,
        lang: DOC_LANG,
        currency: req.currency,
        client: { name: req.customerName || 'Customer', email: req.customerEmail, phone: req.customerPhone },
        rows: [{ description: req.productDescriptionEn, quantity: 1, unitPriceIls: grossIls, vatExempt: req.vatExempt }],
        payments: [
          {
            method: 'cc',
            amount: grossIls,
            reference: result.transactionId || undefined,
            cardLast4: result.cardLast4 || undefined,
            holderName: req.customerName || undefined,
          },
        ],
        // Email to the customer ONLY when the operator froze that choice onto
        // the request ("שלח את החשבונית ללקוח לאחר התשלום"). Sent via the
        // proven iCount send_email-at-issue path; the idempotent doc creation
        // (cardcom:<lowProfileId>) makes the email exactly-once — a webhook
        // retry can neither re-issue nor re-send.
        sendEmail: req.emailInvoiceToCustomer === true && !!req.customerEmail,
        idempotencyKey: `cardcom:${lowProfileId}`,
        origin: systemOrigin(),
        source: 'webhook',
        sourceLabel: 'cardcom',
      },
      null,
    );
    // Immutable delivery audit: was email requested, and what happened.
    const invoiceEmailOutcome = req.emailInvoiceToCustomer
      ? (req.customerEmail ? 'sent' : 'skipped_no_email')
      : null;
    await prisma.paymentRequest.update({
      where: { id: req.id },
      data: { docStatus: 'issued', icountDocumentId: doc.id, invoiceEmailOutcome },
    });
  } catch (err) {
    console.error(`[cardcom] auto-issue failed for request ${req.id}: ${err?.code || ''} ${err?.reason || err?.message || err}`);
    await prisma.paymentRequest.update({
      where: { id: req.id },
      data: { docStatus: 'failed', ...(req.emailInvoiceToCustomer ? { invoiceEmailOutcome: 'doc_failed' } : {}) },
    });
    // Pinned note — payment is final; a document must be issued manually.
    await emitPinnedEvent(prisma, {
      dealId: req.dealId,
      kind: 'accounting',
      data: { event: 'cardcom_doc_pending', message: 'תשלום התקבל בקארדקום — נדרשת הפקת מסמך ידנית' },
      origin: systemOrigin(),
    });
  }
}

// Apply a VERIFIED GetLpResult to a request — THE single decision point for
// paid / failed / held. Never trusts anything but the provider result:
//   * transaction identity must exist (a bare ResponseCode 0 without a
//     transaction id never marks paid);
//   * ReturnValue (when echoed) must match this request's token;
//   * amount must match the request exactly; the reported currency (ISOCoinId,
//     when present) must match — any mismatch HOLDS the request (verifyHold)
//     for office review instead of auto-completing;
//   * an approved=false result WITH a transaction id is a proven failure.
async function applyVerifiedResult(prisma, req, result, deps = {}) {
  if (result.returnValue && result.returnValue !== req.token) {
    return { ok: false, reason: 'return_value_mismatch' };
  }
  if (result.responseCode !== 0) {
    // GetLpResult itself rejected (page not completed / unknown LowProfile) —
    // no payment evidence either way.
    return { ok: false, reason: 'not_completed', responseCode: result.responseCode };
  }
  if (!result.approved && result.transactionId) {
    // Proven failed attempt → 'failed' (retryable via the explicit retry path).
    const reason = result.failReason || `transaction declined (tx ${result.transactionId})`;
    const upd = await prisma.paymentRequest.updateMany({
      where: { id: req.id, status: { in: ACTIVE_STATUSES } },
      data: { status: 'failed', failReason: reason, paidRaw: result.raw ?? undefined },
    });
    if (upd.count > 0) console.warn(`[cardcom] request ${req.id} verified FAILED: ${reason}`);
    return { ok: true, failed: true, reason: 'verified_failed' };
  }
  if (!result.approved || !result.transactionId) {
    return { ok: false, reason: !result.transactionId ? 'no_transaction_identity' : 'not_approved' };
  }

  // Amount/currency verification — mismatch never auto-pays.
  const hold = [];
  const verifiedMinor = Number.isFinite(result.amount) && result.amount > 0 ? BigInt(Math.round(result.amount * 100)) : null;
  if (verifiedMinor !== null && verifiedMinor !== req.amountMinor) {
    hold.push(`amount ${Number(verifiedMinor) / 100} ≠ expected ${Number(req.amountMinor) / 100}`);
  }
  const reportedCoin = Number(result.raw?.TranzactionInfo?.CoinId ?? result.raw?.ISOCoinId ?? NaN);
  if (Number.isFinite(reportedCoin) && reportedCoin > 0 && reportedCoin !== isoCoinId(req.currency)) {
    hold.push(`currency ISOCoinId ${reportedCoin} ≠ expected ${isoCoinId(req.currency)} (${req.currency})`);
  }
  if (hold.length) {
    const verifyHold = hold.join('; ');
    await prisma.paymentRequest.updateMany({
      where: { id: req.id, status: { in: ACTIVE_STATUSES } },
      data: { status: 'payment_returned', verifyHold, paidRaw: result.raw ?? undefined },
    });
    console.error(`[cardcom] request ${req.id} verification HOLD (never auto-paid): ${verifyHold}`);
    return { ok: false, reason: 'verification_hold', hold: verifyHold };
  }

  const outcome = await markPaidFromResult(prisma, req, result, deps);
  return { ok: true, ...outcome };
}

// Reconciliation — the safe answer to a delayed/missing webhook. Queries the
// canonical Cardcom verification API (GetLpResult) for the request's OWN
// LowProfile, rate-limited per request via a lastVerifyAt CAS claim so page
// polling, the return handler and the בקרה sweep can never stampede the
// provider. Returns { state, held } — never guesses from redirects.
export async function reconcileCardcomRequest(prisma, req, { deps = {}, force = false } = {}) {
  const verify = deps.getLpResult || getLpResult;
  if (!req || !['payment_returned', 'awaiting_payment'].includes(req.status)) {
    return { state: req?.status || 'missing' };
  }
  if (!req.cardcomLowProfileId) return { state: req.status, reason: 'no_lowprofile' };

  const cutoff = new Date(Date.now() - VERIFY_MIN_INTERVAL_MS);
  const claim = await prisma.paymentRequest.updateMany({
    where: {
      id: req.id,
      status: req.status,
      ...(force ? {} : { OR: [{ lastVerifyAt: null }, { lastVerifyAt: { lt: cutoff } }] }),
    },
    data: { lastVerifyAt: new Date() },
  });
  if (claim.count === 0) {
    const fresh = await prisma.paymentRequest.findUnique({ where: { id: req.id } });
    return { state: fresh?.status || 'missing', held: !!fresh?.verifyHold };
  }

  try {
    const result = await verify(req.cardcomLowProfileId);
    await applyVerifiedResult(prisma, req, result, deps);
  } catch (err) {
    // Provider unreachable / result not ready — stay put; the poll page, the
    // webhook or the sweep will try again.
    console.warn(`[cardcom] reconcile ${req.id}: verification unavailable (${err?.code || ''} ${err?.reason || err?.message || err})`);
  }
  const fresh = await prisma.paymentRequest.findUnique({ where: { id: req.id } });
  return { state: fresh?.status || 'missing', held: !!fresh?.verifyHold };
}

// Verify a Cardcom result server-side and mark the request paid/failed/held.
// Used by the webhook (source='webhook') and by reconciliation replays.
export async function processCardcomResult(prisma, { token, lowProfileId }, { source = 'webhook', deps = {} } = {}) {
  const verify = deps.getLpResult || getLpResult;
  const req = token ? await prisma.paymentRequest.findUnique({ where: { token } }) : null;
  if (!req) return { ok: false, reason: 'request_not_found' };

  // First webhook arrival is stamped even if processing below can't complete —
  // operator visibility must show "Cardcom did call us".
  if (source === 'webhook' && !req.webhookAt) {
    await prisma.paymentRequest.updateMany({ where: { id: req.id, webhookAt: null }, data: { webhookAt: new Date() } });
  }

  if (req.status === 'paid') return { ok: true, reason: 'already_processed', alreadyProcessed: true };
  if (req.status === 'canceled') {
    // A canceled request can still receive a webhook for real money — never
    // auto-pay it, HOLD for office review (the בקרה detector surfaces it).
    await prisma.paymentRequest.updateMany({
      where: { id: req.id, status: 'canceled', verifyHold: null },
      data: { verifyHold: 'webhook received for a canceled request — verify manually' },
    });
    return { ok: false, reason: 'request_canceled' };
  }

  const result = await verify(lowProfileId || req.cardcomLowProfileId);
  return applyVerifiedResult(prisma, req, result, deps);
}
