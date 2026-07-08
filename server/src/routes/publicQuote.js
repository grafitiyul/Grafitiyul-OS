import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { composeQuoteByPublicToken } from '../quote/composer.js';
import { signQuoteByToken } from '../quote/quoteSignature.js';

// Public (unauthenticated) customer quote page. Scoped strictly to the
// high-entropy QuoteDocument.publicToken — no id enumeration, no admin data.
// `/api` already sets Cache-Control: no-store, so the customer always sees the
// live proposal (or, once signed, the frozen snapshot).
const router = Router();

router.get(
  '/quote/:token',
  handle(async (req, res) => {
    const r = await composeQuoteByPublicToken(prisma, req.params.token);
    if (r.error === 'not_found' || r.error === 'deal_not_found') {
      return res.status(404).json({ error: 'not_found' });
    }
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.result);
  }),
);

// Sign the proposal. Creates the permanent QuoteSignature audit record and locks
// the document (one signature only; a signed doc can never be re-signed).
router.post(
  '/quote/:token/sign',
  handle(async (req, res) => {
    const ip =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;
    const meta = { ip, userAgent: req.headers['user-agent'] || null };
    const r = await signQuoteByToken(prisma, req.params.token, req.body || {}, meta);
    if (r.error === 'not_found' || r.error === 'deal_not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'already_signed') return res.status(409).json({ error: 'already_signed' });
    // A newer version of the same offer exists — not signable; the client reloads
    // into the replacement screen (same 409 recovery path as already_signed).
    if (r.error === 'superseded') return res.status(409).json({ error: 'superseded' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.result);
  }),
);

export default router;
