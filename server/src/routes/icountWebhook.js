import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// iCount IPN receiver — AUDIT LOG ONLY in this slice.
//
// Personal payment links are generated once with ipn_url baked in, so without
// a live receiver every payment made through them would be permanently silent.
// This route closes that gap the safe way: it persists the raw payload to
// IcountWebhookLog and returns 200 — it changes NO deal/payment state, marks
// nothing paid, and matches nothing. Processing (mark-paid, invoice capture)
// is a future slice that can replay these logs retroactively.
//
// Auth: URL-path secret (ICOUNT_WEBHOOK_SECRET), same proven pattern as the
// Challenge System. Always answers 200 so iCount never retries unrecoverable
// payloads — the raw payload is persisted before anything else can fail.

const router = Router();

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
    try {
      const log = await prisma.icountWebhookLog.create({
        data: { dealId, payload: req.body ?? {} },
      });
      console.log(`[icount webhook] logged ${log.id} (dealId=${dealId || '—'})`);
      return res.status(200).json({ ok: true, logId: log.id });
    } catch (err) {
      // Still 200 — iCount must not retry forever; the failure is in our logs.
      console.error('[icount webhook] failed to persist payload', err);
      return res.status(200).json({ ok: false });
    }
  }),
);

export default router;
