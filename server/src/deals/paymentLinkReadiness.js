// Is this deal ready for a payment link to leave GOS UNATTENDED?
//
// The distinction this module exists to encode: the three payment-link actions
// are not one action with one rule.
//
//   "פתח קישור לתשלום"      the operator is RIGHT THERE, usually with the
//                            customer on the phone. Blocking it would block a
//                            sale that is happening now, over paperwork that
//                            can be finished in the next minute. Never gated —
//                            this function is not consulted for it at all.
//   "העתק קישור לתשלום"      the link is about to be pasted somewhere and sent.
//   "שלח קישור בוואטסאפ"     the link is about to be sent.
//
// The last two put a link in a customer's hands with nobody watching what
// happens next, so the deal behind it should be complete BEFORE it goes. Not as
// a punishment — as the last cheap moment to fix it, which is why the caller
// opens a completion dialog and then resumes the original action rather than
// just refusing.
//
// activityType is deliberately NOT a blocker: settlement resolves it on its own
// (deals/resolveActivityType.js) and asks for confirmation afterwards, so
// stopping an operator over it here would re-introduce exactly the block that
// the resolver removed.

import { wonGate } from '../tours/tourFromDeal.js';
import { resolveActivityType } from './resolveActivityType.js';

/**
 * @param deal    a loaded deal row (DEAL_INCLUDE shape — needs `bookings`)
 * @returns {{ ready: boolean, missing: [{field,labelHe}], needsSlot: boolean }}
 *   `missing` is rendered verbatim as a checklist, the requiredFields.js
 *   convention — no surface writes its own field list.
 */
export function paymentLinkReadiness(deal) {
  if (!deal) return { ready: true, missing: [], needsSlot: false };
  const booking = (deal.bookings || []).find((bk) => bk.status === 'active') || null;
  const slotId = booking?.tourEvent?.kind === 'group_slot' ? booking.tourEventId : null;
  // Judge the deal as SETTLEMENT will see it, not as it is stored: the same
  // resolution runs there, so a link is never blocked over a field that will
  // resolve itself the moment the money lands.
  const { activityType } = resolveActivityType(deal, { groupSlotSelected: !!slotId });
  const gate = wonGate({ ...deal, activityType }, booking?.tourEventId || null);
  const missing = gate.missing.filter((m) => m.field !== 'activityType');
  return { ready: missing.length === 0 && !gate.needsSlot, missing, needsSlot: gate.needsSlot };
}
