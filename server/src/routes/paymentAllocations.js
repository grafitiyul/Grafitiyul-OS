// Multi-deal payment allocation API.
//
// Four endpoints, all operator-directed (rule 17: no webhook ever guesses a
// second deal):
//
//   GET  /api/payments/allocations/deal-search   the canonical Deal picker,
//                                                enriched with each deal's real
//                                                paid/remaining figures
//   GET  /api/payments/allocations/:groupId      one payment's current split
//   POST /api/payments/allocations/:groupId      apply / correct a split
//   POST /api/deals/:id/collection/allocate      adopt an existing single-deal
//                                                payment row and split it
//
// Nothing here talks to iCount. Re-allocating is an INTERNAL correction to
// which deals a payment settles; the issued accounting document is immutable
// and is never edited, re-issued or cancelled by these routes.

import express from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { searchDeals } from '../search/providers/deals.js';
import { phoneQuery } from '../search/phoneQuery.js';
import { collectionSummariesFor } from '../collection.js';
import { israelToday } from '../lib/israelDate.js';
import {
  SOURCE_KINDS,
  applyAllocations,
  crossCustomerCheck,
  emitAllocationTimeline,
  ensureGroup,
  loadAllocationGroup,
  syncAllocationReview,
} from '../payments/allocation.js';
import { userOrigin } from '../timeline/events.js';
import { registerDealOrderNoParam } from './dealParam.js';
import { listDealDocuments, ICOUNT_DEAL_INCLUDE } from '../icountDocs.js';
import { composeMultiDealDocument, rankSourceCandidates } from '../payments/multiDealDocument.js';

// Provider failures are 422 (never 502/504) — the project-wide rule.
const providerErrorStatus = (code) =>
  (code === 'icount_request_failed' || code === 'icount_not_configured' || code === 'icount_timeout' ? 422 : 400);

const router = express.Router();

const BAD_REQUEST = new Set([
  'allocation_empty',
  'allocation_deal_missing',
  'allocation_amount_invalid',
  'allocation_deal_duplicate',
  'allocation_deal_retired',
  'allocation_origin_required',
  'cross_customer_confirmation_required',
]);

const PREPARE_BAD_REQUEST = new Set([
  'invalid_doctype',
  'deals_required',
  'deal_missing',
  'deal_duplicate',
  'base_document_type_invalid',
  'allocation_amount_invalid',
]);

const statusFor = (code) => (code === 'allocation_group_not_found' || code === 'payment_row_not_found' || code === 'deal_not_found'
  ? 404
  : BAD_REQUEST.has(code) ? 400 : 500);

async function actorOf(req) {
  const userId = req.adminAuth?.userId || null;
  const origin = await userOrigin(userId);
  return { type: 'user', id: userId, name: origin?.createdByName || null };
}

// ── The Deal picker ──────────────────────────────────────────────────────────
// Reuses the CANONICAL global-search deal provider (no second deal search) and
// adds the only thing the allocation dialog needs beyond identification: what
// each deal has actually collected, straight from computeCollection.
router.get(
  '/allocations/deal-search',
  handle(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const excludeIds = String(req.query.exclude || '').split(',').map((s) => s.trim()).filter(Boolean);

    const { hits, truncated } = await searchDeals(
      q,
      phoneQuery(q),
      20,
      israelToday(),
      prisma,
      // A deal retired by a merge is never an allocation target — its money is
      // already read through the survivor.
      { activeOnly: true, excludeIds },
    );
    const rows = hits
      .sort((a, b) => b.score - a.score || a.groupRank - b.groupRank || b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((h) => h.dto());

    // The financial columns come from the ONE resolver, in a single bulk call.
    const summaries = await collectionSummariesFor(
      prisma,
      rows.map((r) => ({ id: r.id, valueMinor: BigInt(r.valueMinor || 0), currency: r.currency, collectionReview: null })),
    );

    res.json({
      truncated,
      results: rows.map((r) => {
        const s = summaries.get(r.id);
        return {
          ...r,
          totalMinor: s?.totalMinor ?? r.valueMinor,
          paidMinor: s?.paidMinor ?? 0,
          remainingMinor: s?.balanceMinor ?? r.valueMinor,
          collectionStatus: s?.status ?? null,
        };
      }),
    });
  }),
);

// ── Multi-deal document wizard ───────────────────────────────────────────────
//
// Composes the PLAN only. Nothing is issued here — the plan pre-fills the
// normal "הפק מסמך" composer and the operator issues from there, so there is
// exactly one document composer in GOS and one issue path.

// Candidate source documents for ONE deal, ranked for a target doctype.
// Reuses the deal's existing document list (GOS rows + live iCount search) —
// no second document lookup.
router.get(
  '/multi-deal-document/sources',
  handle(async (req, res) => {
    const dealId = String(req.query.dealId || '');
    const doctype = String(req.query.doctype || '');
    if (!dealId || !doctype) return res.status(400).json({ error: 'deal_and_doctype_required' });
    // listDealDocuments reads the deal's contact/org channels to search iCount,
    // so it needs the canonical include — the same one the single-deal route uses.
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: ICOUNT_DEAL_INCLUDE });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    try {
      const { documents, liveError } = await listDealDocuments(prisma, deal);
      res.json({ candidates: rankSourceCandidates(documents, doctype), liveError: liveError || null });
    } catch (err) {
      res.status(providerErrorStatus(err?.code || 'sources_failed'))
        .json({ error: err?.code || 'sources_failed', reason: err?.reason || null });
    }
  }),
);

