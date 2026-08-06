// Raising (and clearing) the "confirm what the payment closed over" review card.
//
// Split out of the settlement so the rule lives in ONE place and both producers
// — the immediate payment settlement and the delayed recovery — agree on when a
// human still owes an answer.
//
// Deliberately POST-COMMIT and fire-and-forget. Two reasons:
//   * a unique-violation on the dedupe key inside the settlement transaction
//     would abort the whole transaction in Postgres, so a duplicated provider
//     callback could roll back a real payment's WON. The card is a follow-up;
//     the money must never depend on it.
//   * the durable truth is already written INSIDE the transaction —
//     Deal.activityTypeAssumedAt for an assumption, and the absence of a
//     booking for missing planning. The card is the inbox surface over that
//     state, not the state itself, so a failed raise degrades to "no inbox row"
//     and never to "nobody knows". The won_deal_without_tour detector
//     independently covers the no-tour half within one sweep.

import { createReviewItem, handleReviewItem } from '../reviewItems/service.js';
import {
  POST_PAYMENT_COMPLETION_KIND,
  postPaymentCompletionKey,
} from '../reviewItems/kinds/postPaymentCompletion.js';
import { ASSUMPTION_REASON_HE } from './resolveActivityType.js';

/**
 * Raise the card when a settlement left something for a person to confirm.
 * No-op when the chain completed with nothing assumed and nothing missing.
 *
 * @param settlement the settleDealWon result ({ dealId, assumed, missing, needsSlot, … })
 */
export async function raisePostPaymentCompletion(client, settlement, log = console) {
  const assumed = settlement?.assumed || [];
  const missing = settlement?.missing || [];
  const needsSlot = !!settlement?.needsSlot;
  if (!assumed.length && !missing.length && !needsSlot) return { raised: false };

  const parts = [];
  for (const a of assumed) parts.push(ASSUMPTION_REASON_HE[a.reason] || a.field);
  if (missing.length) parts.push(`חסר: ${missing.map((m) => m.labelHe).join(', ')}`);
  if (needsSlot) parts.push('נדרש שיבוץ לסיור קבוצתי');

  try {
    return await createReviewItem(
      {
        kind: POST_PAYMENT_COMPLETION_KIND,
        dedupeKey: postPaymentCompletionKey(settlement.dealId),
        title: settlement.orderNo
          ? `השלמת פרטים לאחר תשלום — #${settlement.orderNo}`
          : 'השלמת פרטים לאחר תשלום',
        summary: parts.join(' · '),
        dealId: settlement.dealId,
        data: {
          orderNo: settlement.orderNo ?? null,
          assumed,
          missing,
          needsSlot,
          tourCreated: !!settlement.tourCreated,
        },
        entityRefs: [{ type: 'deal', id: settlement.dealId, orderNo: settlement.orderNo ?? null }],
      },
      { db: client },
    ).then((r) => ({ raised: r.created }));
  } catch (err) {
    log?.error?.('[post-payment review] raise failed', err);
    return { raised: false };
  }
}

/**
 * Clear the card once the operator has answered — called by the confirmation
 * endpoint. Guarded on status inside handleReviewItem, so a second click is a
 * no-op rather than a rewritten timestamp.
 */
export async function clearPostPaymentCompletion(client, dealId, actor = {}) {
  const item = await client.reviewItem.findUnique({
    where: { dedupeKey: postPaymentCompletionKey(dealId) },
    select: { id: true, status: true },
  });
  if (!item || item.status !== 'open') return { cleared: false };
  const { changed } = await handleReviewItem(
    item.id,
    { userId: actor.userId || null, userName: actor.userName || null },
    { db: client },
  );
  return { cleared: changed };
}
