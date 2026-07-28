// Per-tour guide notifications — evaluated on the EXISTING admin-reports tick.
//
// Scheduling contract (deliberately the same shape as the daily reports, so
// there is one scheduler in this module and no second engine):
//   * every tick, look at a bounded window of tours,
//   * compute each notification's due instant from CANONICAL tour times,
//   * fire the ones whose instant has passed,
//   * dedupe on a key that names the tour, the guide and the notification.
// Nothing is stored ahead of time, so rescheduling a tour, reassigning a guide
// or changing a duration is picked up automatically on the next tick.
//
// A missed window never loses a message: due-ness is "the instant has passed
// and it has not been sent", not "the instant is now".

import { prisma } from '../db.js';
import { israelToday, addDays } from '../lib/israelDate.js';
import { israelLocalToMs } from '../communication/windows.js';
import { loadBlockingHolidays, sendDateForLeadDays } from '../lib/businessCalendar.js';
import { tourEndMs } from '../tours/tourTime.js';
import { notifiableGuides, guideFirstName, guideFullName, GUIDE_ASSIGNMENT_SELECT } from '../tours/guides.js';
import { guideTourUrl } from '../tours/guidePortal/links.js';
import { COORDINATION_LEAD_DAYS, DONE_STATUSES } from './coordination.js';
import { fireAdminReport } from './dispatch.js';
import { openTourParticipants, tourNotificationFacts } from './tourFacts.js';

/** The hour guide notifications go out on their chosen calendar date. */
export const GUIDE_SEND_HOUR = 8;

/** How stale a due notification may be before we stop chasing it. */
const MAX_LATE_MS = 3 * 24 * 60 * 60 * 1000;

/** Reminder offsets after the tour ends, in hours → report number. */
export const SUMMARY_REMINDERS = [
  { number: 14, afterHours: 0 },
  { number: 15, afterHours: 3 },
  { number: 16, afterHours: 6 },
];

const LIVE = ['scheduled', 'completed'];

const SWEEP_TOUR_SELECT = {
  id: true, date: true, startTime: true, status: true, kind: true,
  openTourTemplateId: true,
  product: { select: { nameHe: true } },
  location: { select: { nameHe: true } },
  productVariant: { select: { durationHours: true, location: { select: { nameHe: true } } } },
  assignments: { select: GUIDE_ASSIGNMENT_SELECT, orderBy: { createdAt: 'asc' } },
  bookings: {
    where: { status: 'active' },
    select: {
      id: true, dealId: true,
      deal: {
        select: {
          orderNo: true, participants: true,
          organization: { select: { name: true } },
          contacts: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1,
            select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } },
          },
        },
      },
    },
  },
};

const recipientOf = (a) => ({
  personRefId: a.personRef?.id || null,
  phone: a.personRef?.phone || null,
  name: guideFullName(a),
  firstName: guideFirstName(a),
});

// ── Notification #12/#13: the coordination call ──────────────────────────────

/**
 * The instant the "time for a coordination call" message is due for a tour:
 * COORDINATION_LEAD_DAYS calendar days before the tour, walked earlier off
 * Shabbat / חג / ערב חג, at GUIDE_SEND_HOUR Israel time.
 */
export function coordinationSendMs(tourDate, holidays) {
  const { date, movedDays, reasons } = sendDateForLeadDays(tourDate, COORDINATION_LEAD_DAYS, holidays);
  return { ms: israelLocalToMs(date, GUIDE_SEND_HOUR * 60), date, movedDays, reasons };
}

/**
 * Sweep the coordination-call notification. Window: tours from today forward
 * far enough that a moved-earlier send is never missed.
 */
