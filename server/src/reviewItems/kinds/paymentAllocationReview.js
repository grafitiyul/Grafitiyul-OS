// Review card: one real payment and its per-deal allocations do not add up.
//
// Two situations, ONE card — because they are the same unfinished job seen from
// two sides, and an operator fixing it will move between them:
//
//   unallocated    money arrived that no deal has been credited with
//   over_allocated deals have been credited with more than actually arrived
//
// Why a card and not a block: the owner's ruling (2026-08-08) is that GOS must
// never stop real work because an allocation does not reconcile yet. An office
// splitting a ₪3,000 transfer across three deals will legitimately pass through
// an unbalanced state, and refusing to save would push the work back into a
// spreadsheet. So the state is allowed, recorded, and made impossible to lose.
//
// Why it can never inflate the books: the discrepancy lives entirely in the
// ALLOCATION layer. `amountMinor` — the real money — is untouched, and
// companyCollectionTotals counts each payment once from that field. An
// over-allocation of ₪200 is a bookkeeping disagreement, never ₪200 of revenue.
//
// Auto-resolves: syncAllocationReview() handles the card the moment the numbers
// meet, and re-opens it if they drift apart again. Exactly one card per
// payment, keyed on the allocation group.

import { registerReviewKind } from '../registry.js';

export const PAYMENT_ALLOCATION_REVIEW_KIND = 'payment_allocation_review';

registerReviewKind(PAYMENT_ALLOCATION_REVIEW_KIND, {
  labelHe: 'שיוך תשלום לא מאוזן',
  tone: 'alert',
  descriptionHe:
    'נוצר כשתשלום אחד מחולק בין כמה עסקאות והסכומים לא מסתדרים — '
    + 'או שנשאר כסף שלא שויך, או ששויך יותר ממה שבאמת התקבל. '
    + 'נסגר אוטומטית ברגע שהשיוך מאוזן.',
  buildLink: (item) => {
    const orderNo = item.data?.deals?.[0]?.orderNo || item.data?.orderNo;
    return orderNo ? `/admin/crm/deals/${orderNo}` : null;
  },
});
