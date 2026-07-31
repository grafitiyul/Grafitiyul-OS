import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { dealBookerLabel } from '../../tours/customerDisplay.js';
import { CAPACITY_STATUSES } from '../../tours/registrationStatus.js';

// A Booking cancelled while it still owns capacity-holding TicketRegistrations.
//
// This is an INCOHERENT state, not a business situation: the seat SSOT says the
// customer is coming, the CRM linkage says they left. The tour screen renders
// customer cards off Booking status, so the participants silently disappear
// from the tour while still occupying capacity.
//
// It happened for real on 2026-07-31 — the Airtable child-deps reconciler
// cancelled 8 bookings that had no Airtable counterpart (they came from the
// legacy migration import), three of them on the next day's tour. Two guards
// now make that specific path impossible (protectRemoval routes such a removal
// to a conflict, and a DB CHECK constraint forbids a cancellation with no
// timestamp). This detector is the backstop: it does not care WHO produced the
// state, only that it exists, so a future writer inventing a new way in is
// surfaced within one sweep instead of being noticed by a guide standing in
// front of a group that GOS believes is not coming.

const TYPE = 'booking_cancelled_with_live_seats';
const dedupeKey = (bookingId) => `${TYPE}:${bookingId}`;

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function buildPayload(booking, liveSeats) {
  const customer = dealBookerLabel(booking.deal) || 'לקוח';
  const when = [fmtDate(booking.tourEvent?.date), booking.tourEvent?.startTime].filter(Boolean).join(' ');
  // A cancellation with no timestamp was never performed by a person or by the
  // canonical cancel path — that distinction tells an operator whether to look
  // for a rogue writer or for a genuine mistake.
  const ghost = !booking.cancelledAt;
  return {
    type: TYPE,
    severity: 'critical',
    sourceModule: 'tours',
    dedupeKey: dedupeKey(booking.id),
    title: `הזמנה בוטלה אך המשתתפים עדיין רשומים — ${customer}`,
    explanation:
      `ההזמנה של ${customer} לסיור ${when || ''} מסומנת כמבוטלת, אך עדיין רשומים אליה ${liveSeats} משתתפים ` +
      'התופסים מקום בסיור. כתוצאה מכך המשתתפים לא מוצגים במסך הסיור למרות שהם צפויים להגיע. ' +
      (ghost
        ? 'לביטול לא נרשם תאריך — כלומר הוא לא בוצע על ידי אדם ולא דרך מסלול הביטול התקני, אלא נכתב על ידי תהליך סנכרון.'
        : 'יש לוודא מול הלקוח האם ההזמנה בוטלה בפועל, ולעדכן בהתאם.'),
    entityRefs: [
      booking.deal
        ? { type: 'deal', id: booking.deal.id, orderNo: booking.deal.orderNo, label: customer }
        : null,
      { type: 'tour_event', id: booking.tourEventId, label: when || 'סיור' },
    ].filter(Boolean),
    data: {
      bookingId: booking.id,
      dealId: booking.deal?.id || null,
      dealOrderNo: booking.deal?.orderNo || null,
      tourEventId: booking.tourEventId,
      customer,
      liveSeats,
      cancelledAt: booking.cancelledAt,
      ghostCancellation: ghost,
    },
  };
}

registerDetector({
  key: 'booking-cancelled-with-live-seats',
  async run(client) {
    const rows = await client.booking.findMany({
      where: {
        status: 'cancelled',
        ticketRegistrations: { some: { status: { in: CAPACITY_STATUSES } } },
      },
      take: 1000,
      select: {
        id: true,
        tourEventId: true,
        cancelledAt: true,
        ticketRegistrations: { select: { status: true, quantity: true } },
        deal: {
          select: {
            id: true,
            orderNo: true,
            title: true,
            organization: { select: { name: true } },
            contacts: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
              select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
            },
          },
        },
        tourEvent: { select: { date: true, startTime: true } },
      },
    });
    const present = new Set();
    for (const b of rows) {
      const liveSeats = b.ticketRegistrations
        .filter((r) => CAPACITY_STATUSES.includes(r.status))
        .reduce((s, r) => s + (r.quantity || 0), 0);
      if (liveSeats <= 0) continue;
      present.add(dedupeKey(b.id));
      await raiseIssue(client, buildPayload(b, liveSeats));
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'tours',
  buildActions(issue) {
    return [
      issue.data?.dealId
        ? {
            key: 'open_deal',
            label: 'פתח דיל',
            kind: 'link',
            style: 'primary',
            target: { type: 'deal', id: issue.data.dealId, orderNo: issue.data.dealOrderNo },
          }
        : null,
      {
        key: 'open_tour',
        label: 'פתח סיור',
        kind: 'link',
        target: { type: 'tour_event', id: issue.data?.tourEventId },
      },
    ].filter(Boolean);
  },
  // Self-resolving: the issue disappears once the booking is restored to active
  // or its registrations are genuinely released. No manual dismissal, so the
  // state cannot be acknowledged away while still being wrong.
  async recheck(client, issue) {
    const b = await client.booking.findUnique({
      where: { id: issue.data?.bookingId },
      select: { status: true, ticketRegistrations: { select: { status: true, quantity: true } } },
    });
    if (!b) return false;
    if (b.status !== 'cancelled') return false;
    return b.ticketRegistrations.some((r) => CAPACITY_STATUSES.includes(r.status) && (r.quantity || 0) > 0);
  },
});
