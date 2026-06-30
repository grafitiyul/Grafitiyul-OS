import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  getQuoteDocument,
  updateQuoteDocumentMeta,
  toClientQuoteDocument,
} from '../quote/quoteDocument.js';

// Quote Module — Slice 1 admin endpoints (foundation only).
//   GET  /api/quote-documents/:id  — read one document
//   PUT  /api/quote-documents/:id  — update editable DRAFT metadata
//                                    (displayProductName, personalIntro, language)
// The deal-scoped "ensure a draft exists" endpoint lives on the deals router
// (GET /api/deals/:id/quote-document), mirroring /:id/price-lines. No produce /
// render / public page / signature in this slice.

const router = Router();

router.get(
  '/:id',
  handle(async (req, res) => {
    const r = await getQuoteDocument(prisma, req.params.id);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ quoteDocument: toClientQuoteDocument(r.doc) });
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const r = await updateQuoteDocumentMeta(prisma, req.params.id, req.body || {});
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'not_editable') return res.status(409).json({ error: 'not_editable' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ quoteDocument: toClientQuoteDocument(r.doc) });
  }),
);

export default router;
