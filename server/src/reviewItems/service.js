// ReviewItem lifecycle — the ONE way a card is created or handled.
//
// Two rules the whole module rests on:
//
//   1. EXACTLY ONCE. Creation is keyed on a business-event dedupeKey, so a
//      re-submitted questionnaire, a replayed automation or a double click can
//      never produce a second card.
//   2. INDEPENDENT. Each card is its own row. A tour's summary card and its
//      logistics card are two rows, so handling one structurally cannot touch
//      the other — that independence is not a UI convention, it is the model.

import { prisma } from '../db.js';
import { isKnownReviewKind } from './registry.js';

export const REVIEW_STATUSES = ['open', 'handled'];

/**
 * Create a review card, or return the existing one for this business event.
 *
 * Returns { item, created } — `created: false` means the dedupeKey already
 * existed, which is a normal outcome and never an error.
 */
export async function createReviewItem(
  { kind, dedupeKey, title, summary = null, data = null, entityRefs = [],
    tourEventId = null, submissionId = null, personRefId = null, dealId = null, autId = null },
  { db = prisma } = {},
) {
  if (!isKnownReviewKind(kind)) throw new Error(`unknown review kind: ${kind}`);
  if (!dedupeKey) throw new Error('dedupeKey is required — it is the exactly-once guarantee');

  try {
    const item = await db.reviewItem.create({
      data: {
        kind, dedupeKey, title, summary, data, entityRefs,
        tourEventId, submissionId, personRefId, dealId, autId,
      },
    });
    return { item, created: true };
  } catch (err) {
    if (err?.code === 'P2002') {
      const item = await db.reviewItem.findUnique({ where: { dedupeKey } });
      return { item, created: false };
    }
    throw err;
  }
}

/**
 * Mark ONE card handled. Scoped by id and guarded on status, so handling a card
 * twice is a no-op rather than a rewritten timestamp, and no sibling card is
 * touched.
 */
export async function handleReviewItem(id, { userId = null, userName = null }, { db = prisma } = {}) {
  const res = await db.reviewItem.updateMany({
    where: { id, status: 'open' },
    data: { status: 'handled', handledAt: new Date(), handledBy: userId, handledByName: userName },
  });
  return { changed: res.count > 0 };
}

/** Reopen a card that was handled by mistake. */
export async function reopenReviewItem(id, { db = prisma } = {}) {
  const res = await db.reviewItem.updateMany({
    where: { id, status: 'handled' },
    data: { status: 'open', handledAt: null, handledBy: null, handledByName: null },
  });
  return { changed: res.count > 0 };
}

/**
 * The inbox, GROUPED BY TOUR.
 *
 * Cards about the same tour belong together on screen (a summary and its
 * logistics report are read as one situation), while remaining independent
 * rows underneath. Grouping is a presentation decision made here so both the
 * screen and the digest email agree on it.
 */
export async function loadInbox({ status = 'open', limit = 200, db = prisma } = {}) {
  const items = await db.reviewItem.findMany({
    where: { status },
    orderBy: status === 'open' ? { createdAt: 'desc' } : { handledAt: 'desc' },
    take: limit,
  });

  const groups = new Map();
  for (const item of items) {
    // Cards with no tour still appear — grouped under their own id so nothing
    // is ever hidden for lacking a tour.
    const key = item.tourEventId || `item:${item.id}`;
    if (!groups.has(key)) groups.set(key, { tourEventId: item.tourEventId, cards: [] });
    groups.get(key).cards.push(item);
  }

  return {
    status,
    total: items.length,
    counts: countByKind(items),
    groups: [...groups.values()],
  };
}

export function countByKind(items) {
  const out = {};
  for (const i of items) out[i.kind] = (out[i.kind] || 0) + 1;
  return out;
}

/** Open-card counts per kind — used by the digest email and the nav badge. */
export async function openCounts({ db = prisma } = {}) {
  const rows = await db.reviewItem.groupBy({
    by: ['kind'],
    where: { status: 'open' },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.kind, r._count._all]));
}
