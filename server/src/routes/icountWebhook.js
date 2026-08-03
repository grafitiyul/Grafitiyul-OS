import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { DOC_TYPE_LABELS, emitAccountingEvent, systemOrigin } from '../icountDocs.js';
import { settleDealWonFromPayment } from '../deals/paymentWon.js';
import { emitPaymentCompleted, PAYMENT_SOURCE_LINK } from '../payments/paymentCompleted.js';
import { logRejectedWebhook } from '../payments/webhookAudit.js';

// iCount doctypes that RECORD money received (a קבלה / חשבונית מס קבלה). Only
// these represent a completed payment — an invoice alone does not.
const PAID_DOCTYPES = new Set(['receipt', 'invrec']);

// iCount IPN receiver — audit log + BEST-EFFORT document capture.
//
// Personal payment links are generated once with ipn_url baked in, so without
// a live receiver every payment made through them would be permanently silent.
// The raw payload is ALWAYS persisted to IcountWebhookLog first and the route
// always answers 200 (iCount must never retry forever).
//
// On top of the log, when the payload carries a recognizable document identity
// (a known doctype + docnum) AND a dealId, the document is recorded as an
// IcountDocument row + the same PINNED accounting event the "הפק מסמך" modal
// creates — so a payment made through a payment link surfaces on the Deal.
// Idempotent: the row's idempotencyKey is derived from dealId+doctype+docnum,
// so a retried/duplicated IPN can never create a second note. Field names are
// extracted defensively (several observed spellings); an unrecognized payload
// simply stays log-only — NO deal/payment state is ever changed, nothing is
// marked paid.
//
// Auth: URL-path secret (ICOUNT_WEBHOOK_SECRET), same proven pattern as the
// Challenge System.

const router = Router();

// First non-empty value among several possible IPN field spellings.
function pick(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

// Best-effort document capture from a logged IPN payload. Never throws.
// Returns a small status object the route sequences on:
//   status — 'captured' | 'duplicate' | 'unrecognized' | 'error'
//   isPaid — the doctype records money received (receipt / invrec)
//   amountMinor / currency / doctype / docnum — parsed identity, when known
export async function captureDocumentFromIpn(dealId, payload, customLinkId) {
  const doctype = pick(payload, ['doctype', 'doc_type', 'docType']);
  const docnum = pick(payload, ['docnum', 'doc_number', 'docNum', 'invoice_number']);
  const isPaid = !!doctype && PAID_DOCTYPES.has(doctype);
  const base = { status: 'unrecognized', isPaid, doctype, docnum, amountMinor: null, currency: 'ILS' };
  try {
    if (!dealId || !payload || typeof payload !== 'object') return base;
    if (!doctype || !docnum || !DOC_TYPE_LABELS[doctype]) return base; // unrecognized → log-only

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, currency: true } });
    if (!deal) return base;

    const amountIls = Number(pick(payload, ['totalsum', 'total', 'sum', 'amount', 'totalwithvat'])) || 0;
    base.amountMinor = Math.round(amountIls * 100);
    base.currency = deal.currency || 'ILS';

    const idempotencyKey = `webhook:${dealId}:${doctype}:${docnum}`;
    const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey } });
    if (existing) return { ...base, status: 'duplicate' }; // retry / duplicate IPN

    const clientName = pick(payload, ['client_name', 'clientname', 'customer_name']) || 'לקוח';
    const docUrl = pick(payload, ['doc_url', 'pdf_link', 'docurl']);

    await prisma.$transaction(async (tx) => {
      const doc = await tx.icountDocument.create({
        data: {
          dealId,
          source: 'webhook',
          doctype,
          docnum,
          amountMinor: BigInt(base.amountMinor),
          currency: base.currency,
          clientName,
          docUrl,
          idempotencyKey,
          raw: payload,
        },
      });
      await emitAccountingEvent(tx, {
        dealId,
        doc,
        origin: systemOrigin(),
        sourceLabel: customLinkId ? 'custom_link' : 'webhook',
      });
    });
    console.log(`[icount webhook] captured document ${doctype}/${docnum} for deal ${dealId}`);
    return { ...base, status: 'captured' };
  } catch (err) {
    // Capture is best-effort — the raw log row is already persisted.
    console.error('[icount webhook] document capture failed', err);
    return { ...base, status: 'error' };
  }
}

