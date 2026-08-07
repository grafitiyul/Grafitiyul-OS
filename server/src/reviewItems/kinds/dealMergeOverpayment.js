// Review card: merging two deals left the customer having paid MORE than the
// merged deal is worth.
//
// This is the ordinary outcome of a real duplicate: the customer was invoiced
// on both deals, or paid a deposit twice, and once the two become one the money
// already received exceeds the single agreed total. Nothing is BROKEN — the
// payments are real, the documents are valid, the merged total is what the
// operator chose — so a בקרה control issue would be wrong (it would teach the
// office to ignore the detectors that catch genuinely incoherent state).
//
// What exists is an unmade business decision: issue a credit note, refund, or
// carry the balance against future work. Every one of those is a person's call
// under the existing accounting rules, and GOS never fabricates a refund. The
// system's job is to make the situation impossible to miss.
//
// Resolved by hand once the operator has issued the credit, refunded, or
// decided to leave the balance standing.

import { registerReviewKind } from '../registry.js';

export const DEAL_MERGE_OVERPAYMENT_KIND = 'deal_merge_overpayment';

registerReviewKind(DEAL_MERGE_OVERPAYMENT_KIND, {
  labelHe: 'יתרת זכות לאחר איחוד דילים',
  tone: 'alert',
  descriptionHe:
    'נוצר כששני דילים אוחדו והסכום ששולם בשניהם יחד גבוה מהסכום המשולב של הדיל המאוחד. '
    + 'לא הופק זיכוי ולא בוצע החזר אוטומטית — נדרשת החלטה של הגורם המטפל לפי כללי החשבונאות.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.orderNo || item.dealId}` : null),
});

/**
 * Exactly-once key: ONE card per surviving deal per overpaid AMOUNT.
 *
 * Keyed on the amount rather than the deal alone on purpose — a SECOND merge
 * into the same survivor that changes the size of the credit is a materially
 * different situation and deserves its own card, while re-running the same
 * merge (retry, double click, effects replay) can never produce a duplicate.
 */
export const dealMergeOverpaymentKey = (survivorDealId, overpaidMinor) =>
  `${DEAL_MERGE_OVERPAYMENT_KIND}:${survivorDealId}:${overpaidMinor}`;
