// Review card: money arrived and closed a deal while some operational planning
// was still unresolved — either the system had to ASSUME a value to keep the
// sale moving, or a field is genuinely still missing.
//
// The rule this card enforces: taking payment is never blocked, but an
// assumption the system made on the operator's behalf is never left unreviewed.
// A payment can close a deal with nobody looking at it (an iCount IPN, a
// Cardcom callback, a worker), so there is no browser to prompt — the pending
// question has to survive as state until a person answers it.
//
// Deliberately NOT a בקרה control card. Operations Control means "something is
// operationally BROKEN and must be repaired" (won_deal_without_tour: a WON deal
// with no tour at all). This card means "the operational chain completed on an
// assumption — confirm it". Raising a critical control issue for a tour that
// exists and is scheduled would cry wolf and, worse, teach the office to ignore
// the detector that catches the genuinely broken case.
//
// Resolved when the operator confirms or corrects the classification in the
// Deal's post-payment completion modal.

import { registerReviewKind } from '../registry.js';

export const POST_PAYMENT_COMPLETION_KIND = 'post_payment_completion';

registerReviewKind(POST_PAYMENT_COMPLETION_KIND, {
  labelHe: 'השלמת פרטים לאחר תשלום',
  tone: 'alert',
  descriptionHe:
    'נוצר כשתשלום סגר עסקה (WON) בזמן שפרטי תכנון עדיין לא הושלמו. '
    + 'המערכת השלימה את החסר כדי לא לעכב את המכירה — יש לאשר או לתקן את מה שהונח.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.orderNo || item.dealId}` : null),
});

/** Exactly-once key: ONE card per settled deal, whatever retries the provider sends. */
export const postPaymentCompletionKey = (dealId) => `${POST_PAYMENT_COMPLETION_KIND}:${dealId}`;
