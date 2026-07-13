// Derived tour occupancy — THE single place it is computed. Occupancy is never
// stored on TourEvent (a stored running total is how numbers drift apart);
// every screen that shows seats goes through this helper. Capacity is a soft
// ceiling used for warnings only — comparison/warning logic belongs to the
// callers, this module only reports the truth.
//
// SEATS are the SUM of ACTIVE TicketRegistrations (the canonical, source-agnostic
// allocation SSOT — deal bookings, WooCommerce, future channels all count here).
// Booking counts stay from Booking as CRM metadata (how many deals are on the
// tour) — Booking is NO LONGER the seat source of truth.

import { CAPACITY_STATUSES } from './registrationStatus.js';

// Merge grouped aggregates into the fixed occupancy shape. Pure — unit-tested.
// Lives HERE (not in registrations.js) so occupancy has no dependency back on
// the registration/woo write path (keeps the module graph acyclic).
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

// Returns { [tourEventId]: { activeSeats, activeBookings, totalBookings } }.
export async function occupancyFor(client, tourEventIds) {
  const ids = [...new Set(tourEventIds)].filter(Boolean);
  if (!ids.length) return {};
  const [seatRows, activeBk, totalBk] = await Promise.all([
    client.ticketRegistration.groupBy({
      by: ['tourEventId'],
      // Held reservations consume capacity too (probable arrivals hold a seat).
      where: { tourEventId: { in: ids }, status: { in: CAPACITY_STATUSES } },
      _sum: { quantity: true },
    }),
    client.booking.groupBy({
      by: ['tourEventId'],
      where: { tourEventId: { in: ids }, status: 'active' },
      _count: { _all: true },
    }),
    client.booking.groupBy({
      by: ['tourEventId'],
      where: { tourEventId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  return mergeOccupancy(ids, seatRows, activeBk, totalBk);
}
