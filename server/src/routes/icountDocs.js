import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  ICOUNT_DEAL_INCLUDE,
  buildDocumentDefaults,
  issueDocument,
  listDealDocuments,
  fetchBaseDocumentPrefill,
  searchExternalDocuments,
  linkExternalDocument,
} from '../icountDocs.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { ensureCustomIcountLink, newPaymentToken, resolvePublicOrigin } from '../dealPayment.js';

// Deal accounting endpoints — mounted under /api/deals (admin-auth like the
// other deal routers).
//
//   GET  /:id/icount/defaults        — modal prefill (customer / rows / VAT / types)
//   GET  /:id/icount/documents       — previous documents (GOS rows + live iCount)
//   POST /:id/icount/documents       — issue a document (idempotent)
//   GET  /:id/custom-payment-links   — this deal's custom links
//   POST /:id/custom-payment-links   — create a custom-description payment link

const router = Router();

async function loadDeal(id) {
  return prisma.deal.findUnique({ where: { id }, include: ICOUNT_DEAL_INCLUDE });
}

router.get(
  '/:id/icount/defaults',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.json(buildDocumentDefaults(deal));
  }),
);

router.get(
  '/:id/icount/documents',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.json(await listDealDocuments(prisma, deal));
  }),
);

// Live prefill for a selected base document — its REAL lines + total from
// iCount (doc/info), normalized to the modal's VAT-inclusive row shape.
router.get(
  '/:id/icount/base-document',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      res.json(await fetchBaseDocumentPrefill(prisma, deal, String(req.query.doctype || ''), String(req.query.docnum || '')));
    } catch (err) {
      const code = err?.code || 'base_prefill_failed';
      const status = code === 'icount_request_failed' || code === 'icount_not_configured' ? 502 : 400;
      return res.status(status).json({ error: code, reason: err?.reason || null });
    }
  }),
);

// Search iCount for an EXTERNAL document to link ("שייך מסמך אחר מאייקאונט").
router.get(
  '/:id/icount/search-documents',
  handle(async (req, res) => {
    try {
      const documents = await searchExternalDocuments({
        query: req.query.q,
        doctype: String(req.query.doctype || '') || null,
      });
      res.json({ documents });
    } catch (err) {
      const code = err?.code || 'search_failed';
      const status = code === 'phone_search_unsupported' ? 400 : 502;
      return res.status(status).json({ error: code, reason: err?.reason || null });
    }
  }),
);

// Link a confirmed external document to the deal (idempotent).
router.post(
  '/:id/icount/link-document',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true, currency: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      const { doc, reused } = await linkExternalDocument(
        prisma,
        deal,
        { doctype: String(req.body?.doctype || ''), docnum: req.body?.docnum },
        req.adminAuth?.userId || null,
      );
      res.status(reused ? 200 : 201).json({ document: doc, reused });
    } catch (err) {
      const code = err?.code || 'link_failed';
      const status = code === 'icount_request_failed' || code === 'icount_not_configured' ? 502 : 400;
      return res.status(status).json({ error: code, reason: err?.reason || null });
    }
  }),
);

router.post(
  '/:id/icount/documents',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      const { doc, reused } = await issueDocument(prisma, deal, req.body || {}, req.adminAuth?.userId || null);
      res.status(reused ? 200 : 201).json({ document: doc, reused });
    } catch (err) {
      // Validation / provider failures come back as coded errors the modal can
      // present precisely (allocation details included when relevant).
      const code = err?.code || 'issue_failed';
      const status = code === 'icount_request_failed' || code === 'icount_not_configured' ? 502 : 400;
      return res.status(status).json({ error: code, reason: err?.reason || null, details: err?.details || null });
    }
  }),
);

// ── Custom payment links ─────────────────────────────────────────────────────

function toClientCustomLink(req, row) {
  return {
    id: row.id,
    url: `${resolvePublicOrigin(req)}/pay/c/${row.token}`,
    description: row.description,
    amountIls: Number(row.amountMinor) / 100,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
  };
}

router.get(
  '/:id/custom-payment-links',
  handle(async (req, res) => {
    const rows = await prisma.dealCustomPaymentLink.findMany({
      where: { dealId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ links: rows.map((r) => toClientCustomLink(req, r)) });
  }),
);

router.post(
  '/:id/custom-payment-links',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      include: ICOUNT_DEAL_INCLUDE,
    });
    if (!deal) return res.status(404).json({ error: 'not_found' });

    const description = String(req.body?.description || '').trim();
    const amountIls = Number(req.body?.amountIls);
    const notes = String(req.body?.notes || '').trim() || null;
    if (!description) return res.status(400).json({ error: 'description_required' });
    if (!Number.isFinite(amountIls) || amountIls <= 0) {
      return res.status(400).json({ error: 'amount_invalid' });
    }

    const userId = req.adminAuth?.userId || null;
    const row = await prisma.dealCustomPaymentLink.create({
      data: {
        dealId: deal.id,
        token: newPaymentToken(),
        description,
        amountMinor: BigInt(Math.round(amountIls * 100)),
        currency: deal.currency || 'ILS',
        notes,
        createdBy: userId,
      },
    });

    // Generate the iCount page NOW so a broken configuration surfaces in the
    // modal (not on the customer). The row is kept even on failure — /pay/c
    // retries generation lazily.
    let ready = true;
    let generateError = null;
    try {
      await ensureCustomIcountLink(prisma, row, deal);
    } catch (err) {
      ready = false;
      generateError = err?.code || 'icount_generate_failed';
      console.error(`[icount] custom link generate failed for deal ${deal.id}: ${err?.reason || err?.message}`);
    }

    const url = `${resolvePublicOrigin(req)}/pay/c/${row.token}`;
    // Visible (non-pinned) timeline event — the override must be obvious in GOS.
    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: deal.id,
      kind: 'accounting',
      data: {
        event: 'custom_payment_link',
        description,
        amountIls,
        currency: deal.currency || 'ILS',
        url,
        notes,
      },
      origin: await userOrigin(userId),
    });

    res.status(201).json({ link: { ...toClientCustomLink(req, row), url }, ready, generateError });
  }),
);

export default router;
