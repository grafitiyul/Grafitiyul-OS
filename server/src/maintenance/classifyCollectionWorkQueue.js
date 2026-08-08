import { computeCollection } from '../collection.js';
import { classifyDeal, shouldWrite, SOURCE, COLLECTION_REVIEW_STATUS } from '../collectionWorkQueue.js';
import { COLLECTION_SNAPSHOT_ORDER_NOS, COLLECTION_SNAPSHOT_EXPECTED } from '../collectionSnapshot.js';

// Classification of the Collection work queue.
//
// Populates Deal.collectionReviewStatus from exactly two business inputs — the
// hand-over snapshot and the live-future-tour rule. It reads payment state from
// the CANONICAL resolver and never recomputes it, and it writes nothing but the
// classification: no amount, document, allocation, builder or timeline row.
//
// It is a REPLACE, not a fill: a machine-set value is corrected whenever the
// rules now say something different. That is what retires the withdrawn
// "unpaid business deal" heuristic in the same pass, with no separate rollback,
// and what keeps the future-tour rule true as tours pass into the past.
// An OPERATOR decision is never overwritten.
//
// SAFETY GATE: the snapshot must resolve to exactly the expected number of
// deals. A missing order number means the hand-over list and GOS disagree, and
// the run aborts with the offending ids rather than silently queueing fewer
// deals than the business asked for.

export async function classifyCollectionWorkQueue(
  client,
  { log = console, dryRun = false, today = new Date().toISOString().slice(0, 10) } = {},
) {
  // ── The snapshot, resolved and verified before anything is written ────────
  const snapshotDeals = await client.deal.findMany({
    where: { orderNo: { in: [...COLLECTION_SNAPSHOT_ORDER_NOS] } },
    select: { id: true, orderNo: true },
  });
  const foundOrderNos = new Set(snapshotDeals.map((d) => d.orderNo));
  const missing = COLLECTION_SNAPSHOT_ORDER_NOS.filter((n) => !foundOrderNos.has(n));
  if (missing.length || snapshotDeals.length !== COLLECTION_SNAPSHOT_EXPECTED) {
    const err = new Error(
      `collection snapshot did not resolve: expected ${COLLECTION_SNAPSHOT_EXPECTED}, ` +
      `resolved ${snapshotDeals.length}${missing.length ? `, missing order numbers: ${missing.join(', ')}` : ''}`,
    );
    err.code = 'snapshot_unresolved';
    err.missing = missing;
    throw err;
  }
  const snapshotIds = new Set(snapshotDeals.map((d) => d.id));

  // ── Live future tours: an ACTIVE booking on a non-cancelled tour still ahead.
  // The canonical relationship, not Deal.tourDate — a cancelled tour leaves its
  // date on the deal, and that date must not put a dead deal in the queue.
  const futureRows = await client.$queryRawUnsafe(
    `select distinct b."dealId" id
       from "Booking" b
       join "TourEvent" te on te.id = b."tourEventId"
      where b.status = 'active' and te.status <> 'cancelled' and te.date >= $1`,
    today,
  );
  const liveFutureIds = new Set(futureRows.map((r) => r.id));

  const deals = await client.deal.findMany({
    where: { status: 'won' },
    select: {
      id: true, orderNo: true, valueMinor: true, currency: true, collectionReview: true,
      collectionReviewStatus: true, collectionReviewStatusSource: true,
      paymentReviewStatus: true,
    },
  });

  // The same two bulk reads the collection service performs — payment state
  // comes from computeCollection, never a second implementation.
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

  // Does GOS itself hold this deal's settlement evidence?
  //
  // "This system collected it" means a document GOS issued or captured from a
  // provider webhook, or money an operator/gateway recorded here. What it
  // deliberately does NOT include is `source: 'linked'` / `'backfill'` — a
  // document an operator attached after the fact, or the historical
  // reconstruction — because those describe money that moved somewhere else.
  // Same for `origin: 'backfill'` evidence.
  const settledInGos = (docs, evs) =>
    docs.some((d) => d.status === 'issued' && (d.source === 'user' || d.source === 'webhook'))
    || evs.some((e) => e.status === 'active' && e.direction === 'in' && e.origin !== 'backfill');

  const stats = {
    scanned: deals.length,
    snapshotResolved: snapshotDeals.length,
    liveFutureTours: liveFutureIds.size,
    active: 0,
    legacy: 0,
    paidInGos: 0,
    written: 0,
    unchanged: 0,
    operatorPreserved: 0,
    retiredHeuristic: 0,
    bySource: {},
  };
  const writes = [];

  for (const deal of deals) {
    const docs = docsBy.get(deal.id) || [];
    const evs = evBy.get(deal.id) || [];
    const summary = computeCollection(deal, docs, evs);
    const next = classifyDeal(summary, {
      inCollectionSnapshot: snapshotIds.has(deal.id),
      hasLiveFutureTour: liveFutureIds.has(deal.id),
      paymentReviewStatus: deal.paymentReviewStatus,
      settledInGos: settledInGos(docs, evs),
    });
    if (next.status === COLLECTION_REVIEW_STATUS.ACTIVE) stats.active += 1;
    else if (next.status === COLLECTION_REVIEW_STATUS.PAID_IN_GOS) stats.paidInGos += 1;
    else stats.legacy += 1;
    stats.bySource[next.source] = (stats.bySource[next.source] || 0) + 1;

    const current = { status: deal.collectionReviewStatus, source: deal.collectionReviewStatusSource };
    if (!shouldWrite(current, next)) {
      if (current.source === SOURCE.OPERATOR) stats.operatorPreserved += 1;
      else stats.unchanged += 1;
      continue;
    }
    // Deals the withdrawn "unpaid business deal" heuristic had queued.
    if (current.source === 'migration:business_unpaid') stats.retiredHeuristic += 1;
    writes.push({ id: deal.id, status: next.status, source: next.source });
  }

  if (dryRun) {
    log.log?.(
      `[work-queue] ${stats.active} active · ${stats.legacy} legacy · ${writes.length} would change ` +
      `(${stats.retiredHeuristic} retiring the withdrawn business heuristic) — dry run`,
    );
    return { ...stats, wouldWrite: writes.length };
  }

  const now = new Date();
  const CHUNK = 500;
  for (let i = 0; i < writes.length; i += CHUNK) {
    // Grouped by (status, source) so a chunk is a few updateMany calls rather
    // than hundreds of round trips. A plain field write — deliberately NOT
    // touchDealActivity: classifying a deal is not business activity and must
    // never reorder the CRM.
    const groups = new Map();
    for (const w of writes.slice(i, i + CHUNK)) {
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
    stats.written += Math.min(CHUNK, writes.length - i);
  }

  log.log?.(
    `[work-queue] ${stats.active} active_collection · ${stats.legacy} likely_paid_legacy — ` +
    `${stats.written} changed (${stats.retiredHeuristic} withdrawn-heuristic deals returned to legacy), ` +
    `${stats.unchanged} unchanged, ${stats.operatorPreserved} operator decisions preserved; ` +
    `by rule: ${JSON.stringify(stats.bySource)}`,
  );
  return stats;
}
