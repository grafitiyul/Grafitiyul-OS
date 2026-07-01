import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { getQuoteTemplate, updateQuoteTemplate } from '../quote/quoteTemplate.js';

// CRM settings → Quote Layout & Sections. The GLOBAL default quote composition
// control center (hero, section order/visibility, technical-detail fields).
// Single-row settings; the body is normalised in the service, so these handlers
// stay thin. This is the default SEED only — per-quote overrides live on the
// QuoteDocument. See quoteTemplate.js.

const router = Router();

router.get(
  '/',
  handle(async (_req, res) => {
    res.json(await getQuoteTemplate(prisma));
  }),
);

router.put(
  '/',
  handle(async (req, res) => {
    res.json(await updateQuoteTemplate(prisma, req.body || {}));
  }),
);

export default router;
