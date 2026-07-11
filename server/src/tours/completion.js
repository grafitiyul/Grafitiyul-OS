// Tour COMPLETION — the ONE transition for the explicit business state
// "the tour is over". Three triggers, one function:
//   1. all REQUIRED guides (lead_guide / guide — NOT workshop assistants)
//      submitted their per-guide tour summary  → reason 'summaries'
//   2. midnight (business timezone) after the tour date passed → 'midnight'
//      (completionWorker sweep; completedAt is stamped AT that midnight, not
//      at sweep time, so the summary edit window is never extended by lag)
//   3. an admin pressed "סמן סיור כהסתיים" → 'manual'
//
// completedAt is the anchor the questionnaire lifecycle derives its structure
// freeze + answer locks from (lifecyclePolicy.js).

import { prisma } from '../db.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { calendarPendingPatch } from './calendar/service.js';

export const REQUIRED_SUMMARY_ROLES = ['lead_guide', 'guide'];

// Business timezone — tour dates are calendar dates in Israel, wherever the
// server happens to run.
export const TOUR_TZ = 'Asia/Jerusalem';

const tzDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TOUR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const tzHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: TOUR_TZ, hour: '2-digit', hourCycle: 'h23',
});

// Today's calendar date in the business timezone, as "YYYY-MM-DD".
export function businessToday(nowMs = Date.now()) {
  return tzDate.format(new Date(nowMs));
}

// The UTC instant of midnight (in TOUR_TZ) AFTER the given calendar date —
// i.e. when "the tour date has passed". Israel is UTC+2 (standard) or UTC+3
// (DST), so that instant is 22:00Z or 21:00Z of the date itself; we probe
// both candidates and pick the one that actually renders as next-day 00:00.
export function midnightAfterMs(dateStr) {
  for (const utcHour of [21, 22]) {
    const t = Date.parse(`${dateStr}T${String(utcHour).padStart(2, '0')}:00:00Z`);
    if (Number.isNaN(t)) return Number.NaN;
    const d = new Date(t);
    if (tzDate.format(d) !== dateStr && tzHour.format(d) === '00') return t;
  }
  return Number.NaN;
}

// Per-required-guide summary state. allSubmitted is false when the tour has
// no required guides at all — an empty requirement must never auto-complete.
export async function summaryCompletionState(client, tourEventId) {
  const assignments = await client.tourAssignment.findMany({
    where: { tourEventId, role: { in: REQUIRED_SUMMARY_ROLES } },
    select: { externalPersonId: true, displayName: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
  const submitted = new Set(
    (
      await client.questionnaireSubmission.findMany({
        where: {
          subjectType: 'tour_event',
          subjectId: tourEventId,
          purpose: 'tour_summary',
          status: { in: ['submitted', 'reviewed'] },
          actorScope: { in: assignments.map((a) => a.externalPersonId) },
        },
        select: { actorScope: true },
      })
    ).map((s) => s.actorScope),
  );
  const required = assignments.map((a) => ({
    externalPersonId: a.externalPersonId,
    displayName: a.displayName,
    role: a.role,
    submitted: submitted.has(a.externalPersonId),
  }));
  return {
    required,
    missing: required.filter((r) => !r.submitted),
    allSubmitted: required.length > 0 && required.every((r) => r.submitted),
  };
}

const REASON_BODY = {
  summaries: '✅ כל המדריכים הגישו סיכום סיור — הסיור סומן כהסתיים',
  midnight: '🌙 הסיור סומן כהסתיים אוטומטית (חלף תאריך הסיור)',
  manual: '✅ הסיור סומן כהסתיים ידנית',
};

// The ONE completion transition. Idempotent on completed tours; refuses
// cancelled ones. `client` may be a transaction (summary-submit trigger runs
// inside the submit tx).
export async function completeTour(client, tourEventId, { reason, actorName = null, completedAt = null, nowMs = Date.now() } = {}) {
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: { id: true, status: true, date: true },
  });
  if (!tour) return { ok: false, error: 'not_found' };
  if (tour.status === 'completed') return { ok: true, already: true };
  if (tour.status === 'cancelled') return { ok: false, error: 'tour_cancelled' };
  // A postponed tour has no date — "over" is meaningless until it is
  // rescheduled (Apply Tour Update transitions it back to scheduled).
  if (tour.status === 'postponed') return { ok: false, error: 'tour_postponed' };
  // MANUAL completion is a same-day operational action ONLY (business TZ).
  // Before the tour day there is nothing to wrap up; after it the midnight
  // sweep already completed the tour. Enforced here — not just UI visibility —
  // so a crafted request cannot complete a future tour by accident.
  if (reason === 'manual' && tour.date !== businessToday(nowMs)) {
    return { ok: false, error: 'not_tour_day' };
  }

  const stamp = completedAt || new Date();
  await client.tourEvent.update({
    where: { id: tourEventId },
    data: { status: 'completed', completedAt: stamp, completedReason: reason },
  });
  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    body: (REASON_BODY[reason] || REASON_BODY.manual) + (actorName ? ` על ידי ${actorName}` : ''),
    data: { event: 'completed', reason, completedAt: stamp.toISOString() },
    origin: systemOrigin(),
  });
  return { ok: true, already: false };
}

