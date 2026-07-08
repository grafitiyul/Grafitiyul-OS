import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { processCardcomResult } from '../touristPayment.js';

// Cardcom webhook receiver — audit log + verified payment capture.
//
// Cardcom POSTs here when a hosted payment page completes, carrying ReturnValue
// (our PaymentRequest.token) and LowProfileId. We NEVER trust the body alone:
// the raw payload is logged first, then we re-verify server-side via
// GetLpResult before marking the request paid (see touristPayment.js). The
// pending→paid transition is a conditional update, so retries/duplicates can
// never double-process (no duplicate payment event, no duplicate iCount doc).
//
// Always answers 200 (Cardcom must not retry forever). Auth: URL-path secret
// (CARDCOM_WEBHOOK_SECRET), same pattern as the iCount webhook.

const router = Router();

function pick(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

// Cardcom may send JSON (app-level parser) or form-urlencoded — accept both.
router.use(express.urlencoded({ extended: true, limit: '1mb' }));

router.post(
  '/cardcom/:secret',
  handle(async (req, res) => {
    const expected = process.env.CARDCOM_WEBHOOK_SECRET;
    if (!expected || req.params.secret !== expected) {
      console.error('[cardcom webhook] rejected: bad or unset secret');
      return res.status(200).json({ ok: false });
    }
    const payload = req.body ?? {};
    const token = pick(payload, ['ReturnValue', 'returnValue', 'return_value']);
    const lowProfileId = pick(payload, ['LowProfileId', 'lowProfileId', 'LowProfileCode', 'low_profile_id']);
    try {
      const log = await prisma.cardcomWebhookLog.create({ data: { token, payload } });
      console.log(`[cardcom webhook] logged ${log.id} (token=${token || '—'})`);
      // After the log is safe: verify server-side + mark paid (never throws out).
      const result = await processCardcomResult(prisma, { token, lowProfileId });
      console.log(`[cardcom webhook] ${token || '—'} → ${JSON.stringify(result)}`);
      return res.status(200).json({ ok: true, logId: log.id });
    } catch (err) {
      // Still 200 — Cardcom must not retry forever; the failure is in our logs.
      console.error('[cardcom webhook] processing failed', err);
      return res.status(200).json({ ok: false });
    }
  }),
);

export default router;
