import crypto from 'node:crypto';
import { createLowProfile, getLpResult, isCardcomConfigured, SUPPORTED_CURRENCIES } from './cardcom.js';
import { ICOUNT_DEAL_INCLUDE, issueDocument, systemOrigin } from './icountDocs.js';
import { emitTimelineEvent, userOrigin } from './timeline/events.js';
import { newPaymentToken, pickPaymentContact, resolvePublicOrigin } from './dealPayment.js';

// Cardcom tourist-payment domain logic — the "קישור לתשלום כרטיס תייר" flow.
//
// Lifecycle model (business rule):
//   PENDING → synchronized with the Deal. The Deal stays the Single Source of
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

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

// The deal shape needed to prefill/freeze a request (product English name on top
// of the accounting include, which the auto-issue path also uses).
export const TOURIST_DEAL_INCLUDE = {
  ...ICOUNT_DEAL_INCLUDE,
  product: { select: { nameHe: true, nameEn: true } },
};

function contactNames(contact) {
  const en = [contact?.firstNameEn, contact?.lastNameEn].filter(Boolean).join(' ').trim();
  const he = [contact?.firstNameHe, contact?.lastNameHe].filter(Boolean).join(' ').trim();
  return { en, he };
}

// VAT treatment is inherited from the Deal pricing builder: exempt only when the
// working quote has lines and EVERY active line is VAT-exempt (export). Mixed or
// no lines → not exempt (iCount's configured rate applies). Frozen at creation.
function dealVatExempt(deal) {
  const lines = deal.quoteVersions?.[0]?.lines || [];
  return lines.length > 0 && lines.every((l) => l.vatMode === 'exempt');
}

// Modal prefill — customer-facing values + the English product, straight from
// the Deal. `deal` must be loaded with TOURIST_DEAL_INCLUDE.
export function buildTouristDefaults(deal) {
  const contact = pickPaymentContact(deal.contacts)?.contact || null;
  const { en, he } = contactNames(contact);
  return {
    cardcomConfigured: isCardcomConfigured(),
    supportedCurrencies: SUPPORTED_CURRENCIES,
    customerName: en || he || deal.organization?.name || '',
    customerEmail: contact?.emails?.[0]?.value || '',
    customerPhone: contact?.phones?.[0]?.value || '',
    productDescriptionEn: deal.product?.nameEn || '',
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
  return {
    quantity,
    productDescriptionEn,
    customerName: String(input.customerName || '').trim() || null,
    customerEmail: String(input.customerEmail || '').trim() || null,
    customerPhone: String(input.customerPhone || '').trim() || null,
  };
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
  };
}

export function publicPaymentUrl(req, token) {
  return `${resolvePublicOrigin(req)}/payment/cardcom/${token}`;
}

