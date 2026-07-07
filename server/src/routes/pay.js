import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { PAYMENT_DEAL_INCLUDE, ensureCurrentIcountLink, ensureCustomIcountLink } from '../dealPayment.js';

// PUBLIC permanent payment URL — GET /pay/:token.
//
// This is the ONLY URL customers ever receive. It resolves the deal by its
// permanent paymentToken and 302-redirects to the CURRENT iCount page: the
// active link is reused as-is when the payment data it was generated from is
// unchanged; when the deal drifted (amount / product / payer details) a new
// iCount link is generated behind the scenes first (history kept). The
// customer URL itself never changes — GOS stays the source of truth and
// iCount stays just the payment provider.
//
// Customer-facing failures render a calm Hebrew page and never leak
// internals; the real reason goes to the server log.

const router = Router();

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

// Custom-description payment link — /pay/c/<token>. Declared BEFORE /:token so
// the 'c' segment is never swallowed by the generic route. Frozen content: the
// iCount page shows the custom line/amount; the deal association (ipn) and the
// GOS-redirect pattern are identical to the regular flow.
router.get(
  '/c/:token',
  handle(async (req, res) => {
    const token = String(req.params.token || '');
    const link = /^[A-Za-z0-9_-]+$/.test(token)
      ? await prisma.dealCustomPaymentLink.findUnique({ where: { token } })
      : null;
    if (!link || link.status !== 'active') {
      return page(res, 404, 'קישור התשלום לא נמצא', 'ייתכן שהקישור שגוי או שאינו פעיל עוד. אנא פנו אלינו לקבלת קישור מעודכן.');
    }
    try {
      const deal = await prisma.deal.findUnique({ where: { id: link.dealId }, include: PAYMENT_DEAL_INCLUDE });
      if (!deal) throw new Error('deal_missing');
      const fresh = await ensureCustomIcountLink(prisma, link, deal);
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, fresh.paymentLinkUrl);
    } catch (err) {
      console.error(`[pay] custom link failed for deal ${link.dealId}: ${err?.code || ''} ${err?.message || err}`);
      return page(res, 503, 'עמוד התשלום אינו זמין כרגע', 'אנא נסו שוב מאוחר יותר או פנו אלינו ונשמח לעזור.');
    }
  }),
);

router.get(
  '/:token',
  handle(async (req, res) => {
    const token = String(req.params.token || '');
    // Same token character class as the rest of the codebase.
    const deal = /^[A-Za-z0-9_-]+$/.test(token)
      ? await prisma.deal.findUnique({ where: { paymentToken: token }, include: PAYMENT_DEAL_INCLUDE })
      : null;
    if (!deal) {
      return page(res, 404, 'קישור התשלום לא נמצא', 'ייתכן שהקישור שגוי או שאינו פעיל עוד. אנא פנו אלינו לקבלת קישור מעודכן.');
    }
    try {
      const link = await ensureCurrentIcountLink(prisma, deal);
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, link.paymentLinkUrl);
    } catch (err) {
      console.error(`[pay] failed for deal ${deal.id}: ${err?.code || ''} ${err?.message || err}`);
      return page(res, 503, 'עמוד התשלום אינו זמין כרגע', 'אנא נסו שוב מאוחר יותר או פנו אלינו ונשמח לעזור.');
    }
  }),
);

export default router;
