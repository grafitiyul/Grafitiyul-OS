import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  getQuoteDocument,
  updateQuoteDocumentMeta,
  resetQuoteDocumentToSource,
  toClientQuoteDocument,
} from '../quote/quoteDocument.js';
import { produceQuoteDocument } from '../quote/produce.js';
import { composeQuoteDraftPreview } from '../quote/composer.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';

// Quote Module — Slice 1 admin endpoints (foundation only).
//   GET  /api/quote-documents/:id  — read one document
//   PUT  /api/quote-documents/:id  — update editable DRAFT metadata
//                                    (displayProductName, language)
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

// "Reset all to source" (Slice 3): clear every override + structural edit, then
// the next compose-preview recomposes from source. Draft only.
router.post(
  '/:id/reset-to-source',
  handle(async (req, res) => {
    const r = await resetQuoteDocumentToSource(prisma, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'not_editable') return res.status(409).json({ error: 'not_editable' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ quoteDocument: toClientQuoteDocument(r.doc) });
  }),
);

// Produce ("הפק") — freeze the draft into a NEW immutable QuoteDocument with its
// own permanent public URL + snapshot (the draft stays as the working copy for
// the next version). Emits a 'quote' timeline event on the deal.
router.post(
  '/:id/produce',
  handle(async (req, res) => {
    const r = await produceQuoteDocument(prisma, req.params.id, {
      temporaryOverrideState: req.body?.temporaryOverrideState || null,
    });
    if (r.error === 'not_found' || r.error === 'deal_not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'not_draft') return res.status(409).json({ error: 'not_draft' });
    if (r.error) return res.status(400).json({ error: r.error });

    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: r.doc.dealId,
      kind: 'quote',
      data: {
        event: 'quote_generated',
        quoteDocumentId: r.doc.id,
        offerNo: r.offer?.offerNo ?? 1,
        versionNo: r.doc.versionNo,
        language: r.doc.language,
        publicToken: r.doc.publicToken,
      },
      origin: await userOrigin(req.adminAuth?.userId),
    });

    res.json({ quoteDocument: toClientQuoteDocument(r.doc) });
  }),
);

// Compose a read-only preview of the draft (Slice 2). Assembles the ordered
// block list + per-block preview data + missing-content warnings from the Deal /
// QuoteVersion / content blocks. Does NOT produce, freeze, persist, or render.
router.get(
  '/:id/compose-preview',
  handle(async (req, res) => {
    const r = await composeQuoteDraftPreview(prisma, req.params.id);
    if (r.error === 'not_found' || r.error === 'deal_not_found') return res.status(404).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.model);
  }),
);

// Same preview with a one-shot TEMPORARY override layer (never persisted) —
// the generation modal previews unchecked-"apply to future versions" edits here.
router.post(
  '/:id/compose-preview',
  handle(async (req, res) => {
    const r = await composeQuoteDraftPreview(prisma, req.params.id, {
      overrideOverlay: req.body?.overrideOverlay || null,
    });
    if (r.error === 'not_found' || r.error === 'deal_not_found') return res.status(404).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r.model);
  }),
);

export default router;