// Verified payment → WON, for ANY deal. A real PAID document (receipt/invrec)
// arriving on the link's own IPN URL IS a completed credit-card payment, and a
// successful credit-card payment always closes the deal: the canonical
// transition (settleDealWonFromPayment → deals/wonTransition.js) sets status +
// final stage; a group deal's held/expired reservation is adopted, a deal with
// incomplete tour planning is WON without a tour and flagged on the timeline.
//
// Sequencing rule (Report #1 vs #26): the settle result IS the deal's
// pre-payment status. Settlement runs only when this IPN freshly recorded the
// payment (capture 'captured' / 'error', never 'duplicate') — a replayed IPN
// for a long-ago payment must not re-close a deliberately reopened deal.
// Best-effort: never throws into the webhook (the raw log is already safe).
export async function settlePaymentFromIpn(
  dealId,
  capture,
  { client = prisma, settle = settleDealWonFromPayment, log = console } = {},
) {
  try {
    if (!dealId) return { settled: false, reason: 'no_deal' };
    if (!capture?.isPaid) return { settled: false, reason: 'not_paid_doctype' };
    if (capture.status === 'duplicate') return { settled: false, reason: 'duplicate_ipn' };
    // A payload without a full recognized document identity never drives WON —
    // 'error' (a transient capture failure on a VALID identity) still settles
    // so a DB hiccup can't lose the close; iCount never retries an IPN.
    if (capture.status !== 'captured' && capture.status !== 'error') {
      return { settled: false, reason: 'unrecognized_payload' };
    }
    const result = await settle(client, {
      dealId,
      origin: systemOrigin(),
      paymentAmountMinor: capture.amountMinor,
    });
    if (result?.wonNow) log?.log?.(`[icount webhook] settled deal ${dealId} WON from verified payment (${capture.doctype})`);
    return { settled: !!result?.wonNow, alreadyWon: !!result?.alreadyWon, doctype: capture.doctype };
  } catch (err) {
    log?.error?.('[icount webhook] payment settlement failed', err);
    return { settled: false, reason: 'error' };
  }
}

// The app-level parser is JSON-only; IPN providers also send form-urlencoded.
// Accept both here so no payload shape is ever dropped.
router.use(express.urlencoded({ extended: true, limit: '1mb' }));

router.post(
  '/icount/:secret',
  handle(async (req, res) => {
    const expected = process.env.ICOUNT_WEBHOOK_SECRET;
    if (!expected || req.params.secret !== expected) {
      // A rejected call used to vanish silently — which made "is iCount even
      // calling us?" unanswerable (e.g. after a secret rotation, since links
      // are permanent and carry the old secret forever). Persist a bounded,
      // body-free marker so a misconfigured callback is diagnosable.
      console.error('[icount webhook] rejected: bad or unset secret');
      await logRejectedWebhook(prisma, 'icount', req, !expected ? 'secret_not_set' : 'bad_secret');
      return res.status(200).json({ ok: false });
    }
    const dealId = typeof req.query.dealId === 'string' && req.query.dealId ? req.query.dealId : null;
    const customLinkId =
      typeof req.query.customLinkId === 'string' && req.query.customLinkId ? req.query.customLinkId : null;
    try {
      const log = await prisma.icountWebhookLog.create({
        data: { dealId, payload: req.body ?? {} },
      });
      console.log(`[icount webhook] logged ${log.id} (dealId=${dealId || '—'})`);
      // After the log is safe, the payment lifecycle runs IN ORDER:
      //   1. capture the document (persist the payment evidence, idempotent);
      //   2. settle WON through the canonical transition (idempotent) — its
      //      result is the deal's PRE-payment status;
      //   3. announce the completion with that flag, so Report #1 fires only
      //      for a payment on an already-WON deal and never for the payment
      //      that itself closed the deal (that one is Report #26's).
      // Announcement only on a FRESH capture — a duplicate/failed capture
      // announced nothing before this refactor either.
      const capture = await captureDocumentFromIpn(dealId, req.body, customLinkId);
      const settled = await settlePaymentFromIpn(dealId, capture);
      if (capture.status === 'captured' && capture.isPaid) {
        emitPaymentCompleted({
          dealId,
          amountMinor: capture.amountMinor,
          currency: capture.currency,
          provider: 'icount',
          reference: `${capture.doctype}:${capture.docnum}`,
          source: PAYMENT_SOURCE_LINK,
          dealWasWonBeforePayment: settled?.alreadyWon === true,
        });
      }
      return res.status(200).json({ ok: true, logId: log.id });
    } catch (err) {
      // Still 200 — iCount must not retry forever; the failure is in our logs.
      console.error('[icount webhook] failed to persist payload', err);
      return res.status(200).json({ ok: false });
    }
  }),
);

export default router;
