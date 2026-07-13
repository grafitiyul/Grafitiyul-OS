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

import { mergeOccupancy } from './registrations.js';

// Returns { [tourEventId]: { activeSeats, activeBookings, totalBookings } }.
export async function occupancyFor(client, tourEventIds) {
  const ids = [...new Set(tourEventIds)].filter(Boolean);
  if (!ids.length) return {};
  const [seatRows, activeBk, totalBk] = await Promise.all([
    client.ticketRegistration.groupBy({
      by: ['tourEventId'],
      where: { tourEventId: { in: ids }, status: 'active' },
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
