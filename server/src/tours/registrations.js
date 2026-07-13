// Canonical ticket registration service — the ONE place deal bookings are
// mirrored into the source-agnostic TicketRegistration SSOT, and the ONE place
// tour occupancy (seats) is derived. WooCommerce and future channels write their
// own rows here directly; the Booking is only CRM linkage, never the seat truth.
//
// Single-product deal model (today): one deal booking → exactly one 'deal'
// registration carrying the tour's operational variant. When a booking later
// splits into several ticket products, this becomes several rows per booking —
// occupancy and derivation already sum over rows, so nothing downstream changes.

// A booking's allocation state maps onto its registration: only 'active' seats
// count. 'orphaned' (deal left WON but tour kept) is intentionally NOT counted,
// so it collapses to a non-active registration like 'cancelled'.
export function regStatusFromBooking(bookingStatus) {
  return bookingStatus === 'active' ? 'active' : 'cancelled';
}

// Idempotently converge the single 'deal' registration for a booking onto the
// booking's current state (seats, status) and its tour's operational variant.
// Runs inside the caller's transaction, called after every booking mutation.
export async function syncDealRegistration(tx, booking, tour) {
  const status = regStatusFromBooking(booking.status);
  const quantity = Number(booking.seats) || 0;
  const productVariantId = tour?.productVariantId ?? null;
  const existing = await tx.ticketRegistration.findFirst({
    where: { bookingId: booking.id, source: 'deal' },
  });
  if (existing) {
    await tx.ticketRegistration.update({
      where: { id: existing.id },
      data: {
        quantity,
        productVariantId,
        status,
        cancelledAt: status === 'cancelled' ? existing.cancelledAt || new Date() : null,
      },
    });
    return existing.id;
  }
  const created = await tx.ticketRegistration.create({
    data: {
      tourEventId: tour.id,
      productVariantId,
      quantity,
      source: 'deal',
      bookingId: booking.id,
      dealId: booking.dealId,
      status,
      cancelledAt: status === 'cancelled' ? new Date() : null,
    },
  });
  return created.id;
}

// Merge grouped aggregates into the fixed occupancy shape. Pure — unit-tested.
//   seatRows:   [{ tourEventId, _sum: { quantity } }]  (active registrations)
//   activeBk:   [{ tourEventId, _count: { _all } }]     (active bookings, CRM)
//   totalBk:    [{ tourEventId, _count: { _all } }]     (all bookings, CRM)
export function mergeOccupancy(ids, seatRows, activeBk, totalBk) {
  const out = Object.fromEntries(
    ids.map((id) => [id, { activeSeats: 0, activeBookings: 0, totalBookings: 0 }]),
  );
  for (const r of seatRows) if (out[r.tourEventId]) out[r.tourEventId].activeSeats = r._sum.quantity || 0;
  for (const r of activeBk) if (out[r.tourEventId]) out[r.tourEventId].activeBookings = r._count._all;
  for (const r of totalBk) if (out[r.tourEventId]) out[r.tourEventId].totalBookings = r._count._all;
  return out;
}
