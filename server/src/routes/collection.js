import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { dealCollection, collectionDeals } from '../collection.js';
import {
  recordEvidence,
  reverseEvidence,
  resolveReview,
  listEvidence,
  settlementAmountMinor,
  PAYMENT_METHODS,
} from '../collectionEvidenceService.js';

// Collection (גבייה) endpoints — a thin HTTP layer over collection.js, the
// single source of truth for paid/balance math, plus the operator write paths.
// Two routers because the surfaces live under different mounts:
//
//   dealCollectionRouter  → /api/deals/:id/collection…   (the Deal panel)
//   collectionRouter      → /api/collection/deals        (the Collection screen)
//
// Every response's numbers come from dealCollection(); no handler here does
// financial arithmetic of its own.

// The columns the canonical resolver needs. Selected in one place so a new
// input can never be forgotten by one route and supplied by another.
const COLLECTION_DEAL_SELECT = {
  id: true,
  valueMinor: true,
  currency: true,
  collectionReview: true,
};

async function loadDeal(id) {
  return prisma.deal.findUnique({ where: { id }, select: COLLECTION_DEAL_SELECT });
}

function evidenceErrorStatus(code) {
  return code === 'not_found' || code === 'file_not_found' ? 404 : 400;
}

// THE response shape of the Collection panel — built in one place and returned
// by every handler here, including the writes. A write that answered with a
// thinner payload than the read would silently blank parts of the panel until
// the next refresh, which is exactly the kind of drift this module exists to
// prevent.
async function collectionPayload(deal) {
  const [summary, evidence] = await Promise.all([
    dealCollection(prisma, deal),
    listEvidence(prisma, deal.id),
  ]);
  return {
    ...summary,
    paymentMethods: PAYMENT_METHODS,
    // Manual rows INCLUDING reversed ones: a reversal must stay readable, so a
    // balance that changed is never unexplained.
    manualHistory: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      direction: e.direction,
      amountMinor: Number(e.amountMinor),
      currency: e.currency,
      paidAt: e.paidAt,
      method: e.method,
      reference: e.reference,
      note: e.note,
      status: e.status,
      reversedAt: e.reversedAt,
      reversedByName: e.reversedByName,
      reversalReason: e.reversalReason,
      createdAt: e.createdAt,
      createdByName: e.createdByName,
      origin: e.origin,
      file: e.file || null,
    })),
  };
}

export const dealCollectionRouter = Router();

dealCollectionRouter.get(
  '/:id/collection',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.json(await collectionPayload(deal));
  }),
);

// What a "סמן כשולם במלואו" click would actually record — the modal shows this
// number BEFORE the operator confirms, so a settlement is never a blind action.
dealCollectionRouter.get(
  '/:id/collection/settlement-preview',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const { balanceMinor, summary } = await settlementAmountMinor(prisma, deal);
    res.json({ balanceMinor, currency: summary.currency, totalMinor: summary.totalMinor, paidMinor: summary.paidMinor });
  }),
);

// Record manual evidence: a payment, a credit, or an explicit settlement.
dealCollectionRouter.post(
  '/:id/collection/evidence',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      const row = await recordEvidence(prisma, deal, req.body || {}, req.adminAuth?.userId || null);
      res.status(201).json({ id: row.id, ...(await collectionPayload(deal)) });
    } catch (err) {
      const code = err?.code || 'evidence_failed';
      return res.status(evidenceErrorStatus(code)).json({ error: code });
    }
  }),
);

// Reverse a manual row (an audited action — the row survives, greyed out).
dealCollectionRouter.post(
  '/:id/collection/evidence/:evidenceId/reverse',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      await reverseEvidence(prisma, deal, req.params.evidenceId, { reason: req.body?.reason }, req.adminAuth?.userId || null);
      res.json(await collectionPayload(deal));
    } catch (err) {
      const code = err?.code || 'reverse_failed';
      return res.status(evidenceErrorStatus(code)).json({ error: code });
    }
  }),
);

// "בדקתי — הכל תקין": clear the needs-review flag. Preserved, so a re-run of the
// historical reconstruction will not re-raise a question a human already answered.
dealCollectionRouter.post(
  '/:id/collection/review/resolve',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    await resolveReview(prisma, deal, { note: req.body?.note }, req.adminAuth?.userId || null);
    res.json(await collectionPayload({ ...deal, collectionReview: null }));
  }),
);

export const collectionRouter = Router();
collectionRouter.get(
  '/deals',
  handle(async (_req, res) => {
    res.json({ deals: await collectionDeals(prisma) });
  }),
);
