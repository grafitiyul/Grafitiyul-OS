import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  TOURIST_DEAL_INCLUDE,
  buildTouristDefaults,
  createOrReopenRequest,
  editRequest,
  cancelRequest,
  findPendingRequest,
  syncPendingRequestWithDeal,
  toClientRequest,
  publicPaymentUrl,
} from '../touristPayment.js';

// Cardcom tourist-payment endpoints — mounted under /api/deals (admin-auth like
// the other deal routers).
//
//   GET   /:id/tourist-payment            — modal prefill + the active pending request (if any)
//   POST  /:id/tourist-payment            — create OR reopen the deal's single pending request
//   PATCH /:id/tourist-payment/:reqId     — edit a pending request (GOS link unchanged)
//   POST  /:id/tourist-payment/:reqId/cancel — cancel a pending request
//
// Provider failures return 422 (NOT 502/504): Cloudflare replaces origin 5xx
// bodies with its own HTML, which breaks the modal — 4xx bodies pass through.

const router = Router();

function statusFor(code) {
  return code === 'cardcom_request_failed' || code === 'cardcom_not_configured' || code === 'cardcom_timeout'
    ? 422
    : 400;
}

async function loadDeal(id) {
  return prisma.deal.findUnique({ where: { id }, include: TOURIST_DEAL_INCLUDE });
}

router.get(
  '/:id/tourist-payment',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    // A pending request is resynced from the Deal (SSOT) before it is shown.
    const active = await findPendingRequest(prisma, deal.id).then((r) =>
      r ? syncPendingRequestWithDeal(prisma, deal, r) : null,
    );
    res.json({
      defaults: buildTouristDefaults(deal),
      activeRequest: active ? toClientRequest(active) : null,
      publicUrl: active ? publicPaymentUrl(req, active.token) : null,
    });
  }),
);

router.post(
  '/:id/tourist-payment',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      const { request, reopened } = await createOrReopenRequest(prisma, deal, req.body || {}, req.adminAuth?.userId || null);
      res.status(reopened ? 200 : 201).json({
        request: toClientRequest(request),
        publicUrl: publicPaymentUrl(req, request.token),
        reopened,
      });
    } catch (err) {
      const code = err?.code || 'tourist_payment_failed';
      res.status(statusFor(code)).json({ error: code, reason: err?.reason || null });
    }
  }),
);

router.patch(
  '/:id/tourist-payment/:reqId',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const existing = await prisma.paymentRequest.findFirst({
      where: { id: req.params.reqId, dealId: deal.id, provider: 'cardcom' },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    try {
      const { request } = await editRequest(prisma, deal, existing, req.body || {}, req.adminAuth?.userId || null);
      res.json({ request: toClientRequest(request), publicUrl: publicPaymentUrl(req, request.token) });
    } catch (err) {
      const code = err?.code || 'tourist_payment_failed';
      res.status(statusFor(code)).json({ error: code, reason: err?.reason || null });
    }
  }),
);

router.post(
  '/:id/tourist-payment/:reqId/cancel',
  handle(async (req, res) => {
    const existing = await prisma.paymentRequest.findFirst({
      where: { id: req.params.reqId, dealId: req.params.id, provider: 'cardcom' },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    try {
      const request = await cancelRequest(prisma, existing, req.adminAuth?.userId || null);
      res.json({ request: toClientRequest(request) });
    } catch (err) {
      const code = err?.code || 'tourist_payment_failed';
      res.status(statusFor(code)).json({ error: code, reason: err?.reason || null });
    }
  }),
);

export default router;
