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
// SECURITY: guide-portal deep links are NEVER sent in operational messages —
// they are the whole-portal token with a path appended. Scoped form links only.
import { staffFormLinkUrl } from '../questionnaires/staffLinks.js';
// Same rule for photos: the direct upload link is a per-guide gallery-scoped
// capability (/g/<token>), never a portal path.
import { guideGalleryUploadUrl } from '../tours/gallery/links.js';
import { COORDINATION_LEAD_DAYS, DONE_STATUSES } from './coordination.js';
import { fireAdminReport } from './dispatch.js';
import { openTourParticipants, tourNotificationFacts } from './tourFacts.js';
import { staffLanguage } from '../../../shared/staffName.mjs';

/** The hour guide notifications go out on their chosen calendar date. */
export const GUIDE_SEND_HOUR = 8;

/** How stale a due notification may be before we stop chasing it. */
const MAX_LATE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Is this due moment inside the window the report may report on?
 * Two floors: it must have arrived, it must not be stale — and it must not
 * predate the moment the report was switched on. Without the last one, enabling
 * a notification would replay a backlog of tours that already happened.
 */
export function isDue(dueMs, nowMs, activatedAtMs) {
  if (dueMs == null || dueMs > nowMs) return false;
  if (nowMs - dueMs > MAX_LATE_MS) return false;
  if (activatedAtMs != null && dueMs < activatedAtMs) return false;
  return true;
}

/** Activation floors for the reports a sweep touches. */
async function activationFloors(numbers, client) {
  const rows = await client.adminReportConfig.findMany({
    where: { reportNumber: { in: numbers } },
    select: { reportNumber: true, activatedAt: true, enabled: true },
  });
  const map = new Map();
  for (const r of rows) map.set(r.reportNumber, r.enabled ? (r.activatedAt?.getTime() ?? null) : Infinity);
  // A report with no config row at all is unconfigured — dispatch will record
  // the honest skip, so nothing is suppressed here.
  return (n) => (map.has(n) ? map.get(n) : null);
}

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

/** The Tour Summary form link for ONE guide on ONE tour (perActor purpose). */
const summaryFormUrl = (tourEventId, externalPersonId, client, log) => staffFormLinkUrl({
  purpose: 'tour_summary',
  subjectType: 'tour_event',
  subjectId: tourEventId,
  actorScope: externalPersonId,
}, { db: client, log });

/** Customer label for a booking — the person the guide is calling. */
const bookingCustomerName = (b) => {
  const c = b?.deal?.contacts?.[0]?.contact;
  const name = c ? [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ').trim() : '';
  return name || b?.deal?.organization?.name || null;
};

const recipientOf = (a) => ({
  personRefId: a.personRef?.id || null,
  phone: a.personRef?.phone || null,
  name: guideFullName(a),
  firstName: guideFirstName(a),
  // Carried so a report configured with "send in guide language" can render in
  // this guide's own language. Hebrew unless the person explicitly chose
  // otherwise, and the renderer falls back to Hebrew anyway when a report has
  // no English version.
  preferredLanguage: staffLanguage(a.personRef),
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
  const floorFor = await activationFloors([12], client);
  const holidays = await loadBlockingHolidays(addDays(today, -14), addDays(today, 21), client);

  const fired = [];
  for (const tour of tours) {
    const due = coordinationSendMs(tour.date, holidays);
    if (!isDue(due.ms, nowMs, floorFor(12))) continue;
    const guides = notifiableGuides(tour.assignments);
    if (!guides.length) continue;

    const isOpen = tour.kind === 'group_slot';
    const facts = isOpen
      ? { openTour: true, ...tourNotificationFacts(tour), participants: await openTourParticipants(tour.id, client) }
      : { openTour: false, ...tourNotificationFacts(tour) };

    // COORDINATION IS PER CUSTOMER, not per tour. An open tour with three
    // bookings needs three coordination calls, three forms and three messages —
    // one per customer. The previous key was coord_call:<tour>:<guide>, so a
    // guide got ONE message for a tour with several unrelated customers, and
    // there was no way to track them independently.
    //
    // The coordination FORM was already per booking (subjectType 'booking');
    // only the message was collapsed to the tour. This aligns them.
    for (const booking of tour.bookings) {
      for (const a of guides) {
        const recipient = recipientOf(a);
        // The link authorizes exactly THIS booking's coordination form. Minted
        // once and reused by every retry and later reminder.
        const formUrl = await staffFormLinkUrl({
          purpose: 'coordination',
          subjectType: 'booking',
          subjectId: booking.id,
        }, { db: client, log });

        const r = await fireAdminReport({
          number: 12,
          // Business identity: this customer's coordination, for this guide.
          idempotencyKey: `coord_call:${tour.id}:${booking.id}:${a.externalPersonId}`,
          tourEventId: tour.id,
          dealId: booking.dealId || null,
          recipient,
          data: {
            guideNotice: {
              ...facts,
              // One customer per message, so the guide knows who to call.
              customerName: bookingCustomerName(booking),
              participants: booking.deal?.participants ?? facts.participants,
              formUrl,
              sendDate: due.date,
              movedDays: due.movedDays,
              moveReasons: due.reasons,
            },
          },
        }, log);
        if (r?.ok) fired.push({ number: 12, tourEventId: tour.id, bookingId: booking.id, guide: recipient.name });
      }
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
  const floorFor = await activationFloors(SUMMARY_REMINDERS.map((s) => s.number), client);

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
        if (!isDue(dueMs, nowMs, floorFor(step.number))) continue;
        const r = await fireAdminReport({
          number: step.number,
          idempotencyKey: `summary:${tour.id}:${a.externalPersonId}`,
          tourEventId: tour.id,
          dealId: tour.bookings[0]?.dealId || null,
          recipient,
          // TOUR SUMMARY IS PER GUIDE (perActor), never per customer: 20
          // participants on one tour still means ONE summary for this guide.
          // The key is already tour+guide, which is correct — only the link
          // changes, from a portal deep link to a form-scoped one.
          data: {
            guideNotice: {
              ...facts,
              formUrl: await summaryFormUrl(tour.id, a.externalPersonId, client, log),
              // Null when the gallery is off for guides (or no PersonRef) —
              // the renderer then omits the photo section rather than send a
              // dead link.
              photoUploadUrl: await guideGalleryUploadUrl(
                client,
                { tourEventId: tour.id, personRefId: a.personRef?.id || null },
                { log },
              ),
            },
          },
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
