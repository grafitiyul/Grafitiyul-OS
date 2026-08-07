// ── The merged Deal history feed ────────────────────────────────────────────
//
// After two deals are merged, the surviving deal must read as ONE chronological
// history of the whole real transaction — notes, changes, tasks, emails,
// WhatsApp, files, quotes, accounting events, tour activity, system events —
// interleaved by their REAL timestamps. Not deal A's history with deal B's
// underneath it: one story, in the order it happened.
//
// ── Nothing is copied ───────────────────────────────────────────────────────
//
// Every row keeps its real owner. A TimelineEntry written on the retired deal
// still has subjectId = the retired deal; an EmailMessage still belongs to its
// Gmail thread; a WhatsApp message still belongs to its chat. The merge changes
// WHICH IDS ARE READ, never the rows themselves. That is what makes the history
// honest — a note keeps its original author, its original timestamp, its
// original formatting and its pin state, because it is literally the same row —
// and it is what makes unmerging conceivable, should it ever be needed.
//
// ── Provenance without clutter ──────────────────────────────────────────────
//
// A row that came from the retired deal carries `mergedFrom: { dealId, orderNo,
// labelHe }`. The survivor's own rows carry null, so the common case renders
// exactly as it always did and only the genuinely foreign rows are marked.

import { prisma as defaultPrisma } from '../db.js';
import { lineageIdsFor } from '../deals/mergeLineage.js';
import { emailFeedItemsForDeal } from '../email/timelineMerge.js';
import { attachDeliveryToTimeline } from '../email/deliveryState.js';

const ENTRY_INCLUDE = {
  comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
};

/**
 * The lineage of a deal, with the order numbers needed to label foreign rows.
 * Returns { ids, labels: Map<dealId, {orderNo, labelHe}>, merged: boolean }.
 */
export async function dealLineageContext(db, dealId) {
  const ids = await lineageIdsFor(db, dealId);
  if (ids.length <= 1) return { ids, labels: new Map(), merged: false };
  const rows = await db.deal.findMany({
    where: { id: { in: ids.filter((id) => id !== dealId) } },
    select: { id: true, orderNo: true },
  });
  return {
    ids,
    labels: new Map(rows.map((r) => [r.id, { orderNo: r.orderNo, labelHe: `במקור מדיל #${r.orderNo}` }])),
    merged: true,
  };
}

/** Tag one feed item with where it came from, relative to THIS deal. */
function tag(item, dealId, labels) {
  const from = item.subjectId && item.subjectId !== dealId ? labels.get(item.subjectId) : null;
  return from ? { ...item, mergedFrom: { dealId: item.subjectId, ...from } } : { ...item, mergedFrom: null };
}

/**
 * THE deal activity feed, lineage-aware.
 *
 * Replaces what the timeline route used to assemble inline. A deal that was
 * never merged reads exactly one extra (indexed, empty) lookup and produces
 * byte-identical output — the merged case is the only one that behaves
 * differently, which is what keeps this safe to put on the hot path.
 */
export async function dealFeedItems(dealId, { db = defaultPrisma } = {}) {
  const { ids, labels } = await dealLineageContext(db, dealId);

  const entries = await db.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: { in: ids }, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: ENTRY_INCLUDE,
  });
  // Outgoing-email entries carry the INTENT frozen at queue time; the truth
  // lives on the queue row, so delivery state is resolved at READ time.
  const withDelivery = await attachDeliveryToTimeline(entries);
  // Emails merge in at READ time across the whole lineage — EmailMessage stays
  // the single source of truth, so a thread linked or unlinked on either deal is
  // reflected instantly with no copied rows.
  const emailItems = await emailFeedItemsForDeal(ids);

  return [...withDelivery, ...emailItems]
    .map((item) => tag(item, dealId, labels))
    // ONE chronological history. Sorting the COMBINED array (rather than
    // concatenating two sorted lists) is the whole point: a note written on the
    // retired deal on Tuesday belongs between Monday's and Wednesday's events on
    // the survivor, not in a block at the end.
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Pinned entries across the lineage — the Deal focus area.
 *
 * Pin state is preserved exactly as authored (rule: "keep pin state where
 * meaningful"), so a note pinned on the retired deal stays pinned on the merged
 * one. Ordering follows the same manual pinSortOrder, with the survivor's own
 * pins first so an existing focus list is not reshuffled by a merge.
 */
export async function dealPinnedItems(dealId, { db = defaultPrisma } = {}) {
  const { ids, labels } = await dealLineageContext(db, dealId);
  const rows = await db.timelineEntry.findMany({
    where: { subjectType: 'deal', subjectId: { in: ids }, isPinned: true, deletedAt: null },
    orderBy: [{ pinSortOrder: 'asc' }, { createdAt: 'desc' }],
    include: ENTRY_INCLUDE,
  });
  return rows
    .map((item) => tag(item, dealId, labels))
    .sort((a, b) => {
      const own = (x) => (x.subjectId === dealId ? 0 : 1);
      if (own(a) !== own(b)) return own(a) - own(b);
      if (a.pinSortOrder !== b.pinSortOrder) return a.pinSortOrder - b.pinSortOrder;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}
