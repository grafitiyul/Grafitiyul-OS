// THE canonical resolver for "what kind of activity is this deal?" when the
// operator never said.
//
// The production case (deal #27105): a lead was priced, given a payment link and
// PAID — with six of the seven planning fields filled and `activityType` left
// null. The WON transition succeeded (the money is real), but the tour gate
// refused to create a TourEvent over that one missing field, so a paying
// customer was commercially closed and operationally invisible for 48 seconds
// until a person noticed.
//
// The business rule that replaces "block until someone picks": the sale is never
// blocked, and a missing activityType is RESOLVED rather than guessed at random.
//
//   1. explicit GROUP context (a group slot is actually selected/held) → group.
//      Never inferred from anything softer — a group registration owns a real
//      seat on a real slot, and inventing one would fabricate operational state.
//   2. an ORGANIZATION is linked → business. This is not a guess: it is the
//      project's canonical classification rule (shared/dealActivity.mjs
//      effectiveActivityType — an organization answers for a deal that has no
//      answer of its own). Applying it here just applies it LATE, to a row that
//      predates the rule or never passed through the API. Note it is a DEFAULT,
//      not an override: step 1 above already returned for any deal that carries
//      its own value, including a deliberate private-with-organization deal.
//   3. otherwise → private. The residual case, and the overwhelmingly common
//      one: a private customer bought a private experience.
//
// Everything this resolver derives is marked ASSUMED. The value is persisted
// (one source of truth — pricing, reports and Communication conditions all read
// Deal.activityType, and a null there is its own bug), but the assumption is
// stamped alongside it so the operator is asked to confirm exactly once. The
// system commits to a working answer AND admits it chose it — it never silently
// classifies a customer's business.

import { emitTimelineEvent } from '../timeline/events.js';
import { effectiveActivityType } from '../../../shared/dealActivity.mjs';

/** Payment/WON causes that PROVE money actually arrived (Deal.wonActor.cause). */
const PAID_CAUSES = new Set(['card_payment', 'icount_payment', 'cardcom_payment', 'woo_order']);

/**
 * Resolve the deal's effective activity type.
 *
 * `groupSlotSelected` is the ONLY group signal accepted, and the caller must
 * derive it from a real TourEvent of kind 'group_slot' (an explicitly passed
 * target, or the deal's own held/expired reservation). A deal that merely
 * *looks* like a group booking is never treated as one.
 *
 * @returns {{ activityType: 'group'|'private'|'business', assumed: boolean, reason: string|null }}
 *   `assumed: false` means the deal already carried the value — nothing was
 *   decided here and nothing should be written or reviewed.
 */
export function resolveActivityType(deal, { groupSlotSelected = false } = {}) {
  if (deal?.activityType) {
    return { activityType: deal.activityType, assumed: false, reason: null };
  }
  if (groupSlotSelected) {
    return { activityType: 'group', assumed: true, reason: 'group_slot_selected' };
  }
  // Steps 2 and 3 ARE the shared reader ladder (shared/dealActivity.mjs) — the
  // org answers for a deal that has no answer of its own. Delegated rather than
  // repeated so "does an organization mean business?" has exactly one answer in
  // the codebase; this function only adds the group signal it can see and the
  // residual `private` it is obliged to commit to.
  const effective = effectiveActivityType(deal);
  if (effective === 'business') {
    return { activityType: 'business', assumed: true, reason: 'organization_linked' };
  }
  return { activityType: 'private', assumed: true, reason: 'default_private' };
}

/**
 * Persist a resolution and its audit trail — THE single writer, so no entry
 * point can invent its own version of "the system chose this".
 *
 * Every path that can meet a deal with no activityType calls this: payment
 * settlement, and the post-payment recovery (complete-tour-setup). They used to
 * be able to disagree — recovery simply refused with a 422 while settlement
 * resolved and carried on, which meant the answer to "what is this deal?"
 * depended on which button happened to run first. One rule, one record.
 *
 * No-op when nothing was assumed, so callers can invoke it unconditionally.
 * Runs inside the caller's transaction.
 *
 * @returns the deal fields to merge locally (or null when nothing changed)
 */
export async function persistAssumedActivityType(tx, { dealId, resolved, origin = null }) {
  if (!resolved?.assumed) return null;
  const assumedAt = new Date();
  await tx.deal.update({
    where: { id: dealId },
    data: { activityType: resolved.activityType, activityTypeAssumedAt: assumedAt },
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'tour',
    body: `🏷️ סוג הפעילות הושלם אוטומטית כדי לא לעכב את הסגירה — ${ASSUMPTION_REASON_HE[resolved.reason]}. נדרש אישור.`,
    data: {
      event: 'activity_type_assumed',
      activityType: resolved.activityType,
      reason: resolved.reason,
    },
    origin,
  });
  return { activityType: resolved.activityType, activityTypeAssumedAt: assumedAt };
}

/** Hebrew wording for the assumption, rendered verbatim in the review card. */
export const ASSUMPTION_REASON_HE = {
  group_slot_selected: 'שויך לסיור קבוצתי קיים',
  organization_linked: 'משויך לארגון — סווג כפעילות עסקית',
  default_private: 'לא נבחר סוג פעילות — סווג כפעילות פרטית',
};

/**
 * The money state a SETTLED deal proves, derived from the frozen closer record
 * (Deal.wonActor, stamped by the canonical transition and never rewritten).
 *
 * This exists so the delayed recovery path can stamp a registration with the
 * same truth the immediate settlement would have stamped, WITHOUT inventing
 * evidence: a deal closed by an operator's manual WON proves no payment, so it
 * returns null and nothing is stamped.
 *
 * @returns {{ paymentStatus: 'paid'|'waived' }|null}
 */
export function settledPaymentStateFor(deal) {
  const cause = deal?.wonActor?.cause || null;
  if (!cause) return null;
  if (PAID_CAUSES.has(cause)) return { paymentStatus: 'paid' };
  if (cause === 'no_payment') return { paymentStatus: 'waived' };
  return null; // manual / historical_correction — no verified payment
}
