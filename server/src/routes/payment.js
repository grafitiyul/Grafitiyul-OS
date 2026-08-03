import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { PAYMENT_DEAL_INCLUDE, ensureCurrentIcountLink, ensureCustomIcountLink } from '../dealPayment.js';
import {
  PAYABLE_STATUSES,
  TOURIST_DEAL_INCLUDE,
  ensureCurrentCardcomLowProfile,
  markReturned,
  reconcileCardcomRequest,
  retryAfterFailure,
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
//
// State-machine page rules (duplicate-payment protection):
//   pending / awaiting_payment → create-or-reuse ONE LowProfile, redirect
//   payment_returned           → verification-pending page (polls; NO pay button)
//   paid                       → success page (NO pay button)
//   failed                     → verified-failure page (explicit retry only)
//   canceled / expired         → unavailable (NO pay button)
// The success/failed redirect URLs land on /return — which NEVER marks paid by
// itself; only server-side GetLpResult verification does.

// Verification-pending page — polls /payment/cardcom/<token>/status gently
// (5s for the first minute, then 15s) and reloads when the state resolves.
// The one page a customer sees between paying and webhook/verification.
function pageVerifying(res, token) {
  res.status(200).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verifying your payment</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">⏳</div>
    <h1 style="font-size:1.1rem;margin:0 0 .5rem;color:#111827">Your payment was received and is being verified</h1>
    <p style="font-size:.95rem;color:#b45309;font-weight:600;margin:0 0 .5rem">Please do not pay again.</p>
    <p style="font-size:.9rem;color:#6b7280;margin:0 0 .75rem">This page updates automatically — verification usually takes a few seconds.</p>
    <p dir="rtl" style="font-size:.85rem;color:#9ca3af;margin:0">התשלום נקלט וממתין לאישור. אין לבצע תשלום נוסף.</p>
  </div>
  <script>
    (function () {
      var polls = 0;
      function tick() {
        fetch('/payment/cardcom/${token}/status', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (s && s.state && s.state !== 'verifying') { location.reload(); return; }
            schedule();
          })
          .catch(schedule);
      }
      function schedule() { polls += 1; setTimeout(tick, polls < 12 ? 5000 : 15000); }
      setTimeout(tick, 4000);
    })();
  </script>
</body>
</html>`);
}

function pagePaid(res) {
  res.status(200).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment received</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">✅</div>
    <h1 style="font-size:1.1rem;margin:0 0 .5rem;color:#111827">Payment received successfully</h1>
    <p style="font-size:.9rem;color:#6b7280;margin:0 0 .75rem">Thank you! Your payment has been confirmed.</p>
    <p dir="rtl" style="font-size:.85rem;color:#9ca3af;margin:0">התשלום התקבל בהצלחה</p>
  </div>
</body>
</html>`);
}

