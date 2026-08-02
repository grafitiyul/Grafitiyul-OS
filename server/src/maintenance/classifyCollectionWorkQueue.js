import { computeCollection } from '../collection.js';
import { classifyDeal, shouldWrite, SOURCE, COLLECTION_REVIEW_STATUS } from '../collectionWorkQueue.js';

// One-time (and re-runnable) classification of the Collection work queue.
//
// Populates Deal.collectionReviewStatus. It reads payment state from the
// CANONICAL resolver and never recomputes it, and it writes nothing that is not
// the classification itself: no amount, document, allocation, builder or
// timeline row is touched by this script.
//
// SAFETY
//   • only NULLs are populated;
//   • an OPERATOR decision is never overwritten;
//   • a machine-set value is corrected only when explicitly asked
//     (`allowMachineCorrection`), which is what lets the real Pipedrive
//     "Business Collection" membership promote a deal later without
//     re-litigating anything a human has since decided.
//
// `businessCollectionDealIds` is the real filter membership when it can be
// read. It is optional on purpose: at the time of writing the Pipedrive API is
// returning "daily request budget exceeded", so the GOS-native equivalent (an
// unpaid business deal) stands in and every row records WHICH rule decided it.

export async function classifyCollectionWorkQueue(
  client,
  { log = console, dryRun = false, today = new Date().toISOString().slice(0, 10), businessCollectionDealIds = null, allowMachineCorrection = false } = {},
) {
  const deals = await client.deal.findMany({
    where: { status: 'won' },
    select: {
      id: true, orderNo: true, valueMinor: true, currency: true, collectionReview: true,
      tourDate: true, organizationId: true, activityType: true,
      collectionReviewStatus: true, collectionReviewStatusSource: true,
    },
  });
  if (!deals.length) return { scanned: 0 };

  // The same two bulk reads the collection service does — payment state comes
  // from computeCollection, never from a second implementation.
  const [documents, evidence] = await Promise.all([
    client.icountDocument.findMany({ where: { status: 'issued' } }),
    client.dealCollectionEvidence.findMany({ where: { status: 'active' } }),
  ]);
  const docsBy = new Map();
  for (const d of documents) {
    if (!docsBy.has(d.dealId)) docsBy.set(d.dealId, []);
    docsBy.get(d.dealId).push(d);
  }
  const evBy = new Map();
  for (const e of evidence) {
    if (!evBy.has(e.dealId)) evBy.set(e.dealId, []);
    evBy.get(e.dealId).push(e);
  }

  const businessSet = businessCollectionDealIds ? new Set(businessCollectionDealIds) : null;
  const stats = { scanned: deals.length, active: 0, legacy: 0, written: 0, unchanged: 0, operatorPreserved: 0, bySource: {} };
  const writes = [];

  for (const deal of deals) {
    const summary = computeCollection(deal, docsBy.get(deal.id) || [], evBy.get(deal.id) || []);
    const next = classifyDeal(deal, summary, {
      today,
      inBusinessCollectionSet: businessSet ? businessSet.has(deal.id) : false,
    });
    if (next.status === COLLECTION_REVIEW_STATUS.ACTIVE) stats.active += 1;
    else stats.legacy += 1;
    stats.bySource[next.source] = (stats.bySource[next.source] || 0) + 1;

    const current = { status: deal.collectionReviewStatus, source: deal.collectionReviewStatusSource };
    if (!shouldWrite(current, next, { allowMachineCorrection })) {
      if (current.source === SOURCE.OPERATOR) stats.operatorPreserved += 1;
      else stats.unchanged += 1;
      continue;
    }
    writes.push({ id: deal.id, status: next.status, source: next.source });
  }

  if (dryRun) {
    log.log?.(`[work-queue] ${stats.active} active · ${stats.legacy} legacy · ${writes.length} would be written (dry run)`);
    return { ...stats, wouldWrite: writes.length };
  }

  const now = new Date();
  const CHUNK = 500;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const slice = writes.slice(i, i + CHUNK);
    // Grouped by (status, source) so a chunk is a handful of updateMany calls
    // rather than 500 round trips. A plain field write — deliberately NOT
    // touchDealActivity: classifying a deal is not business activity and must
    // never reorder the CRM.
    const groups = new Map();
    for (const w of slice) {
      const key = `${w.status}|${w.source}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w.id);
    }
    await client.$transaction(
      [...groups.entries()].map(([key, ids]) => {
        const [status, source] = key.split('|');
        return client.deal.updateMany({
          where: { id: { in: ids } },
          data: { collectionReviewStatus: status, collectionReviewStatusSource: source, collectionReviewStatusAt: now },
        });
      }),
    );
    stats.written += slice.length;
  }

  log.log?.(
    `[work-queue] classified ${stats.written} deals — ${stats.active} active_collection, ${stats.legacy} likely_paid_legacy ` +
    `(${stats.unchanged} already set, ${stats.operatorPreserved} operator decisions preserved); by rule: ${JSON.stringify(stats.bySource)}`,
  );
  return stats;
}
