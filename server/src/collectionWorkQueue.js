// Collection WORK QUEUE — the operational layer on top of the accounting one.
//
// The accounting question ("how much is outstanding on this deal?") is answered
// by collection.js and is not touched here. This module answers a different,
// business question: SHOULD ANYONE CHASE THIS MONEY TODAY?
//
// They are genuinely different. 3,250 WON deals are not fully paid, but 6,792 of
// those are historical Pipedrive migrations whose money was settled years ago in
// a system GOS never saw. Listing them all turned the Collection screen into a
// report nobody could act on. The balance on those deals stays exactly what the
// resolver says — they are simply not WORK.
//
// Nothing in this file reads or writes an amount, a document or an allocation.

export const COLLECTION_REVIEW_STATUS = {
  ACTIVE: 'active_collection',
  LEGACY: 'likely_paid_legacy',
};

export const COLLECTION_REVIEW_STATUS_VALUES = Object.values(COLLECTION_REVIEW_STATUS);

export const COLLECTION_REVIEW_STATUS_LABELS = {
  active_collection: 'בגבייה פעילה',
  likely_paid_legacy: 'ככל הנראה שולם במערכת קודמת',
};

// Machine-set sources may be corrected by a later, better-informed run.
// 'operator' never is — a human decision outranks every rule here.
export const SOURCE = {
  BUSINESS: 'migration:business_unpaid',
  FUTURE_TOUR: 'migration:future_tour_unpaid',
  LEGACY: 'migration:legacy_assumed_paid',
  PIPEDRIVE_FILTER: 'migration:pipedrive_business_filter',
  OPERATOR: 'operator',
};

export const isMachineSource = (s) => typeof s === 'string' && s.startsWith('migration:');

/**
 * Classify ONE deal.
 *
 * @param deal            { tourDate, organizationId, activityType }
 * @param summary         the CANONICAL collection summary (computeCollection).
 *                        Payment state is never re-derived here — the resolver
 *                        is the single source, exactly as before.
 * @param ctx             { today, inBusinessCollectionSet }
 *
 * RULE A — business collection. A deal the business actively bills: an
 * organisation/business deal whose money has not fully arrived. When the real
 * Pipedrive "Business Collection" filter membership is available it is used
 * verbatim (`inBusinessCollectionSet`); otherwise this GOS-native equivalent
 * stands in, and the source records which one decided.
 *
 * RULE B — a tour that has not happened yet and is not fully paid. Unarguable
 * work: the customer is about to be served.
 *
 * Everything else is historical and assumed settled. That is a deliberate
 * business decision, NOT a claim about the accounting.
 */
export function classifyDeal(deal, summary, { today, inBusinessCollectionSet = false } = {}) {
  // `requiresCollection` is the resolver's own word for "not fully paid" —
  // reused rather than re-implemented, so payment logic lives in one place.
  const unpaid = summary.status !== 'paid';
  if (!unpaid) {
    // Fully collected. It is not work, and calling it "likely paid in the old
    // system" would be wrong — GOS knows it was paid.
    return { status: COLLECTION_REVIEW_STATUS.LEGACY, source: SOURCE.LEGACY, settled: true };
  }

  if (inBusinessCollectionSet) {
    return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.PIPEDRIVE_FILTER };
  }

  const future = !!deal.tourDate && String(deal.tourDate) >= today;
  if (future) return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.FUTURE_TOUR };

  const business = !!deal.organizationId || deal.activityType === 'business';
  if (business) return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.BUSINESS };

  return { status: COLLECTION_REVIEW_STATUS.LEGACY, source: SOURCE.LEGACY };
}

/**
 * Should this deal's stored classification be written?
 *
 * Only NULLs are populated, and a machine-set value may be corrected by a later
 * run that knows more (e.g. once the real Pipedrive filter is readable). An
 * operator's decision is never touched.
 */
export function shouldWrite(current, next, { allowMachineCorrection = false } = {}) {
  if (!current?.status) return true;
  if (current.source === SOURCE.OPERATOR) return false;
  if (!allowMachineCorrection) return false;
  if (!isMachineSource(current.source)) return false;
  return current.status !== next.status || current.source !== next.source;
}
