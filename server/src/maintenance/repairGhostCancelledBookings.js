// Repair — Bookings cancelled by a reconciler while they still owned live seats.
//
// The Airtable child-deps reconciler cancels a GOS Booking whose row has
// vanished from the Airtable parent. Bookings created by the legacy migration
// import have NO Airtable counterpart and were therefore classified as
// removals: 8 rows across 6 tours were cancelled on 2026-07-31 while their
// TicketRegistrations stayed confirmed. The seat SSOT still held the seats, but
// the Deal cards render off Booking status, so the participants vanished from
// the tour screen.
//
// The signature is exact and cannot collide with a genuine cancellation:
//
//   status = 'cancelled'  AND  cancelledAt IS NULL  AND  live capacity registrations
//
// A real cancellation always stamps `cancelledAt` (enforced from now on) and
// releases its registrations. A row matching all three was never cancelled by
// anyone — it was mutated by a reconciler that had no business doing so.
//
// Idempotent: re-running finds nothing once repaired. Dry-run by default.

import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';

/**
 * Find every booking carrying the ghost-cancellation signature.
 * Read-only. Exported so the detector and the repair share ONE definition of
 * the impossible state.
 */
export async function findGhostCancelledBookings(client) {
  const rows = await client.booking.findMany({
    where: {
      status: 'cancelled',
      cancelledAt: null,
      ticketRegistrations: { some: { status: { in: CAPACITY_STATUSES } } },
    },
    select: {
      id: true,
      tourEventId: true,
      dealId: true,
      seats: true,
      createdAt: true,
      updatedAt: true,
      deal: { select: { orderNo: true, status: true } },
      tourEvent: { select: { date: true, startTime: true, status: true } },
      ticketRegistrations: { select: { id: true, status: true, quantity: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });
  return rows.map((b) => {
    const live = b.ticketRegistrations.filter((r) => CAPACITY_STATUSES.includes(r.status));
    return { ...b, liveRegistrations: live.length, liveSeats: live.reduce((s, r) => s + (r.quantity || 0), 0) };
  });
}

/**
 * Restore them to 'active'.
 *
 * `active` is the correct target, not a guess: the booking was created active,
 * nothing ever cancelled it through the real path, its deal is still WON and
 * its registrations still hold seats. Restoring status is putting the CRM
 * linkage back in agreement with the seat SSOT that never changed.
 */
export async function repairGhostCancelledBookings(client, { apply = false } = {}) {
  const found = await findGhostCancelledBookings(client);
  if (!apply || !found.length) return { found, repaired: 0, apply };

  const result = await client.booking.updateMany({
    where: { id: { in: found.map((b) => b.id) }, status: 'cancelled', cancelledAt: null },
    data: { status: 'active' },
  });
  return { found, repaired: result.count, apply };
}
