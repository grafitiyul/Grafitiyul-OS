// What still depends on this Deal strongly enough that deleting it would
// destroy something real? THE single answer, shared by the delete endpoint and
// its tests.
//
// The rule this replaces: "any Booking row exists → 409". That counted HISTORY
// as a dependency. A deal that was WON, reopened, and had its tour correctly
// cancelled still carries a cancelled Booking forever, so it could never be
// deleted — which is exactly the state a mistaken or fraudulent order ends up
// in after an operator does everything right (production #27104). Cancelled
// bookings hold no seat, no tour and no money; they are a record of something
// that already stopped.
//
// What replaces it is a test of LIVE dependency, in three families:
//
//   OPERATIONAL — a booking that still ties the deal to a tour ('active', or
//     'orphaned' which exists precisely so the tour can be reconnected later),
//     or a registration still consuming capacity.
//   ACCOUNTING  — an issued document, recorded money, or a settled payment
//     request. These CASCADE at the database level, so without this check the
//     delete endpoint would silently destroy tax documents. That hole predates
//     the booking rule and is closed here.
//
// Deliberately NOT blockers: cancelled bookings, cancelled/refunded/expired
// registrations, payment LINKS that were never paid, quotes, tasks, files,
// contacts, plans. Those are either history or cascade-safe deal-scoped rows.

import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';

// A booking only stops mattering once it is CANCELLED. 'orphaned' is a live
// state by design — the tour survived the deal stepping away and can be
// reconnected (tours/tourFromDeal.js reconnectOrphanBooking), which needs the
// deal to still exist.
const DEAD_BOOKING = 'cancelled';

// PaymentRequest statuses where money has (or may have) moved. 'pending' and
// 'awaiting_payment' are just an unopened page; 'failed'/'canceled' are dead.
const SETTLED_PAYMENT_STATUSES = ['paid', 'payment_returned'];

/**
 * @returns [{ code, labelHe, count }] — empty means the deal may be deleted.
 *   Rendered verbatim by the client, so the operator is told WHICH dependency
 *   blocks them instead of a generic refusal.
 */
export async function dealDeletionBlockers(client, dealId) {
  const [liveBookings, liveSeats, documents, evidence, payments] = await Promise.all([
    client.booking.count({ where: { dealId, status: { not: DEAD_BOOKING } } }),
    client.ticketRegistration.count({ where: { dealId, status: { in: CAPACITY_STATUSES } } }),
    client.icountDocument.count({ where: { dealId } }),
    client.dealCollectionEvidence.count({ where: { dealId, status: 'active' } }),
    client.paymentRequest.count({ where: { dealId, status: { in: SETTLED_PAYMENT_STATUSES } } }),
  ]);

  const blockers = [];
  const add = (code, labelHe, count) => count > 0 && blockers.push({ code, labelHe, count });
  add('active_booking', 'הדיל משובץ לסיור פעיל', liveBookings);
  add('live_registration', 'הדיל מחזיק מקומות בסיור', liveSeats);
  add('accounting_document', 'הופקו מסמכים חשבונאיים לדיל', documents);
  add('collection_evidence', 'רשומים תשלומים בגבייה', evidence);
  add('settled_payment', 'קיימת בקשת תשלום שהושלמה', payments);
  return blockers;
}

/**
 * Rows that must be cleared, in the same transaction, for the delete to
 * proceed — the "clean through the canonical path" half of the invariant.
 *
 * Only ONE table needs it: Booking. Its dealId is non-nullable with an
 * ON DELETE RESTRICT constraint, so a cancelled booking cannot be left behind
 * as an orphan the way a registration can. Everything else either cascades
 * (deal-scoped rows) or nulls out (TicketRegistration, ReservationGroup,
 * EmailThread — history that outlives the deal by design).
 *
 * Audit integrity is preserved WITHOUT the booking row, because the record of
 * what happened does not live in it: the TourEvent's own timeline keeps the
 * `deal_joined` / `deal_left` / `auto_cancelled_empty` entries (loose-keyed, no
 * FK, carrying dealId + orderNo), and the cancelled TicketRegistration survives
 * on the tour with its seat count and cancellation time.
 *
 * Open ReviewItems are retired rather than deleted: the card is a worklist
 * entry whose link would point at a deal that no longer exists, but the row
 * itself is history worth keeping. `dealId` there is a loose ref with no FK, so
 * nothing cleans it up for us.
 */
export async function clearDeletableDealRefs(tx, dealId, { actorUserId = null, actorName = null } = {}) {
  const bookings = await tx.booking.deleteMany({ where: { dealId, status: DEAD_BOOKING } });
  const cards = await tx.reviewItem.updateMany({
    where: { dealId, status: 'open' },
    data: { status: 'handled', handledAt: new Date(), handledBy: actorUserId, handledByName: actorName },
  });
  return { cancelledBookingsRemoved: bookings.count, reviewCardsRetired: cards.count };
}