// The ONE completion REVERSAL — "החזר לעתידי" for an accidental manual
// completion. Only a completed tour whose date context is still current
// (today or future, business TZ) may return to 'scheduled': once the date
// passed, the tour belongs to the past and the midnight sweep would just
// re-complete it.
//
// Questionnaire lifecycle safety: the lazy structure-freeze stamps frozenAt
// strictly AFTER completedAt, so `frozenAt >= completedAt` identifies exactly
// the submissions frozen BECAUSE OF this completion. Clearing frozenAt
// restores the live-version lifecycle (applyLifecycle re-syncs them to the
// template's current published version on next read). Answers and their
// snapshots are never touched — a later freeze rebuilds snapshots; history
// entries are never mutated (the reversal is a NEW timeline event).
export async function reopenTour(client, tourEventId, { actorName = null, nowMs = Date.now() } = {}) {
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: { id: true, status: true, date: true, completedAt: true, completedReason: true },
  });
  if (!tour) return { ok: false, error: 'not_found' };
  if (tour.status !== 'completed') return { ok: false, error: 'not_completed' };
  if (!tour.date || tour.date < businessToday(nowMs)) return { ok: false, error: 'date_passed' };

  const prevCompletedAt = tour.completedAt;
  // gcal: the event was KEPT at completion (history is never cancelled), so
  // marking pending reconciles the SAME gcalEventId — no duplicate event.
  await client.tourEvent.update({
    where: { id: tourEventId },
    data: { status: 'scheduled', completedAt: null, completedReason: null, ...calendarPendingPatch() },
  });

  const bookings = await client.booking.findMany({
    where: { tourEventId },
    select: { id: true },
  });
  await client.questionnaireSubmission.updateMany({
    where: {
      frozenAt: prevCompletedAt ? { gte: prevCompletedAt } : { not: null },
      OR: [
        { subjectType: 'tour_event', subjectId: tourEventId },
        { subjectType: 'booking', subjectId: { in: bookings.map((b) => b.id) } },
      ],
    },
    data: { frozenAt: null },
  });

  await emitTimelineEvent(client, {
    subjectType: 'tour_event',
    subjectId: tourEventId,
    kind: 'tour',
    body: '↩️ הסיור הוחזר לסטטוס "מתוכנן"' + (actorName ? ` על ידי ${actorName}` : ''),
    data: {
      event: 'reopened',
      previousCompletedAt: prevCompletedAt ? prevCompletedAt.toISOString() : null,
      previousCompletedReason: tour.completedReason || null,
    },
    origin: systemOrigin(),
  });
  return { ok: true };
}

// Midnight sweep body (worker tick): every scheduled tour whose calendar date
// is strictly before "today" (business TZ) completes with reason 'midnight',
// stamped at the actual midnight after its date.
export async function sweepOverdueTours(client = prisma, nowMs = Date.now(), { limit = 200 } = {}) {
  const today = businessToday(nowMs);
  const overdue = await client.tourEvent.findMany({
    where: { status: 'scheduled', date: { lt: today } },
    select: { id: true, date: true },
    orderBy: { date: 'asc' },
    take: limit,
  });
  let completed = 0;
  for (const t of overdue) {
    const mid = midnightAfterMs(t.date);
    const res = await completeTour(client, t.id, {
      reason: 'midnight',
      completedAt: Number.isNaN(mid) ? new Date(nowMs) : new Date(mid),
    });
    if (res.ok && !res.already) completed += 1;
  }
  return { scanned: overdue.length, completed };
}
