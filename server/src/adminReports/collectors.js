// Dataset collectors for the scheduled admin reports — canonical queries only.
//
// Every fact comes from the SSOT models: TourAssignment (roles), the canonical
// REQUIRED_SUMMARY_ROLES, QuestionnaireSubmission (coordination per BOOKING,
// tour_summary per GUIDE via actorScope), Booking→Deal for the customer label.
// Nothing is inferred from notes or status labels.

import { prisma } from '../db.js';
import { israelToday, addDays } from '../lib/israelDate.js';
import { REQUIRED_SUMMARY_ROLES } from '../tours/completion.js';
import {
  coordinationDeadlineMs, coordinationStatus, tourStartMs, DONE_STATUSES, COORDINATION_MONITOR_DAYS,
} from './coordination.js';

// Tours that are real, dated and not cancelled/postponed.
const LIVE_TOUR_STATUSES = ['scheduled', 'completed'];

const TOUR_SELECT = {
  id: true, date: true, startTime: true, status: true,
  product: { select: { nameHe: true } },
  location: { select: { nameHe: true } },
  assignments: {
    where: { role: { in: REQUIRED_SUMMARY_ROLES } },
    select: { externalPersonId: true, displayName: true, role: true, personRef: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
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

const guideName = (a) => a?.personRef?.displayName || a?.displayName || null;
const contactName = (deal) => {
  const c = deal?.contacts?.[0]?.contact;
  if (!c) return null;
  return `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim()
    || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || null;
};

/**
 * Report #6 — coordination calls for tours in the monitor window
 * (COORDINATION_MONITOR_DAYS Israel calendar days counting today).
 * ONE item per BOOKING (the canonical coordination unit).
 */
export async function collectCoordinationWindow(nowMs = Date.now(), client = prisma) {
  const from = israelToday(nowMs);
  const to = addDays(from, COORDINATION_MONITOR_DAYS - 1);
  const tours = await client.tourEvent.findMany({
    where: { status: { in: LIVE_TOUR_STATUSES }, date: { gte: from, lte: to } },
    select: TOUR_SELECT,
  });

  const bookingIds = tours.flatMap((t) => t.bookings.map((b) => b.id));
  const submissions = bookingIds.length
    ? await client.questionnaireSubmission.findMany({
      where: {
        subjectType: 'booking', subjectId: { in: bookingIds },
        purpose: 'coordination', status: { in: DONE_STATUSES },
      },
      select: { subjectId: true, submittedAt: true, submittedByName: true },
    })
    : [];
  const byBooking = new Map(submissions.map((s) => [s.subjectId, s]));

  const items = [];
  for (const tour of tours) {
    const deadlineMs = coordinationDeadlineMs(tour);
    const startMs = tourStartMs(tour);
    const assignedNames = tour.assignments.map(guideName).filter(Boolean);
    for (const booking of tour.bookings) {
      const sub = byBooking.get(booking.id) || null;
      const submittedAtMs = sub?.submittedAt ? new Date(sub.submittedAt).getTime() : null;
      const status = coordinationStatus({ submittedAtMs, deadlineMs, nowMs });
      items.push({
        key: `booking:${booking.id}`,
        status,
        wasLate: status === 'done' && deadlineMs != null && submittedAtMs != null && submittedAtMs > deadlineMs,
        // Completed → who actually submitted; pending → the assigned guide(s).
        guideName: sub?.submittedByName
          ? String(sub.submittedByName).replace(/^מדריך\s*·\s*/, '')
          : (assignedNames.join(', ') || null),
        customerName: contactName(booking.deal),
        orgName: booking.deal?.organization?.name || null,
        participants: booking.deal?.participants ?? null,
        tourStartMs: startMs,
      });
    }
  }

  // Overdue → open → done; nearest tour first inside each group.
  const rank = { overdue: 0, open: 1, done: 2 };
  items.sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.tourStartMs ?? 0) - (b.tourStartMs ?? 0)));
  return items;
}

/**
 * Missing per-guide tour summaries for tours whose effective start is in
 * [fromDate, toDate] (Israel calendar dates) and already past.
 * ONE item per (tour × required guide) — two missing guides = two items.
 */
export async function collectMissingSummaries({ fromDate, toDate, nowMs = Date.now(), client = prisma }) {
  const tours = await client.tourEvent.findMany({
    where: { status: { in: LIVE_TOUR_STATUSES }, date: { gte: fromDate, lte: toDate } },
    select: TOUR_SELECT,
  });
  const tourIds = tours.map((t) => t.id);
  const submissions = tourIds.length
    ? await client.questionnaireSubmission.findMany({
      where: {
        subjectType: 'tour_event', subjectId: { in: tourIds },
        purpose: 'tour_summary', status: { in: DONE_STATUSES },
      },
      select: { subjectId: true, actorScope: true },
    })
    : [];
  const done = new Set(submissions.map((s) => `${s.subjectId}:${s.actorScope}`));

  const items = [];
  for (const tour of tours) {
    const startMs = tourStartMs(tour);
    // Only tours that have actually happened.
    if (startMs == null || startMs > nowMs) continue;
    const booking = tour.bookings[0] || null;
    for (const a of tour.assignments) {
      if (!a.externalPersonId) continue;
      if (done.has(`${tour.id}:${a.externalPersonId}`)) continue;
      items.push({
        key: `${tour.id}:${a.externalPersonId}`,
        tourEventId: tour.id,
        dealId: booking?.dealId || null,
        guideName: guideName(a),
        role: a.role,
        productName: tour.product?.nameHe || null,
        cityName: tour.location?.nameHe || null,
        customerName: contactName(booking?.deal),
        orgName: booking?.deal?.organization?.name || null,
        tourDate: tour.date,
        tourTime: tour.startTime,
        tourStartMs: startMs,
      });
    }
  }
  // Oldest missing summary first, then guide name.
  items.sort((a, b) => (a.tourStartMs - b.tourStartMs) || String(a.guideName).localeCompare(String(b.guideName), 'he'));
  return items;
}

/** Report #7 — the previous 7 Israel calendar days (excluding today). */
export function last7DayRange(nowMs = Date.now()) {
  const today = israelToday(nowMs);
  return { fromDate: addDays(today, -7), toDate: addDays(today, -1) };
}

/** Report #8 — yesterday only (Israel calendar date). */
export function yesterdayRange(nowMs = Date.now()) {
  const y = addDays(israelToday(nowMs), -1);
  return { fromDate: y, toDate: y };
}
