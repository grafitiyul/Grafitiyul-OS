// Review card: a conversion COMMITTED, but one of its external effects did not.
//
// §12's rule, made concrete: an external side-effect that fails after the
// database has committed must NEVER roll back the customer's real conversion.
// The deal really did change activity type; the tour really was created; the
// seats really moved. What failed is a mirror — the Google Calendar sync kick,
// the WooCommerce stock kick, the payroll projection, or the reconciliation of
// scheduled messages.
//
// So the card is LOUD but not alarming about the wrong thing: it names exactly
// which effect is outstanding and carries the identifiers needed to finish it,
// and the retry it points at is idempotent by construction (every effect
// re-runs safely, and none of them can re-convert anything).
//
// Deliberately a review card rather than a בקרה issue: the underlying state is
// self-healing — the calendar and Woo reconcilers sweep on their own schedule
// and will converge without help. This card exists so that a human knows a
// convergence is pending instead of discovering it from a guide standing at the
// wrong meeting point.

import { registerReviewKind } from '../registry.js';

export const CONVERSION_RECOVERY_KIND = 'conversion_recovery';

registerReviewKind(CONVERSION_RECOVERY_KIND, {
  labelHe: 'השלמת סנכרון לאחר שינוי סוג פעילות',
  tone: 'alert',
  descriptionHe:
    'שינוי סוג הפעילות בוצע ונשמר במלואו, אך אחד מהעדכונים החיצוניים (יומן, מלאי בחנות, '
    + 'שכר או מסרים מתוזמנים) לא הושלם. הדיל והסיור תקינים — נדרש רק להשלים את הסנכרון.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.orderNo || item.dealId}` : null),
});

/**
 * Exactly-once key: ONE card per conversion operation.
 *
 * Keyed on the opId (not the deal) so a LATER conversion that fails again gets
 * its own card, while every retry of the same one converges onto the first.
 */
export const conversionRecoveryKey = (opId) => `${CONVERSION_RECOVERY_KIND}:${opId}`;
