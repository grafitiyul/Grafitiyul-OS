// Subject adapter: Booking (a deal's participation in a tour). The customer
// Coordination questionnaire binds here (blueprint §14.1) — one independent
// form per Booking, group tours included.
//
// Prefill reads known customer identity from the DEAL side (never duplicated
// into the questionnaire definition). Timeline events land on the DEAL feed —
// that is where operators track the customer relationship — plus the tour
// feed so the operational screen sees coordination state too.

import { prisma } from '../../db.js';
import { emitTimelineEvent, systemOrigin } from '../../timeline/events.js';
import { getPurpose } from '../registry.js';

const formLabel = (purpose) => getPurpose(purpose)?.labelHe || purpose;

const BOOKING_SELECT = {
  id: true, status: true, seats: true,
  deal: {
    select: {
      id: true, orderNo: true, title: true, tourLanguage: true,
      contacts: {
        select: {
          roles: true, isPrimary: true,
          contact: {
            select: {
              firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
              communicationLanguage: true,
              phones: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { value: true } },
              emails: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { value: true } },
            },
          },
        },
      },
    },
  },
  tourEvent: {
    select: {
      id: true, date: true, startTime: true, tourLanguage: true,
      product: { select: { nameHe: true, nameEn: true } },
      location: { select: { nameHe: true, nameEn: true } },
    },
  },
};

// The person we coordinate with: coordinator role first, then primary, then
// the first linked contact (same role-priority idea as the quote language
// resolver; coordinator outranks payer here because this IS the coordination).
function pickCoordinationContact(deal) {
  const links = deal?.contacts || [];
  const byRole = links.find((l) => (l.roles || []).includes('coordinator'));
  const primary = links.find((l) => l.isPrimary);
  return (byRole || primary || links[0])?.contact || null;
}

function contactName(c, lang) {
  if (!c) return '';
  const he = [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim();
  const en = [c.firstNameEn, c.lastNameEn].filter(Boolean).join(' ').trim();
  return (lang === 'en' ? en || he : he || en) || '';
}

export const bookingAdapter = {
  async exists(subjectId) {
    const b = await prisma.booking.findUnique({ where: { id: subjectId }, select: { id: true } });
    return !!b;
  },

  async displayContext(subjectId, lang) {
    const b = await prisma.booking.findUnique({ where: { id: subjectId }, select: BOOKING_SELECT });
    if (!b) return null;
    const t = b.tourEvent;
    const productName = (lang === 'en' && t?.product?.nameEn) || t?.product?.nameHe || null;
    return {
      subjectType: 'booking',
      title: b.deal?.title || productName || 'הזמנה',
      subtitle: [productName, t?.date, t?.startTime].filter(Boolean).join(' · ') || null,
      dealId: b.deal?.id || null,
      orderNo: b.deal?.orderNo || null,
      tourEventId: t?.id || null,
      date: t?.date || null,
      startTime: t?.startTime || null,
      seats: b.seats,
    };
  },

  // Known customer identity → conventional question keys. A template opts in
  // simply by using these keys (documented in the builder); unknown keys are
  // ignored by the runtime, so there is no coupling to a specific template.
  async prefill(subjectId, lang) {
    const b = await prisma.booking.findUnique({ where: { id: subjectId }, select: BOOKING_SELECT });
    if (!b) return {};
    const c = pickCoordinationContact(b.deal);
    const out = {};
    const name = contactName(c, lang);
    if (name) out.customer_name = name;
    const phone = c?.phones?.[0]?.value;
    if (phone) out.customer_phone = phone;
    const email = c?.emails?.[0]?.value;
    if (email) out.customer_email = email;
    if (b.tourEvent?.date) out.tour_date = b.tourEvent.date;
    if (typeof b.seats === 'number' && b.seats > 0) out.participants_count = b.seats;
    return out;
  },

  async resolveLanguage(subjectId) {
    const b = await prisma.booking.findUnique({ where: { id: subjectId }, select: BOOKING_SELECT });
    return (
      b?.tourEvent?.tourLanguage ||
      b?.deal?.tourLanguage ||
      pickCoordinationContact(b?.deal)?.communicationLanguage ||
      null
    );
  },

  authorize(_subjectId, auth) {
    return !!auth?.userId;
  },

  async onStarted(subjectId, submission, tx) {
    const b = await prisma.booking.findUnique({
      where: { id: subjectId },
      select: { dealId: true, tourEventId: true },
    });
    if (!b) return;
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: b.dealId,
      kind: 'questionnaire',
      body: `📋 טופס "${formLabel(submission.purpose)}" — המילוי החל`,
      data: { submissionId: submission.id, purpose: submission.purpose, bookingId: subjectId, event: 'started' },
      origin: systemOrigin(),
    });
  },

  async onSubmitted(subjectId, submission, tx) {
    const b = await prisma.booking.findUnique({
      where: { id: subjectId },
      select: { dealId: true, tourEventId: true },
    });
    if (!b) return;
    const body = `📋 טופס "${formLabel(submission.purpose)}" הוגש`;
    const data = { submissionId: submission.id, purpose: submission.purpose, bookingId: subjectId, event: 'submitted' };
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: b.dealId,
      kind: 'questionnaire',
      body,
      data,
      origin: systemOrigin(),
    });
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId: b.tourEventId,
      kind: 'questionnaire',
      body,
      data,
      origin: systemOrigin(),
    });
  },
};
