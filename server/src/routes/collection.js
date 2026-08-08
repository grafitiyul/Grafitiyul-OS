import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { dealCollection, collectionDeals, companyCollectionTotals } from '../collection.js';
import { activeDealWhere } from '../deals/mergeLineage.js';
import { listQueue, queueCounts, resolveQueueItem } from '../collectionReviewQueue.js';
import { COLLECTION_REVIEW_STATUS, COLLECTION_REVIEW_STATUS_VALUES } from '../collectionWorkQueue.js';
import { allocationsForDeal } from '../payments/allocation.js';
import {
  recordEvidence,
  reverseEvidence,
  resolveReview,
  setPaymentReview,
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
  // The OPERATIONAL work-queue status, so the Deal panel can badge a historical
  // deal. Presentation only — it never enters the collection math.
  collectionReviewStatus: true,
  // Deposit-vs-full payment review — presentation only, same rule.
  paymentReviewStatus: true,
  paymentReviewSource: true,
  paymentReviewEvidence: true,
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
  const [summary, evidence, allocations] = await Promise.all([
    dealCollection(prisma, deal),
    listEvidence(prisma, deal.id),
    // Where the REST of a split payment went. Presentation context only — the
    // money on this deal is still computeCollection's answer, and the panel
    // does no arithmetic with these numbers.
    allocationsForDeal(prisma, deal.id),
  ]);
  return {
    ...summary,
    allocations,
    collectionReviewStatus: deal.collectionReviewStatus || null,
    paymentReviewStatus: deal.paymentReviewStatus || null,
    paymentReviewSource: deal.paymentReviewSource || null,
    paymentReviewEvidence: deal.paymentReviewEvidence || null,
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
    // Resolving a deposit-review question can carry the operator's verdict in
    // the same action ("checked — it really was only a deposit / it was paid
    // in full"), so the review list and the classification never disagree.
    if (req.body?.paymentReviewStatus !== undefined) {
      await setPaymentReview(
        prisma,
        deal,
        { status: req.body.paymentReviewStatus, note: req.body?.note },
        req.adminAuth?.userId || null,
      );
    }
    const fresh = await loadDeal(req.params.id);
    res.json(await collectionPayload(fresh));
  }),
);

// Operator's deposit-vs-full verdict, standalone (filterable classification —
// never money: amounts stay computeCollection()'s answer).
dealCollectionRouter.post(
  '/:id/collection/payment-review',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      await setPaymentReview(
        prisma,
        deal,
        { status: req.body?.status ?? null, note: req.body?.note },
        req.adminAuth?.userId || null,
      );
    } catch (err) {
      return res.status(400).json({ error: err?.code || 'payment_review_failed' });
    }
    const fresh = await loadDeal(req.params.id);
    res.json(await collectionPayload(fresh));
  }),
);

export const collectionRouter = Router();
// The work queue.  narrows it to the deals someone should be
// chasing; the default is the ACTIVE queue rather than every historical unpaid
// migration. 'all' asks for the full accounting picture, unchanged.
collectionRouter.get(
  '/deals',
  handle(async (req, res) => {
    const raw = String(req.query.reviewStatus || COLLECTION_REVIEW_STATUS.ACTIVE);
    const reviewStatus = raw === 'all' ? null : COLLECTION_REVIEW_STATUS_VALUES.includes(raw) ? raw : COLLECTION_REVIEW_STATUS.ACTIVE;
    const [deals, counts] = await Promise.all([
      collectionDeals(prisma, { reviewStatus }),
      // Counts across the WHOLE queue, so the tabs are honest about what is
      // hidden — computed from the persisted field, not from the money.
      // Same population the work queue lists (collectionDeals) — retired deals
      // excluded, or the tab counts would promise rows the list never shows.
      prisma.deal.groupBy({
        by: ['collectionReviewStatus'],
        where: activeDealWhere({ status: 'won' }),
        _count: { _all: true },
      }),
    ]);
    // Two different true numbers, and the tab must show the one that matches
    // what is on screen. `counts` is how many deals CARRY each classification;
    // the list additionally drops deals that are already fully collected (a
    // deal on the business's queue that has since been paid is not work). So
    // the SELECTED tab reports the list it actually rendered, and the others
    // report their classification totals.
    const classified = Object.fromEntries(counts.map((c) => [c.collectionReviewStatus || 'unclassified', c._count._all]));
    res.json({
      deals,
      reviewStatus: reviewStatus || 'all',
      counts: { ...classified, ...(reviewStatus ? { [reviewStatus]: deals.length } : { all: deals.length }) },
      classifiedCounts: classified,
      // How many deals in this queue are settled and therefore not shown.
      settledHidden: reviewStatus ? Math.max(0, (classified[reviewStatus] || 0) - deals.length) : 0,
    });
  }),
);

// Company-level totals. A DIFFERENT question from the per-deal one: a shared
// historical document settles several deals but contributes its own amount
// exactly once here, so linking it can never inflate revenue.
collectionRouter.get(
  '/totals',
  handle(async (req, res) => {
    res.json(await companyCollectionTotals(prisma, { currency: String(req.query.currency || 'ILS') }));
  }),
);

// ── Second-stage review queue ───────────────────────────────────────────────
collectionRouter.get(
  '/review',
  handle(async (req, res) => {
    const [queue, counts] = await Promise.all([
      listQueue(prisma, {
        status: String(req.query.status || 'open'),
        limit: Number(req.query.limit) || 200,
        offset: Number(req.query.offset) || 0,
      }),
      queueCounts(prisma),
    ]);
    res.json({ ...queue, counts });
  }),
);

collectionRouter.post(
  '/review/:itemId/resolve',
  handle(async (req, res) => {
    try {
      const out = await resolveQueueItem(
        prisma,
        req.params.itemId,
        { action: String(req.body?.action || ''), note: req.body?.note },
        req.adminAuth?.userId || null,
      );
      res.json(out);
    } catch (err) {
      const code = err?.code || 'resolve_failed';
      return res.status(code === 'not_found' ? 404 : 400).json({ error: code });
    }
  }),
);
