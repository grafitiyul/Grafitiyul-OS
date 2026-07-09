// Derived tour occupancy — THE single place it is computed. Occupancy is never
// stored on TourEvent (a stored running total is how numbers drift apart);
// every screen that shows seats goes through this helper. Capacity is a soft
// ceiling used for warnings only — comparison/warning logic belongs to the
// callers, this module only reports the truth.

// Sum of active seats + booking counts for a set of TourEvents.
// Returns { [tourEventId]: { activeSeats, activeBookings, totalBookings } }.
export async function occupancyFor(client, tourEventIds) {
  const ids = [...new Set(tourEventIds)].filter(Boolean);
  if (!ids.length) return {};
  const [active, total] = await Promise.all([
    client.booking.groupBy({
      by: ['tourEventId'],
      where: { tourEventId: { in: ids }, status: 'active' },
      _sum: { seats: true },
      _count: { _all: true },
    }),
    client.booking.groupBy({
      by: ['tourEventId'],
      where: { tourEventId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const out = Object.fromEntries(
    ids.map((id) => [id, { activeSeats: 0, activeBookings: 0, totalBookings: 0 }]),
  );
  for (const row of active) {
    out[row.tourEventId].activeSeats = row._sum.seats || 0;
    out[row.tourEventId].activeBookings = row._count._all;
  }
  for (const row of total) {
    out[row.tourEventId].totalBookings = row._count._all;
  }
  return out;
}
