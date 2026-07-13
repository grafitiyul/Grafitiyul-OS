import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { dealBookerLabel } from '../../tours/customerDisplay.js';

// Held reservation expired without payment — a conditional TicketRegistration
// lapsed (heldExpiryWorker set it EXPIRED, releasing the seat). Surfaced as an
// actionable warning until the deal is closed WON (late payment re-confirms) or
// the customer/reservation is otherwise resolved. Re-derived from live state.

const TYPE = 'held_reservation_expired';
const dedupeKey = (regId) => `${TYPE}:${regId}`;

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function buildPayload(reg) {
  const customer = dealBookerLabel(reg.deal) || (reg.customerName || '').trim() || 'לקוח';
  const when = [fmtDate(reg.tourEvent?.date), reg.tourEvent?.startTime].filter(Boolean).join(' ');
  return {
    type: TYPE,
    severity: 'warning',
    sourceModule: 'tours',
    dedupeKey: dedupeKey(reg.id),
    title: `שריון פג ללא תשלום — ${customer}`,
    explanation:
      `השריון של ${customer} (${reg.quantity} משתתפים) לסיור ${when || ''} פג ללא הסדרת תשלום, והמקום שוחרר. ` +
      'ניתן ליצור קשר עם הלקוח ולהסדיר תשלום (ישובץ מחדש), או לסגור את הפנייה.',
    entityRefs: [
      reg.deal ? { type: 'deal', id: reg.deal.id, orderNo: reg.deal.orderNo, label: customer } : null,
      { type: 'tour_event', id: reg.tourEventId, label: when || 'סיור' },
    ].filter(Boolean),
    data: {
      registrationId: reg.id,
      dealId: reg.deal?.id || null,
      dealOrderNo: reg.deal?.orderNo || null,
      tourEventId: reg.tourEventId,
      customer,
      quantity: reg.quantity,
      // The UI computes "how long overdue" live from these canonical timestamps.
      expiresAt: reg.expiresAt,
      expiredAt: reg.expiredAt,
    },
  };
}

registerDetector({
  key: 'held-reservation-expired',
  async run(client) {
    const regs = await client.ticketRegistration.findMany({
      where: { status: 'expired' },
      orderBy: { expiredAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        tourEventId: true,
        quantity: true,
        customerName: true,
        expiresAt: true,
        expiredAt: true,
        deal: {
          select: {
            id: true,
            orderNo: true,
            title: true,
            status: true,
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
    for (const reg of regs) {
      // Resolved once the deal is WON (late payment re-confirmed elsewhere).
      if (reg.deal && reg.deal.status === 'won') continue;
      present.add(dedupeKey(reg.id));
      await raiseIssue(client, buildPayload(reg));
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
  async recheck(client, issue) {
    const reg = await client.ticketRegistration.findUnique({
      where: { id: issue.data?.registrationId },
      select: { status: true, deal: { select: { status: true } } },
    });
    if (!reg) return false;
    return reg.status === 'expired' && reg.deal?.status !== 'won';
  },
});