function pageFailed(res, token) {
  res.status(200).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment not completed</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">💳</div>
    <h1 style="font-size:1.1rem;margin:0 0 .5rem;color:#111827">The payment was not completed</h1>
    <p style="font-size:.9rem;color:#6b7280;margin:0 0 1rem">The card was not charged. You can safely try again.</p>
    <a href="/payment/cardcom/${token}/retry" style="display:inline-block;padding:.6rem 1.4rem;background:#111827;color:#fff;border-radius:.5rem;text-decoration:none;font-size:.95rem">Try again</a>
  </div>
</body>
</html>`);
}

// Renders the correct page for a request's CURRENT state; returns false only
// when the request is payable (caller proceeds to mint/redirect).
function renderStatePage(res, pr) {
  if (pr.status === 'paid') return pagePaid(res), true;
  if (pr.status === 'payment_returned') return pageVerifying(res, pr.token), true;
  if (pr.status === 'failed') return pageFailed(res, pr.token), true;
  if (pr.status === 'canceled' || pr.status === 'expired') {
    pageEn(res, 410, 'Payment link no longer active', 'This payment link is no longer active. Please contact us for an updated link.');
    return true;
  }
  return false; // pending / awaiting_payment → payable
}

async function findCardcomRequest(token) {
  if (!TOKEN.test(String(token || ''))) return null;
  const pr = await prisma.paymentRequest.findUnique({ where: { token: String(token) } });
  return pr && pr.provider === 'cardcom' ? pr : null;
}

router.get(
  '/cardcom/:token',
  handle(async (req, res) => {
    const pr = await findCardcomRequest(req.params.token);
    if (!pr) {
      return pageEn(res, 404, 'Payment link not found', 'This payment link is invalid or no longer active. Please contact us for an updated link.');
    }
    if (renderStatePage(res, pr)) return;
    try {
      // The Deal is the SSOT while payable: resync the request from the live
      // Deal first, so the page the customer opens reflects the current Deal —
      // same GOS URL, LowProfile transparently re-minted when it drifted.
      const deal = await prisma.deal.findUnique({ where: { id: pr.dealId }, include: TOURIST_DEAL_INCLUDE });
      if (!deal) throw new Error('deal_missing');
      const synced = await syncPendingRequestWithDeal(prisma, deal, pr);
      const url = await ensureCurrentCardcomLowProfile(prisma, synced, { req });
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, url);
    } catch (err) {
      if (err?.code === 'state_changed') {
        // Raced into a non-payable state while opening — render that state.
        const fresh = await findCardcomRequest(req.params.token);
        if (fresh && renderStatePage(res, fresh)) return;
      }
      // Full technical detail for the operator; the customer gets clean English.
      console.error(
        `[payment] cardcom link failed for request ${pr.id} (deal ${pr.dealId}): code=${err?.code || 'unknown'} reason=${err?.reason || '-'} responseCode=${err?.responseCode ?? '-'} message=${err?.message || err}`,
      );
      return pageEn(res, 503, 'Payment page temporarily unavailable', 'Please try again in a few minutes, or contact us — we will be happy to help.');
    }
  }),
);

// Customer back from Cardcom. outcome=success → payment_returned + immediate
// server-side verification attempt (webhook may still be in flight). The
// redirect itself NEVER marks paid — GetLpResult is the only truth.
router.get(
  '/cardcom/:token/return',
  handle(async (req, res) => {
    const pr = await findCardcomRequest(req.params.token);
    if (!pr) {
      return pageEn(res, 404, 'Payment link not found', 'This payment link is invalid or no longer active. Please contact us for an updated link.');
    }
    const outcome = String(req.query.outcome || 'success');
    if (pr.status === 'paid') return pagePaid(res);

    if (outcome === 'failed' && PAYABLE_STATUSES.includes(pr.status)) {
      // Cardcom said the attempt failed — verify it (the redirect is not proof
      // of failure either). Verified failed → failure page; verified paid →
      // success; unknown → failure page whose retry goes through the main
      // link, which REUSES the existing session (no replacement without proof).
      const { state } = await reconcileCardcomRequest(prisma, pr, { force: true });
      if (state === 'paid') return pagePaid(res);
      return pageFailed(res, pr.token);
    }

    if (PAYABLE_STATUSES.includes(pr.status) || pr.status === 'payment_returned') {
      const returned = pr.status === 'payment_returned' ? pr : await markReturned(prisma, pr);
      // One immediate verification try (rate-limited internally) so the happy
      // path resolves in this very request when Cardcom already knows.
      const { state } = await reconcileCardcomRequest(prisma, returned ?? pr, { force: !pr.returnedAt });
      if (state === 'paid') return pagePaid(res);
      if (state === 'failed') return pageFailed(res, pr.token);
      // Not verifiable yet: verification-pending page. NEVER a payment page.
      return pageVerifying(res, pr.token);
    }
    const fresh = await findCardcomRequest(req.params.token);
    if (fresh && renderStatePage(res, fresh)) return;
    return pageVerifying(res, pr.token);
  }),
);

// Lightweight status poll for the verification-pending page. Piggybacks a
// rate-limited reconcile so a lost webhook still converges without operator
// action. Token-gated exactly like the page itself; leaks only a coarse state.
router.get(
  '/cardcom/:token/status',
  handle(async (req, res) => {
    const pr = await findCardcomRequest(req.params.token);
    res.set('Cache-Control', 'no-store');
    if (!pr) return res.status(404).json({ state: 'unavailable' });
    let status = pr.status;
    if (status === 'payment_returned') {
      const { state } = await reconcileCardcomRequest(prisma, pr, {});
      status = state;
    }
    const state =
      status === 'paid' ? 'paid'
      : status === 'failed' ? 'failed'
      : status === 'payment_returned' ? 'verifying'
      : status === 'canceled' || status === 'expired' ? 'unavailable'
      : 'payable';
    return res.json({ state });
  }),
);

// Explicit retry after a provider-VERIFIED failure — the ONLY path that may
// replace a LowProfile (archives the dead attempt, attemptNo++). A refresh,
// back-button or webhook delay can never reach here in any other state.
router.get(
  '/cardcom/:token/retry',
  handle(async (req, res) => {
    const pr = await findCardcomRequest(req.params.token);
    if (!pr) {
      return pageEn(res, 404, 'Payment link not found', 'This payment link is invalid or no longer active. Please contact us for an updated link.');
    }
    if (pr.status === 'failed') await retryAfterFailure(prisma, pr);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, `/payment/cardcom/${pr.token}`);
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
