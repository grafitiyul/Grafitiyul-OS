import crypto from 'node:crypto';
import { createLowProfile, getLpResult, isCardcomConfigured, SUPPORTED_CURRENCIES } from './cardcom.js';
import { ICOUNT_DEAL_INCLUDE, issueDocument, systemOrigin } from './icountDocs.js';
import { emitTimelineEvent, userOrigin } from './timeline/events.js';
import { newPaymentToken, pickPaymentContact, resolvePublicOrigin } from './dealPayment.js';

// Cardcom tourist-payment domain logic — the "קישור לתשלום כרטיס תייר" flow.
//
// GOS is the source of truth: a PaymentRequest is a frozen payment INTENT with
// its own lifecycle (pending → paid | canceled). The customer always receives
// the stable GOS URL /payment/cardcom/<token>; the Cardcom LowProfile behind it
// is created LAZILY (only when the customer opens the link) and regenerated if
// the pending request was edited — the GOS URL never changes.
//
// Cardcom only clears (3DS tourist cards, configured on the terminal). It issues
// NO accounting document. After a verified payment we auto-issue the iCount
// document (fixed policy: חשבונית מס קבלה / invrec, English, GOS English product,
// VAT inherited from the Deal), reusing the existing issueDocument pipeline.
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

// Validate + normalize the editable fields shared by create and edit.
function normalizeInput(input) {
  const amountIls = Number(input.amountIls);
  if (!Number.isFinite(amountIls) || amountIls <= 0) throw codedError('amount_invalid');
  const currency = String(input.currency || 'ILS').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) throw codedError('currency_unsupported');
  const productDescriptionEn = String(input.productDescriptionEn || '').trim();
  if (!productDescriptionEn) throw codedError('product_description_required');
  const quantity = Math.max(1, Math.round(Number(input.quantity) || 1));
  return {
    amountMinor: BigInt(Math.round(amountIls * 100)),
    currency,
    quantity,
    productDescriptionEn,
    customerName: String(input.customerName || '').trim() || null,
    customerEmail: String(input.customerEmail || '').trim() || null,
    customerPhone: String(input.customerPhone || '').trim() || null,
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
  if (existing) return editRequest(prisma, existing, input, userId, { reopened: true });

  const fields = normalizeInput(input);
  const data = {
    dealId: deal.id,
    provider: 'cardcom',
    status: 'pending',
    token: newPaymentToken(),
    ...fields,
    vatExempt: dealVatExempt(deal),
    // Frozen GOS business identity (reporting/audit — not sent to Cardcom).
    productId: deal.productId || null,
    productVariantId: deal.productVariantId || null,
    quoteVersionId: deal.quoteVersions?.[0]?.id || null,
    snapshotHash: snapshotHashOf(fields),
    createdBy: userId || null,
  };

  let request;
  try {
    request = await prisma.paymentRequest.create({ data });
  } catch (e) {
    if (e?.code === 'P2002') {
      const winner = await findPendingRequest(prisma, deal.id);
      if (winner) return editRequest(prisma, winner, input, userId, { reopened: true });
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

// Edit a PENDING request (also the "reopen" path). Resets the Cardcom target so
// the next open regenerates the LowProfile — the GOS public URL is unchanged.
export async function editRequest(prisma, req, input, userId, { reopened = false } = {}) {
  if (req.status !== 'pending') throw codedError('request_not_editable');
  const fields = normalizeInput(input);
  const changed =
    String(req.amountMinor) !== String(fields.amountMinor) ||
    req.currency !== fields.currency ||
    req.productDescriptionEn !== fields.productDescriptionEn ||
    (req.customerName || null) !== fields.customerName ||
    (req.customerEmail || null) !== fields.customerEmail ||
    (req.customerPhone || null) !== fields.customerPhone ||
    req.quantity !== fields.quantity;

  const request = await prisma.paymentRequest.update({
    where: { id: req.id },
    data: {
      ...fields,
      // Force LowProfile regeneration on next open when the page inputs drifted.
      ...(changed ? { cardcomLowProfileId: null, cardcomPayUrl: null, snapshotHash: snapshotHashOf(fields) } : {}),
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
export async function markPaidFromResult(prisma, req, result) {
  // Atomic guard + pinned payment event — only the winner of the race emits.
  const won = await prisma.$transaction(async (tx) => {
    const upd = await tx.paymentRequest.updateMany({
      where: { id: req.id, status: 'pending' },
      data: {
        status: 'paid',
        paidAt: new Date(),
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
        amountIls: Number(req.amountMinor) / 100,
        currency: req.currency,
        transactionId: result.transactionId || null,
        cardLast4: result.cardLast4 || null,
        customerName: req.customerName,
        productDescriptionEn: req.productDescriptionEn,
      },
      origin: systemOrigin(),
    });
    return true;
  });
  if (!won) return { alreadyProcessed: true };

  await autoIssueDocument(prisma, req, result);
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
