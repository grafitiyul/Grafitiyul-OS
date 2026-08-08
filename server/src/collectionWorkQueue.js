// Collection WORK QUEUE — the operational layer on top of the accounting one.
//
// The accounting question ("how much is outstanding on this deal?") is answered
// by collection.js and is not touched here. This module answers a different,
// business question: SHOULD ANYONE CHASE THIS MONEY TODAY?
//
// They are genuinely different. 3,250 WON deals are not fully paid, but most are
// historical Pipedrive migrations whose money was settled years ago in a system
// GOS never saw. Listing them all turned the Collection screen into a report
// nobody could act on. The balance on those deals stays exactly what the resolver
// says — they are simply not WORK.
//
// ── GOS DOES NOT INVENT COLLECTION CANDIDATES ────────────────────────────────
// An earlier version guessed at rule A ("every unpaid business deal") because
// the Pipedrive filter could not be read. That heuristic manufactured 1,444
// candidates the business never asked for, and it is gone. There are now exactly
// TWO ways into the queue, both supplied as explicit inputs — this file infers
// nothing:
//
//   1. the one-time collection snapshot the business handed over;
//   2. a live future tour that is not fully paid.
//
// Nothing here reads or writes an amount, a document or an allocation.

export const COLLECTION_REVIEW_STATUS = {
  ACTIVE: 'active_collection',
  LEGACY: 'likely_paid_legacy',
  // Settled HERE, with evidence GOS holds. Added 2026-08-08 after the #27151
  // audit: the first real website sale — paid by card that afternoon and
  // documented by a GOS-issued חשבונית מס קבלה minutes later — was labelled
  // "ככל הנראה שולם במערכת קודמת" five minutes after it was born. The money
  // reading was right; the sentence was false, and a false provenance on a
  // financial screen is not a cosmetic problem.
  PAID_IN_GOS: 'paid_in_gos',
};

export const COLLECTION_REVIEW_STATUS_VALUES = Object.values(COLLECTION_REVIEW_STATUS);

export const COLLECTION_REVIEW_STATUS_LABELS = {
  active_collection: 'בגבייה פעילה',
  likely_paid_legacy: 'ככל הנראה שולם במערכת קודמת',
  paid_in_gos: 'שולם ותועד במערכת',
};

// Machine-set sources may be replaced by a later run. 'operator' never is — a
// human decision outranks every rule here.
export const SOURCE = {
  // The business's own hand-over list — the initial work queue, imported once.
  SNAPSHOT: 'migration:pipedrive_collection_snapshot',
  // A tour that has not happened yet and is not fully paid. Standing rule.
  FUTURE_TOUR: 'migration:future_tour_unpaid',
  LEGACY: 'migration:legacy_assumed_paid',
  // The deal was settled in GOS and GOS holds the evidence. NOT a migration
  // source — it is a statement about this system, which is the whole point.
  PAID_IN_GOS: 'gos:paid_in_gos',
  // A payment-review classification (deposit-vs-full audit) says only a
  // deposit was collected — even when the resolver reads "paid", because the
  // recorded agreed amount may itself be the deposit. Standing rule.
  PAYMENT_REVIEW: 'audit:payment_review_deposit',
  OPERATOR: 'operator',
};

export const isMachineSource = (s) =>
  typeof s === 'string' && (s.startsWith('migration:') || s.startsWith('audit:'));

// Payment-review values that mean "money is still owed (or probably owed)".
export const DEPOSIT_REVIEW_STATUSES = ['confirmed_deposit', 'suspected_deposit'];

/**
 * Classify ONE deal. Pure, and deliberately incapable of inventing a candidate:
 * both routes into the queue arrive as explicit booleans the caller resolved.
 *
 * @param summary  the CANONICAL collection summary (computeCollection). Payment
 *                 state is READ, never re-derived — the resolver stays the one
 *                 source of paid/balance.
 * @param ctx.inCollectionSnapshot  the deal is on the business's hand-over list
 * @param ctx.hasLiveFutureTour     an ACTIVE booking on a non-cancelled tour
 *                                  whose date is still ahead. Deliberately not
 *                                  Deal.tourDate: that is a plan which outlives
 *                                  the plan (a cancelled tour leaves its date
 *                                  behind), the same reason the CRM's activity
 *                                  ladder refuses to use it as a liveness test.
 * @param ctx.paymentReviewStatus   Deal.paymentReviewStatus — the reviewed
 *                                  deposit-vs-full classification. Not a guess
 *                                  made here: it arrives persisted, exactly
 *                                  like the snapshot.
 * @param ctx.settledInGos          GOS itself holds the settlement evidence:
 *                                  at least one document or evidence row that
 *                                  THIS system issued or recorded. Like every
 *                                  other input, it arrives resolved — this
 *                                  module still infers nothing.
 */
export function classifyDeal(
  summary,
  {
    inCollectionSnapshot = false,
    hasLiveFutureTour = false,
    paymentReviewStatus = null,
    settledInGos = false,
  } = {},
) {
  // The snapshot is a business decision about which deals are being collected.
  // It stands whatever the payment state says — if the business is chasing it,
  // it is work.
  if (inCollectionSnapshot) {
    return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.SNAPSHOT };
  }

  // A reviewed deposit-only (or suspected-deposit) deal with a tour still
  // ahead is work even when the resolver reads "paid" — the recorded agreed
  // amount may itself be the deposit, which is exactly what the review found.
  if (hasLiveFutureTour && DEPOSIT_REVIEW_STATUSES.includes(paymentReviewStatus)) {
    return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.PAYMENT_REVIEW };
  }

  // `status === 'paid'` is the resolver's own word for fully collected.
  const unpaid = summary.status !== 'paid';
  if (unpaid && hasLiveFutureTour) {
    return { status: COLLECTION_REVIEW_STATUS.ACTIVE, source: SOURCE.FUTURE_TOUR };
  }

  // Settled, and GOS can prove it. Checked BEFORE the legacy fall-through so a
  // deal this system collected is never described as somebody else's history.
  if (!unpaid && settledInGos) {
    return { status: COLLECTION_REVIEW_STATUS.PAID_IN_GOS, source: SOURCE.PAID_IN_GOS };
  }

  // Everything else is historical and assumed settled in the previous system.
  // A deliberate business decision, NOT a claim about the accounting — and now
  // reached only when GOS holds NO settlement evidence of its own, which is
  // exactly what "assumed paid elsewhere" was always supposed to mean.
  return { status: COLLECTION_REVIEW_STATUS.LEGACY, source: SOURCE.LEGACY };
}

/**
 * Should this deal's stored classification be written?
 *
 * An operator's decision is never touched. A machine-set value is replaced
 * whenever the rules now say something different — which is what lets this
 * correction retire the withdrawn business heuristic without a separate
 * rollback step, and what keeps the future-tour rule true as tours pass.
 */
export function shouldWrite(current, next) {
  if (current?.source === SOURCE.OPERATOR) return false;
  if (!current?.status) return true;
  return current.status !== next.status || current.source !== next.source;
}
