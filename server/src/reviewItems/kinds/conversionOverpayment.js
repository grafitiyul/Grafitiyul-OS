// Review card: an activity-type conversion left the customer having paid MORE
// than the deal is now worth.
//
// The rule this card enforces: GOS never fabricates a refund. A cheaper target
// activity (a private tour downgraded to two open-tour seats, a shortened
// business event) is a real commercial situation with real accounting
// consequences — a credit note, a refund, or a decision to carry the balance —
// and every one of those is a person's call under the existing accounting
// rules. The system's job is to make the situation impossible to miss, not to
// resolve it.
//
// Deliberately NOT a בקרה control card, for the same reason as
// post_payment_completion: nothing is BROKEN. The tour is correct, the seats
// are correct, the money is correctly recorded. What exists is an unmade
// business decision, which is exactly what the Management Tasks inbox is for.
// Raising a control issue here would teach the office to ignore the detectors
// that catch genuinely incoherent state.
//
// Resolved by hand once the operator has issued the credit, refunded, or
// decided to leave the balance standing.

import { registerReviewKind } from '../registry.js';

export const CONVERSION_OVERPAYMENT_KIND = 'conversion_overpayment';

registerReviewKind(CONVERSION_OVERPAYMENT_KIND, {
  labelHe: 'יתרת זכות לאחר שינוי סוג פעילות',
  tone: 'alert',
  descriptionHe:
    'נוצר כשסוג הפעילות של דיל שונה והסכום החדש נמוך מהסכום שכבר שולם. '
    + 'לא הופק זיכוי ולא בוצע החזר אוטומטית — נדרשת החלטה של הגורם המטפל לפי כללי החשבונאות.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.orderNo || item.dealId}` : null),
});

/**
 * Exactly-once key: ONE card per deal per overpaid AMOUNT.
 *
 * Keyed on the amount rather than the deal alone on purpose — a second
 * conversion that changes the size of the credit is a materially different
 * situation and deserves its own card, while re-running the same conversion
 * (retry, double click) can never produce a duplicate.
 */
export const conversionOverpaymentKey = (dealId, overpaidMinor) =>
  `${CONVERSION_OVERPAYMENT_KIND}:${dealId}:${overpaidMinor}`;