router.post(
  '/multi-deal-document/prepare',
  handle(async (req, res) => {
    try {
      const plan = await composeMultiDealDocument(prisma, req.body || {});
      // Different customers on one accounting document is legitimate but must
      // never happen by accident — the SAME check the allocation dialog uses.
      const cross = await crossCustomerCheck(prisma, plan.perDeal.map((d) => d.dealId));
      res.json({ ...plan, crossCustomer: cross });
    } catch (err) {
      const code = err?.code || 'prepare_failed';
      if (!BAD_REQUEST.has(code) && !PREPARE_BAD_REQUEST.has(code)) {
        console.error(`[multi-deal-doc] prepare failed: ${err?.message}`);
      }
      res.status(PREPARE_BAD_REQUEST.has(code) ? 400 : statusFor(code))
        .json({ error: code, detail: err?.detail || null, reason: err?.reason || null });
    }
  }),
);

// ── Read one payment's split ─────────────────────────────────────────────────
router.get(
  '/allocations/:groupId',
  handle(async (req, res) => {
    const group = await loadAllocationGroup(prisma, req.params.groupId);
    if (!group) return res.status(404).json({ error: 'allocation_group_not_found' });
    const audit = await prisma.paymentAllocationEvent.findMany({
      where: { allocationGroupId: group.groupId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ group, audit });
  }),
);

// ── Apply / correct a split ──────────────────────────────────────────────────
//
// POST-ISSUE RE-ALLOCATION lives here too, deliberately as the SAME call: an
// operator moving ₪200 from #27101 to #27102 is describing the desired end
// state, exactly as they did when first splitting the payment. One write path,
// one audit shape, no "edit" mode that could drift from "create".
router.post(
  '/allocations/:groupId',
  handle(async (req, res) => {
    const groupId = req.params.groupId;
    const plan = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const reason = String(req.body?.reason || '').trim() || null;
    const confirmCrossCustomer = req.body?.confirmCrossCustomer === true;

    const before = await loadAllocationGroup(prisma, groupId);
    if (!before) return res.status(404).json({ error: 'allocation_group_not_found' });

    try {
      // Cross-customer is a WARNING that must be acknowledged, never a block:
      // one company paying for several people's bookings is a real case.
      const dealIds = plan.map((a) => a?.dealId).filter(Boolean);
      const cross = await crossCustomerCheck(prisma, dealIds);
      if (cross.cross && !confirmCrossCustomer) {
        return res.status(409).json({ error: 'cross_customer_confirmation_required', crossCustomer: cross });
      }

      const actor = await actorOf(req);
      const result = await prisma.$transaction((tx) =>
        applyAllocations(tx, { groupId, plan, actor, reason, originDealId: before.allocations[0]?.dealId }));

      const after = await loadAllocationGroup(prisma, groupId);
      if (after) {
        await emitAllocationTimeline(prisma, after, { actor, reason });
        await syncAllocationReview(prisma, groupId);
      }
      res.json({ group: after, result });
    } catch (err) {
      const code = err?.code || 'allocation_failed';
      if (statusFor(code) === 500) console.error(`[allocation] ${groupId} failed: ${err?.message}`);
      res.status(statusFor(code)).json({ error: code, detail: err?.detail || null });
    }
  }),
);

export default router;

// ── Deal-scoped entry point ──────────────────────────────────────────────────
// "שייך לדילים נוספים" on a payment row that has no group yet — every
// historical single-deal document and every manual evidence row. Adopting the
// row into a group is idempotent, so a double-click cannot create two.
export const dealAllocationRouter = express.Router();

// THE canonical deal-param resolver: accepts the orderNo form of the URL and
// carries the retired-deal write block, exactly like every other deal-scoped
// router (routes/dealParam.js).
registerDealOrderNoParam(dealAllocationRouter, 'dealId');

dealAllocationRouter.post(
  '/:dealId/collection/allocate',
  handle(async (req, res) => {
    const sourceKind = req.body?.sourceKind === SOURCE_KINDS.EVIDENCE
      ? SOURCE_KINDS.EVIDENCE
      : SOURCE_KINDS.DOCUMENT;
    const rowId = String(req.body?.rowId || '');
    const plan = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const reason = String(req.body?.reason || '').trim() || null;
    const confirmCrossCustomer = req.body?.confirmCrossCustomer === true;
    if (!rowId) return res.status(400).json({ error: 'payment_row_required' });

    try {
      const dealIds = plan.map((a) => a?.dealId).filter(Boolean);
      const cross = await crossCustomerCheck(prisma, dealIds);
      if (cross.cross && !confirmCrossCustomer) {
        return res.status(409).json({ error: 'cross_customer_confirmation_required', crossCustomer: cross });
      }

      const actor = await actorOf(req);
      const { groupId, row } = await ensureGroup(prisma, { sourceKind, rowId });
      // The payment row must belong to the deal in the URL — a request may
      // never adopt another deal's document by guessing its row id.
      if (row.dealId !== req.params.dealId) {
        return res.status(404).json({ error: 'payment_row_not_found' });
      }
      await prisma.$transaction((tx) =>
        applyAllocations(tx, { groupId, plan, actor, reason, originDealId: row.dealId }));

      const group = await loadAllocationGroup(prisma, groupId);
      if (group) {
        await emitAllocationTimeline(prisma, group, { actor, reason });
        await syncAllocationReview(prisma, groupId);
      }
      res.status(201).json({ group });
    } catch (err) {
      const code = err?.code || 'allocation_failed';
      if (statusFor(code) === 500) console.error(`[allocation] deal allocate failed: ${err?.message}`);
      res.status(statusFor(code)).json({ error: code, detail: err?.detail || null });
    }
  }),
);
