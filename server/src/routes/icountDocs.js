import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  ICOUNT_DEAL_INCLUDE,
  DOC_TYPE_LABELS,
  buildDocumentDefaults,
  issueDocument,
  listDealDocuments,
  fetchBaseDocumentPrefill,
  searchExternalDocuments,
  linkExternalDocument,
} from '../icountDocs.js';
import { sendDocByEmail, getDocUrl } from '../icount.js';
import { sendSimpleEmail, getSendAccount } from '../email/simpleSend.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { ensureCustomIcountLink, newPaymentToken, resolvePublicOrigin } from '../dealPayment.js';

// Deal accounting endpoints — mounted under /api/deals (admin-auth like the
// other deal routers).
//
//   GET  /:id/icount/defaults            — modal prefill (customer / rows / VAT / types)
//   GET  /:id/icount/documents           — previous documents (GOS rows + live iCount)
//   POST /:id/icount/documents           — issue a document (idempotent)
//   POST /:id/icount/send-document       — email a document via iCount (failure → Gmail proposal, never auto-sends)
//   POST /:id/icount/send-document-gmail — operator-approved Gmail fallback send
//   GET  /:id/custom-payment-links       — this deal's custom links
//   POST /:id/custom-payment-links       — create a custom-description payment link
//
// Provider failures return 422 (NOT 502/504): Cloudflare replaces origin
// 502/504 bodies with its own HTML error page, which is exactly the raw-HTML
// modal bug QA hit — 4xx bodies pass through untouched.

const router = Router();

function providerErrorStatus(code) {
  return code === 'icount_request_failed' || code === 'icount_not_configured' || code === 'icount_timeout'
    ? 422
    : 400;
}

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
      return res.status(providerErrorStatus(code)).json({ error: code, reason: err?.reason || null });
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
      const status = code === 'phone_search_unsupported' ? 400 : providerErrorStatus(code);
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
      return res.status(providerErrorStatus(code)).json({ error: code, reason: err?.reason || null });
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
      return res.status(providerErrorStatus(code)).json({ error: code, reason: err?.reason || null, details: err?.details || null });
    }
  }),
);

// Shared validation + the timeline event both send endpoints emit.
function parseSendDocBody(req) {
  return {
    doctype: String(req.body?.doctype || ''),
    docnum: String(req.body?.docnum || '').trim(),
    email: String(req.body?.email || '').trim(),
  };
}

async function emitDocumentSentEvent(dealId, { doctype, docnum, email, via }, userId) {
  await emitTimelineEvent(prisma, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'accounting',
    data: {
      event: 'icount_document_sent',
      doctype,
      doctypeLabel: DOC_TYPE_LABELS[doctype] || doctype,
      docnum,
      channel: 'email',
      via,
      recipient: email,
    },
    origin: await userOrigin(userId),
  });
}

// Send an already-issued iCount document to a customer by email ("שלח ללקוח →
// אימייל"). Primary path is iCount's own doc/email. PRODUCT RULE: no email
// text is ever sent automatically — when iCount fails (or can't confirm the
// requested recipient) NOTHING is sent; the error response carries a
// ready-to-approve Gmail proposal (sender/subject/body/link) that the modal
// shows for editing, and only the explicit approval endpoint below sends it.
router.post(
  '/:id/icount/send-document',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const { doctype, docnum, email } = parseSendDocBody(req);
    if (!doctype || !docnum) return res.status(400).json({ error: 'document_required' });
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'email_invalid' });

    try {
      await sendDocByEmail({ doctype, docnum, email });
    } catch (icountErr) {
      // Build the Gmail-fallback PROPOSAL (nothing is sent here). doc/get_doc_url
      // is the fresh link source; the modal's stored docUrl covers iCount being
      // fully unreachable.
      let docUrl = null;
      try {
        docUrl = await getDocUrl(doctype, docnum);
      } catch {
        docUrl = null;
      }
      if (!docUrl) docUrl = String(req.body?.docUrl || '').trim() || null;
      const account = await getSendAccount();
      let gmail;
      if (!account) {
        gmail = { available: false, reason: 'gmail_unavailable' };
      } else if (!docUrl) {
        gmail = { available: false, reason: 'no_doc_url' };
      } else {
        const label = DOC_TYPE_LABELS[doctype] || doctype;
        const docRef = `${label}${docnum ? ` מס׳ ${docnum}` : ''}`;
        gmail = {
          available: true,
          from: account.emailAddress,
          to: email,
          subject: docRef,
          bodyText: `שלום,\n\nמצורף קישור לצפייה במסמך — ${docRef}:\n${docUrl}\n\nתודה`,
          docUrl,
        };
      }
      const code = icountErr?.code || 'send_failed';
      return res.status(providerErrorStatus(code)).json({ error: code, reason: icountErr?.reason || null, gmail });
    }

    await emitDocumentSentEvent(deal.id, { doctype, docnum, email, via: 'icount' }, req.adminAuth?.userId || null);
    res.json({ ok: true, via: 'icount' });
  }),
);

// Operator-APPROVED Gmail fallback send. The subject/body arrive from the
// approval modal exactly as the operator confirmed them — this endpoint is
// only ever called after an explicit approval click.
router.post(
  '/:id/icount/send-document-gmail',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const { doctype, docnum, email } = parseSendDocBody(req);
    const subject = String(req.body?.subject || '').trim();
    const bodyText = String(req.body?.bodyText || '').trim();
    if (!doctype || !docnum) return res.status(400).json({ error: 'document_required' });
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'email_invalid' });
    if (!subject) return res.status(400).json({ error: 'subject_required' });
    if (!bodyText) return res.status(400).json({ error: 'body_required' });

    try {
      await sendSimpleEmail({
        to: email,
        subject,
        bodyText,
        dealId: deal.id,
        contactId: String(req.body?.contactId || '') || null,
        createdByUserId: req.adminAuth?.userId || null,
      });
    } catch (err) {
      const code = err?.code || 'gmail_send_failed';
      console.error(`[icount] approved gmail fallback send failed: ${err?.message}`);
      const status = code === 'email_not_configured' || code === 'no_connected_account' ? 400 : 422;
      return res.status(status).json({ error: code });
    }

    await emitDocumentSentEvent(deal.id, { doctype, docnum, email, via: 'gmail' }, req.adminAuth?.userId || null);
    res.json({ ok: true, via: 'gmail' });
  }),
);

// ── Custom payment links ─────────────────────────────────────────────────────

function toClientCustomLink(req, row) {
  return {
    id: row.id,
    url: `${resolvePublicOrigin(req)}/payment/icount/c/${row.token}`,
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

    const url = `${resolvePublicOrigin(req)}/payment/icount/c/${row.token}`;
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
