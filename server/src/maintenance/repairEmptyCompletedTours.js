// Repair — group tours the midnight sweep marked "הסתיים" with nobody on them.
//
// Until completion.js learned the empty-tour rule, the sweep completed EVERY
// overdue scheduled tour. A generated open-tour slot that nobody ever booked
// therefore ended its life reading "הסתיים" — telling the office a tour ran,
// and feeding every count that reads completed tours. Its truthful end state is
// "מבוטל".
//
// The signature is exact and cannot touch a tour that ever had a customer:
//
//   kind = 'group_slot'
//   AND status = 'completed'  AND  completedReason = 'midnight'
//   AND ZERO TicketRegistrations of ANY status
//   AND ZERO Bookings of ANY status
//
// "Of ANY status" is the strong part: not "no live seats today" but "no seat
// row was ever written". Nobody registered, nobody cancelled, nothing was
// released — there was never anyone there. And `completedReason = 'midnight'`
// proves the completion was the clock, never an operator pressing
// "סמן סיור כהסתיים" or a guide submitting a summary; neither of those is
// overruled here, exactly as the live rule refuses to overrule them.
//
// Idempotent: re-running finds nothing. Dry-run by default.

const SIGNATURE = {
  kind: 'group_slot',
  status: 'completed',
  completedReason: 'midnight',
  ticketRegistrations: { none: {} },
  bookings: { none: {} },
};

/**
 * Find every group tour that completed empty. Read-only.
 */
export async function findEmptyCompletedTours(client) {
  return client.tourEvent.findMany({
    where: SIGNATURE,
    select: {
      id: true,
      date: true,
      startTime: true,
      completedAt: true,
      openTourTemplateId: true,
      _count: { select: { assignments: true } },
    },
    orderBy: { date: 'desc' },
  });
}

/**
 * Flip them to cancelled.
 *
 * `cancelledAt` inherits the tour's own completedAt — the moment its life
 * actually ended — rather than "whenever the repair happened to run", so the
 * history stays truthful. completedAt/completedReason are cleared: the tour
 * never completed, and leaving the stamp behind would keep it in every
 * completed-tour read.
 *
 * The caller is responsible for the downstream effects (payroll, calendar, Woo)
 * — the runner script drives them through the SAME canonical services the live
 * cancellation uses.
 */
export async function repairEmptyCompletedTours(client, { apply = false } = {}) {
  const found = await findEmptyCompletedTours(client);
  if (!apply || !found.length) return { found, repaired: 0, apply };

  let repaired = 0;
  for (const t of found) {
    const res = await client.tourEvent.updateMany({
      where: { id: t.id, ...SIGNATURE },
      data: {
        status: 'cancelled',
        cancelledAt: t.completedAt || new Date(),
        completedAt: null,
        completedReason: null,
      },
    });
    repaired += res.count;
  }
  return { found, repaired, apply };
}
