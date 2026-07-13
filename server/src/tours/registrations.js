// Canonical ticket registration service — the ONE place deal bookings are
// mirrored into the source-agnostic TicketRegistration SSOT, and the ONE place
// tour occupancy (seats) is derived. WooCommerce and future channels write their
// own rows here directly; the Booking is only CRM linkage, never the seat truth.
//
// Single-product deal model (today): one deal booking → exactly one 'deal'
// registration carrying the tour's operational variant. When a booking later
// splits into several ticket products, this becomes several rows per booking —
// occupancy and derivation already sum over rows, so nothing downstream changes.

import { recomputeTourOperationalProduct } from './operationalProduct.js';

// A booking's allocation state maps onto its registration: only 'active' seats
// count. 'orphaned' (deal left WON but tour kept) is intentionally NOT counted,
// so it collapses to a non-active registration like 'cancelled'.
export function regStatusFromBooking(bookingStatus) {
  return bookingStatus === 'active' ? 'active' : 'cancelled';
}

// Idempotently converge the single 'deal' registration for a booking onto the
// booking's current state (seats, status) and its SELLABLE product variant.
// Runs inside the caller's transaction, called after every booking mutation.
// For open tours (group slots) it then re-derives the operational product from
// the tour's active registrations — the ONE hook every registration source
// (deal now, WooCommerce/future later) funnels through.
//
// The product variant is the DEAL's chosen sellable variant (the ticket the
// customer bought — e.g. workshop vs plain), NOT the slot's base variant, so the
// operational-product derivation sees the real capability. Callers with the deal
// pass it via opts.productVariantId; callers without one (cancel/orphan) omit it
// and the existing registration's variant is preserved.
//
// Stable identity for auditability + idempotent upsert: source='deal',
// externalOrderId=dealId (the source order), externalLineId=bookingId (the stable
// per-tour line). Lookup stays keyed on bookingId so pre-existing (backfilled)
// rows are matched and never duplicated.
export async function syncDealRegistration(tx, booking, tour, opts = {}) {
  const status = regStatusFromBooking(booking.status);
  const quantity = Number(booking.seats) || 0;
  const existing = await tx.ticketRegistration.findFirst({
    where: { bookingId: booking.id, source: 'deal' },
  });
  // Explicit selection wins; else keep the existing row's variant; else fall
  // back to the tour's (last resort, e.g. a legacy row with no deal context).
  const productVariantId =
    opts.productVariantId !== undefined
      ? opts.productVariantId
      : existing
        ? existing.productVariantId
        : (tour?.productVariantId ?? null);
  let regId;
  if (existing) {
    await tx.ticketRegistration.update({
      where: { id: existing.id },
      data: {
        quantity,
        productVariantId,
        status,
        externalOrderId: booking.dealId,
        externalLineId: booking.id,
        cancelledAt: status === 'cancelled' ? existing.cancelledAt || new Date() : null,
      },
    });
    regId = existing.id;
  } else {
    const created = await tx.ticketRegistration.create({
      data: {
        tourEventId: tour.id,
        productVariantId,
        quantity,
        source: 'deal',
        bookingId: booking.id,
        dealId: booking.dealId,
        externalOrderId: booking.dealId,
        externalLineId: booking.id,
        status,
        cancelledAt: status === 'cancelled' ? new Date() : null,
      },
    });
    regId = created.id;
  }
  // Only open tours derive their product from registrations; deal tours keep
  // their deal-driven product. Cheap kind gate avoids an extra query otherwise.
  if (tour?.kind === 'group_slot') {
    await recomputeTourOperationalProduct(tx, tour.id);
  }
  return regId;
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
