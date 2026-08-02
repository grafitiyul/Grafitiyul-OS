// Review card: participant count changed (שינוי בכמות משתתפים).
//
// Created when a guide reports on a coordination call that the group is not the
// size we have registered. It is a DECISION REQUEST, not a change: nothing in
// the system is updated by this card's existence.
//
// ── Why nothing updates automatically ────────────────────────────────────────
// A participant count is not one number. It is the seat allocation, the Builder
// quantity, the price, the collection balance, the tour capacity, the staffing
// ratio and the equipment plan — each with its own rules and its own approvals.
// A guide reporting "they say 18, not 13" on a phone call is evidence, not an
// instruction; propagating it silently would rewrite a customer's price from a
// corridor conversation. So the card carries the evidence and a manager decides.
//
// The card is INDEPENDENT of the coordination submission it came from: handling
// it does not reopen the form, and re-reading the form does not reopen the card.

import { registerReviewKind } from '../registry.js';

export const PARTICIPANT_CHANGE_KIND = 'participant_change';

registerReviewKind(PARTICIPANT_CHANGE_KIND, {
  labelHe: 'שינוי בכמות משתתפים',
  // Someone has to go and do something: re-price, re-staff, or confirm.
  tone: 'alert',
  descriptionHe:
    'נוצר כשמדריך מדווח בשיחת תיאום שכמות המשתתפים בפועל שונה מהרשום. '
    + 'הכרטיס אינו מעדכן דבר — הוא מבקש החלטה.',
  buildLink: (item) => (item.dealId ? `/admin/crm/deals/${item.data?.dealOrderNo ?? ''}` : null),
});

/** The one-line summary on the collapsed card. */
export function participantChangeHeadline({ registered, corrected, delta }) {
  const d = delta == null ? '' : ` (${delta > 0 ? '+' : ''}${delta})`;
  return `${registered ?? '—'} → ${corrected ?? '—'}${d}`;
}
