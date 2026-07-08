import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { PAYMENT_DEAL_INCLUDE, ensureCurrentIcountLink, ensureCustomIcountLink } from '../dealPayment.js';
import {
  TOURIST_DEAL_INCLUDE,
  ensureCurrentCardcomLowProfile,
  syncPendingRequestWithDeal,
} from '../touristPayment.js';

// PUBLIC canonical payment URLs — /payment/<provider>/<token>. The provider is
// visible in the URL (future-proof) and clearly distinguishes Cardcom (tourist
// 3DS clearing) from iCount (the regular payment/accounting provider).
//
//   GET /payment/cardcom/:token      — Cardcom tourist link (lazily mints the
//                                       LowProfile on first open; GOS URL stable)
//   GET /payment/icount/:token       — the deal's regular iCount link (canonical)
//   GET /payment/icount/c/:token     — a custom-description iCount link (canonical)
//
// Old /pay/<token> and /pay/c/<token> links keep working via routes/pay.js,
// which 301-redirects to these canonical URLs.
//
// Customer-facing failures render a calm Hebrew page and never leak internals;
// the real reason goes to the server log.

const router = Router();
const TOKEN = /^[A-Za-z0-9_-]+$/;

function page(res, status, title, body) {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">💳</div>
    <h1 style="font-size:1.1rem;margin:0 0 .5rem;color:#111827">${title}</h1>
    <p style="font-size:.9rem;color:#6b7280;margin:0">${body}</p>
  </div>
</body>
</html>`);
}

const NOT_FOUND = ['קישור התשלום לא נמצא', 'ייתכן שהקישור שגוי או שאינו פעיל עוד. אנא פנו אלינו לקבלת קישור מעודכן.'];
const UNAVAILABLE = ['עמוד התשלום אינו זמין כרגע', 'אנא נסו שוב מאוחר יותר או פנו אלינו ונשמח לעזור.'];

// English customer-facing page — the Cardcom flow serves FOREIGN customers, so
// every state under /payment/cardcom/* is English-only. Same calm-page rule:
// the customer sees a clean message; the technical reason goes to the log.
function pageEn(res, status, title, body) {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">💳</div>
    <h1 style="font-size:1.1rem;margin:0 0 .5rem;color:#111827">${title}</h1>
    <p style="font-size:.9rem;color:#6b7280;margin:0">${body}</p>
  </div>
</body>
</html>`);
}

// ── Cardcom tourist payment — /payment/cardcom/:token (ENGLISH-ONLY UX) ──────
router.get(
  '/cardcom/:token',
  handle(async (req, res) => {
    const token = String(req.params.token || '');
    const pr = TOKEN.test(token) ? await prisma.paymentRequest.findUnique({ where: { token } }) : null;
    if (!pr || pr.provider !== 'cardcom') {
      return pageEn(res, 404, 'Payment link not found', 'This payment link is invalid or no longer active. Please contact us for an updated link.');
    }
    if (pr.status === 'canceled') {
      return pageEn(res, 410, 'Payment link cancelled', 'This payment link has been cancelled. Please contact us for an updated link.');
    }
    if (pr.status === 'paid') {
      return pageEn(res, 200, 'Payment already completed', 'Thank you! The payment for this link has already been received.');
    }
    try {
      // The Deal is the SSOT while pending: resync the request from the live
      // Deal first, so the page the customer opens reflects the current Deal —
      // same GOS URL, LowProfile transparently re-minted when it drifted.
      const deal = await prisma.deal.findUnique({ where: { id: pr.dealId }, include: TOURIST_DEAL_INCLUDE });
      if (!deal) throw new Error('deal_missing');
      const synced = await syncPendingRequestWithDeal(prisma, deal, pr);
      const url = await ensureCurrentCardcomLowProfile(prisma, synced, { req });
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, url);
    } catch (err) {
      // Full technical detail for the operator; the customer gets clean English.
      console.error(
        `[payment] cardcom link failed for request ${pr.id} (deal ${pr.dealId}): code=${err?.code || 'unknown'} reason=${err?.reason || '-'} responseCode=${err?.responseCode ?? '-'} message=${err?.message || err}`,
      );
      return pageEn(res, 503, 'Payment page temporarily unavailable', 'Please try again in a few minutes, or contact us — we will be happy to help.');
    }
  }),
);

// ── iCount custom link — /payment/icount/c/:token (BEFORE /icount/:token) ─────
router.get(
  '/icount/c/:token',
  handle(async (req, res) => {
    const token = String(req.params.token || '');
    const link = TOKEN.test(token) ? await prisma.dealCustomPaymentLink.findUnique({ where: { token } }) : null;
    if (!link || link.status !== 'active') return page(res, 404, ...NOT_FOUND);
    try {
      const deal = await prisma.deal.findUnique({ where: { id: link.dealId }, include: PAYMENT_DEAL_INCLUDE });
      if (!deal) throw new Error('deal_missing');
      const fresh = await ensureCustomIcountLink(prisma, link, deal);
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, fresh.paymentLinkUrl);
    } catch (err) {
      console.error(`[payment] icount custom link failed for deal ${link.dealId}: ${err?.code || ''} ${err?.message || err}`);
      return page(res, 503, ...UNAVAILABLE);
    }
  }),
);

// ── iCount regular link — /payment/icount/:token ─────────────────────────────
router.get(
  '/icount/:token',
  handle(async (req, res) => {
    const token = String(req.params.token || '');
    const deal = TOKEN.test(token)
      ? await prisma.deal.findUnique({ where: { paymentToken: token }, include: PAYMENT_DEAL_INCLUDE })
      : null;
    if (!deal) return page(res, 404, ...NOT_FOUND);
    try {
      const link = await ensureCurrentIcountLink(prisma, deal);
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, link.paymentLinkUrl);
    } catch (err) {
      console.error(`[payment] icount link failed for deal ${deal.id}: ${err?.code || ''} ${err?.message || err}`);
      return page(res, 503, ...UNAVAILABLE);
    }
  }),
);

export default router;