export async function sweepCoordinationCalls({ nowMs = Date.now(), client = prisma, log = console } = {}) {
  const today = israelToday(nowMs);
  const tours = await client.tourEvent.findMany({
    where: { status: { in: LIVE }, date: { gte: today, lte: addDays(today, COORDINATION_LEAD_DAYS + 2) } },
    select: SWEEP_TOUR_SELECT,
  });
  if (!tours.length) return [];
  const holidays = await loadBlockingHolidays(addDays(today, -14), addDays(today, 21), client);

  const fired = [];
  for (const tour of tours) {
    const due = coordinationSendMs(tour.date, holidays);
    if (due.ms == null || due.ms > nowMs || nowMs - due.ms > MAX_LATE_MS) continue;
    const guides = notifiableGuides(tour.assignments);
    if (!guides.length) continue;

    const isOpen = tour.kind === 'group_slot';
    const facts = isOpen
      ? { openTour: true, ...tourNotificationFacts(tour), participants: await openTourParticipants(tour.id, client) }
      : { openTour: false, ...tourNotificationFacts(tour) };

    for (const a of guides) {
      const recipient = recipientOf(a);
      const r = await fireAdminReport({
        number: 12,
        idempotencyKey: `coord_call:${tour.id}:${a.externalPersonId}`,
        tourEventId: tour.id,
        dealId: isOpen ? null : tour.bookings[0]?.dealId || null,
        recipient,
        data: {
          guideNotice: {
            ...facts,
            portalUrl: guideTourUrl(a.personRef, tour.id),
            sendDate: due.date,
            movedDays: due.movedDays,
            moveReasons: due.reasons,
          },
        },
      }, log);
      if (r?.ok) fired.push({ number: 12, tourEventId: tour.id, guide: recipient.name });
    }
  }
  return fired;
}

// ── Notification #14/#15/#16: the tour summary ───────────────────────────────

/**
 * Sweep the summary notification and its two reminders. Each fires only while
 * the guide still owes a summary — a guide who filed theirs stops receiving the
 * later reminders, which is the whole point of the ladder.
 */
export async function sweepTourSummaries({ nowMs = Date.now(), client = prisma, log = console } = {}) {
  const today = israelToday(nowMs);
  const tours = await client.tourEvent.findMany({
    where: { status: { in: LIVE }, date: { gte: addDays(today, -3), lte: today } },
    select: SWEEP_TOUR_SELECT,
  });
  if (!tours.length) return [];

  const ids = tours.map((t) => t.id);
  const submissions = await client.questionnaireSubmission.findMany({
    where: {
      subjectType: 'tour_event', subjectId: { in: ids },
      purpose: 'tour_summary', status: { in: DONE_STATUSES },
    },
    select: { subjectId: true, actorScope: true },
  });
  const done = new Set(submissions.map((s) => `${s.subjectId}:${s.actorScope}`));

  const fired = [];
  for (const tour of tours) {
    const end = tourEndMs(tour);
    if (end == null || end > nowMs) continue;
    const facts = tourNotificationFacts(tour);
    for (const a of notifiableGuides(tour.assignments)) {
      // Already filed → nothing further in the ladder is owed.
      if (done.has(`${tour.id}:${a.externalPersonId}`)) continue;
      const recipient = recipientOf(a);
      for (const step of SUMMARY_REMINDERS) {
        const dueMs = end + step.afterHours * 3_600_000;
        if (dueMs > nowMs || nowMs - dueMs > MAX_LATE_MS) continue;
        const r = await fireAdminReport({
          number: step.number,
          idempotencyKey: `summary:${tour.id}:${a.externalPersonId}`,
          tourEventId: tour.id,
          dealId: tour.bookings[0]?.dealId || null,
          recipient,
          data: { guideNotice: { ...facts, portalUrl: guideTourUrl(a.personRef, tour.id) } },
        }, log);
        if (r?.ok) fired.push({ number: step.number, tourEventId: tour.id, guide: recipient.name });
      }
    }
  }
  return fired;
}

/** Called by the admin-reports worker on every tick. */
export async function runTourSweeps({ nowMs = Date.now(), client = prisma, log = console } = {}) {
  const out = [];
  for (const [name, fn] of [['coordination', sweepCoordinationCalls], ['summaries', sweepTourSummaries]]) {
    try {
      out.push(...(await fn({ nowMs, client, log })));
    } catch (err) {
      log.error?.(`[admin-reports] tour sweep ${name} failed: ${err?.message || err}`);
    }
  }
  return out;
}
