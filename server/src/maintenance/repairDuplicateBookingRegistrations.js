// Repair — one Booking holding SEVERAL live TicketRegistrations.
//
// A Booking is one seat line. Until now `syncDealRegistration` looked its row up
// with `{ bookingId, source: 'deal' }`, so a booking that already carried a
// legacy-import (`source: 'migration'`) registration was invisible to GOS:
//   • first edit in GOS created a SECOND live row → the seats were counted
//     twice and the customer appeared twice on every roster, and
//   • cancelling the booking converged only the 'deal' row → the migration twin
//     stayed live forever, keeping its seat and its participant card in the
//     Guide Portal long after the participant had cancelled.
//
// registrations.js now converges the whole booking, so the class cannot recur.
// This repairs the rows that already diverged.
//
// The signature is exact and deliberately narrow:
//
//   a booking with >1 live registration  AND  exactly one of them source='deal'
//
// The 'deal' row IS the canonical seat line (it is the one GOS reads and writes
// from the Deal), so every OTHER live row on that booking is a stale twin.
// Bookings whose live rows are ALL foreign-source are NOT touched: that is the
// legacy per-participant import shape, where the rows legitimately sum to the
// booking's seats and nothing has diverged.
//
// Rows are released (status 'cancelled' + cancelledAt), never deleted — the
// history stays readable. Idempotent: re-running finds nothing. Dry-run by
// default.

import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';

/**
 * Find every booking whose live registrations have diverged, with the stale
 * twin rows resolved. Read-only.
 */
export async function findDuplicateBookingRegistrations(client) {
  const bookings = await client.booking.findMany({
    where: { ticketRegistrations: { some: { status: { in: CAPACITY_STATUSES } } } },
    select: {
      id: true,
      status: true,
      seats: true,
      dealId: true,
      tourEventId: true,
      deal: { select: { orderNo: true, status: true } },
      tourEvent: { select: { date: true, startTime: true, status: true } },
      ticketRegistrations: {
        select: { id: true, status: true, source: true, quantity: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const out = [];
  for (const b of bookings) {
    const live = b.ticketRegistrations.filter((r) => CAPACITY_STATUSES.includes(r.status));
    if (live.length < 2) continue;
    const canonical = live.filter((r) => r.source === 'deal');
    // Exactly one canonical row, or we cannot prove which line is the real one.
    if (canonical.length !== 1) continue;
    const stale = live.filter((r) => r.id !== canonical[0].id);
    out.push({
      bookingId: b.id,
      bookingStatus: b.status,
      bookingSeats: b.seats,
      orderNo: b.deal?.orderNo ?? null,
      dealStatus: b.deal?.status ?? null,
      tourEventId: b.tourEventId,
      tourDate: b.tourEvent?.date ?? null,
      tourStartTime: b.tourEvent?.startTime ?? null,
      tourStatus: b.tourEvent?.status ?? null,
      keep: { id: canonical[0].id, source: canonical[0].source, quantity: canonical[0].quantity },
      release: stale.map((r) => ({ id: r.id, source: r.source, status: r.status, quantity: r.quantity })),
      phantomSeats: stale.reduce((n, r) => n + (r.quantity || 0), 0),
    });
  }
  out.sort((a, b) => String(a.tourDate).localeCompare(String(b.tourDate)));
  return out;
}

/**
 * Release the stale twins. The `status` guard in the where-clause makes the
 * write idempotent and prevents releasing a row someone confirmed in between.
 */
export async function repairDuplicateBookingRegistrations(client, { apply = false } = {}) {
  const found = await findDuplicateBookingRegistrations(client);
  if (!apply || !found.length) return { found, released: 0, apply };

  const ids = found.flatMap((b) => b.release.map((r) => r.id));
  const result = await client.ticketRegistration.updateMany({
    where: { id: { in: ids }, status: { in: CAPACITY_STATUSES } },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  return { found, released: result.count, apply };
}
