import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { DOC_TYPE_LABELS, emitAccountingEvent, systemOrigin } from '../icountDocs.js';
import { settleDealWonFromPayment } from '../deals/paymentWon.js';
import { REG_HELD, REG_EXPIRED } from '../tours/registrationStatus.js';

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
async function captureDocumentFromIpn(dealId, payload, customLinkId) {
  try {
    if (!dealId || !payload || typeof payload !== 'object') return;
    const doctype = pick(payload, ['doctype', 'doc_type', 'docType']);
    const docnum = pick(payload, ['docnum', 'doc_number', 'docNum', 'invoice_number']);
    if (!doctype || !docnum || !DOC_TYPE_LABELS[doctype]) return; // unrecognized → log-only

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, currency: true } });
    if (!deal) return;

    const idempotencyKey = `webhook:${dealId}:${doctype}:${docnum}`;
    const existing = await prisma.icountDocument.findUnique({ where: { idempotencyKey } });
    if (existing) return; // retry / duplicate IPN — nothing to do

    const amountIls = Number(pick(payload, ['totalsum', 'total', 'sum', 'amount', 'totalwithvat'])) || 0;
    const clientName = pick(payload, ['client_name', 'clientname', 'customer_name']) || 'לקוח';
    const docUrl = pick(payload, ['doc_url', 'pdf_link', 'docurl']);

    await prisma.$transaction(async (tx) => {
      const doc = await tx.icountDocument.create({
        data: {
          dealId,
          source: 'webhook',
          doctype,
          docnum,
          amountMinor: BigInt(Math.round(amountIls * 100)),
          currency: deal.currency || 'ILS',
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
  } catch (err) {
    // Capture is best-effort — the raw log row is already persisted.
    console.error('[icount webhook] document capture failed', err);
  }
}

// Verified-payment → WON for a GROUP REGISTRATION. THE only automatic path that
// settles a pay-now / send-link deal: a real PAID document (receipt / invrec)
// arrived on the IPN for a deal that is holding a seat (a held or lately-expired
// group reservation). settleDealWonFromPayment is idempotent (already-WON is a
// no-op) so a retried/duplicated IPN never double-settles, and a non-paid
// doctype (or a deal with no pending hold) changes nothing. Best-effort: never
// throws into the webhook (the raw log is already safe).
export async function settleGroupRegistrationFromIpn(
  dealId,
  payload,
  { client = prisma, settle = settleDealWonFromPayment, log = console } = {},
) {
  try {
    if (!dealId) return { settled: false, reason: 'no_deal' };
    const doctype = pick(payload, ['doctype', 'doc_type', 'docType']);
    if (!doctype || !PAID_DOCTYPES.has(doctype)) return { settled: false, reason: 'not_paid_doctype' };
    // Only deals that went through pay-now / send-link carry a pending hold.
    const pending = await client.ticketRegistration.findFirst({
      where: { dealId, source: 'deal', status: { in: [REG_HELD, REG_EXPIRED] } },
      select: { id: true },
    });
    if (!pending) return { settled: false, reason: 'no_pending_hold' };
    const result = await settle(client, { dealId, origin: systemOrigin() });
    if (result?.wonNow) log?.log?.(`[icount webhook] settled deal ${dealId} WON from verified payment (${doctype})`);
    return { settled: !!result?.wonNow, alreadyWon: !!result?.alreadyWon, doctype };
  } catch (err) {
    log?.error?.('[icount webhook] group-registration settlement failed', err);
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
      console.error('[icount webhook] rejected: bad or unset secret');
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
      // After the log is safe: best-effort document capture (never throws), then
      // verified-payment settlement for a pending group registration (idempotent,
      // never throws). Order is independent — both read the same logged payload.
      await captureDocumentFromIpn(dealId, req.body, customLinkId);
      await settleGroupRegistrationFromIpn(dealId, req.body);
      return res.status(200).json({ ok: true, logId: log.id });
    } catch (err) {
      // Still 200 — iCount must not retry forever; the failure is in our logs.
      console.error('[icount webhook] failed to persist payload', err);
      return res.status(200).json({ ok: false });
    }
  }),
);

export default router;