// The deal's active (pending) cardcom request, or null. Enforces the one-active
// invariant at read time (the DB partial unique index enforces it at write time).
export async function findPendingRequest(prisma, dealId) {
  return prisma.paymentRequest.findFirst({
    where: { dealId, provider: 'cardcom', status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
}

// Create a new request, OR reopen+update the existing pending one (business
// invariant: one active tourist link per deal). Concurrency-safe: a racing
// second create hits the partial unique index (P2002) and reopens the winner.
export async function createOrReopenRequest(prisma, deal, input, userId) {
  const existing = await findPendingRequest(prisma, deal.id);
  if (existing) return editRequest(prisma, deal, existing, input, userId, { reopened: true });

  const op = normalizeOperatorInput(input);
  const biz = dealBusinessFields(deal);
  if (biz.amountMinor <= 0n) throw codedError('amount_missing');
  const fields = { ...op, ...biz };
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
      const winner = await findPendingRequest(prisma, deal.id);
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
  if (req.status !== 'pending') throw codedError('request_not_editable');
  const op = normalizeOperatorInput(input);
  const biz = dealBusinessFields(deal);
  const fields = { ...op, ...biz };
  const pageChanged =
    String(req.amountMinor) !== String(fields.amountMinor) ||
    req.currency !== fields.currency ||
    req.productDescriptionEn !== fields.productDescriptionEn ||
    (req.customerName || null) !== fields.customerName ||
    (req.customerEmail || null) !== fields.customerEmail ||
    (req.customerPhone || null) !== fields.customerPhone;
  const changed = pageChanged || req.quantity !== fields.quantity || req.vatExempt !== fields.vatExempt;

  const request = await prisma.paymentRequest.update({
    where: { id: req.id },
    data: {
      ...fields,
      // Force LowProfile regeneration on next open when the page inputs drifted.
      ...(pageChanged ? { cardcomLowProfileId: null, cardcomPayUrl: null, snapshotHash: snapshotHashOf(fields) } : {}),
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
// own changelog events; this sync adds no timeline noise). The English
// description follows the Deal's PRODUCT only when the product itself changed
// (and has an English name) — the wording stays operator-owned otherwise.
// Paid/canceled requests are never touched (frozen forever).
export async function syncPendingRequestWithDeal(prisma, deal, req) {
  if (!req || req.status !== 'pending') return req;
  const biz = dealBusinessFields(deal);
  const productDescriptionEn =
    req.productId !== biz.productId && deal.product?.nameEn
      ? deal.product.nameEn
      : req.productDescriptionEn;
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

// Cancel a pending request → the GOS link becomes unusable, a timeline event is
// written. No-op-safe if already terminal.
export async function cancelRequest(prisma, req, userId) {
  if (req.status !== 'pending') throw codedError('request_not_cancelable');
  const request = await prisma.paymentRequest.update({
    where: { id: req.id },
    data: { status: 'canceled', cardcomLowProfileId: null, cardcomPayUrl: null },
  });
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
export async function ensureCurrentCardcomLowProfile(prisma, req, { req: httpReq } = {}) {
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
  const webHookUrl = origin && secret ? `${origin}/api/webhooks/cardcom/${secret}` : null;
  const backUrl = `${origin}/payment/cardcom/${req.token}`;

  const { lowProfileId, url, raw } = await createLowProfile({
    amountMajor: Number(req.amountMinor) / 100,
    currency: req.currency,
    productName: req.productDescriptionEn,
    returnValue: req.token, // echoed back on the webhook / result → correlates
    webHookUrl,
    successUrl: backUrl,
    failedUrl: backUrl,
    language: DOC_LANG,
  });

  await prisma.paymentRequest.update({
    where: { id: req.id },
    data: { cardcomLowProfileId: lowProfileId, cardcomPayUrl: url, snapshotHash: currentHash, rawProviderResponse: raw ?? undefined },
  });
  return url;
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
export async function markPaidFromResult(prisma, req, result) {
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
  const won = await prisma.$transaction(async (tx) => {
    const upd = await tx.paymentRequest.updateMany({
      where: { id: req.id, status: 'pending' },
      data: {
        status: 'paid',
        paidAt: new Date(),
        amountMinor: verifiedAmountMinor,
        cardcomTransactionId: result.transactionId || null,
        paidRaw: result.raw ?? undefined,
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

  // The document is generated from the PAID (frozen) values — never the Deal.
  await autoIssueDocument(prisma, paid, result);
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
        sendEmail: false, // never auto-send to the customer
        idempotencyKey: `cardcom:${lowProfileId}`,
        origin: systemOrigin(),
        source: 'webhook',
        sourceLabel: 'cardcom',
      },
      null,
    );
    await prisma.paymentRequest.update({ where: { id: req.id }, data: { docStatus: 'issued', icountDocumentId: doc.id } });
  } catch (err) {
    console.error(`[cardcom] auto-issue failed for request ${req.id}: ${err?.code || ''} ${err?.reason || err?.message || err}`);
    await prisma.paymentRequest.update({ where: { id: req.id }, data: { docStatus: 'failed' } });
    // Pinned note — payment is final; a document must be issued manually.
    await emitPinnedEvent(prisma, {
      dealId: req.dealId,
      kind: 'accounting',
      data: { event: 'cardcom_doc_pending', message: 'תשלום התקבל בקארדקום — נדרשת הפקת מסמך ידנית' },
      origin: systemOrigin(),
    });
  }
}

// Verify a Cardcom result server-side and mark the request paid. Used by the
// webhook. Returns a small status object.
export async function processCardcomResult(prisma, { token, lowProfileId }) {
  const req = token ? await prisma.paymentRequest.findUnique({ where: { token } }) : null;
  if (!req) return { ok: false, reason: 'request_not_found' };
  if (req.status !== 'pending') return { ok: true, reason: 'already_processed', alreadyProcessed: true };

  const result = await getLpResult(lowProfileId || req.cardcomLowProfileId);
  if (result.responseCode !== 0 || !result.approved) {
    return { ok: false, reason: 'not_approved', responseCode: result.responseCode };
  }
  // Defensive: the verified result's ReturnValue must match this request's token.
  if (result.returnValue && result.returnValue !== req.token) {
    return { ok: false, reason: 'return_value_mismatch' };
  }
  const outcome = await markPaidFromResult(prisma, req, result);
  return { ok: true, ...outcome };
}
