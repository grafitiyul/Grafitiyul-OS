import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { composeQuoteByPublicToken } from '../quote/composer.js';

// Public (unauthenticated) customer quote page. Scoped strictly to the
// high-entropy QuoteDocument.publicToken — no id enumeration, no admin data.
// `/api` already sets Cache-Control: no-store, so the customer always sees the
// live proposal. Signing endpoints are added in Phase 2.
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

export default router;
