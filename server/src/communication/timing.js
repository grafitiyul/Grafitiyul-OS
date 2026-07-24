// Send-time computation: anchor + (immediate | before | after) offset — pure,
// Israel-timezone aware (DST-correct via windows.js's local↔instant mapping).
//
// Offset semantics (documented, tested):
//   minutes/hours — exact instant arithmetic.
//   days/weeks    — Israel CALENDAR days: the send lands at the same local
//                   wall-clock time N days later/earlier, even across a DST
//                   change (a "3 days before, 09:00" reminder stays at 09:00).
//   months        — Israel calendar months, day-of-month clamped to the end of
//                   the target month (Jan 31 + 1 month → Feb 28/29).
// "Immediately" is an explicit mode — not "0 minutes after".

import { israelParts, israelLocalToMs } from './windows.js';

function addCalendarDays(ms, days) {
  const p = israelParts(ms);
  const d = new Date(`${p.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return israelLocalToMs(d.toISOString().slice(0, 10), p.minutes);
}

function addCalendarMonths(ms, months) {
  const p = israelParts(ms);
  const [y, m, day] = p.date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return israelLocalToMs(target.toISOString().slice(0, 10), p.minutes);
}

export function applyOffset(anchorMs, { timingMode, timingAmount, timingUnit }) {
  if (timingMode === 'immediate' || !timingMode) return anchorMs;
  const amount = Number(timingAmount);
  if (!Number.isFinite(amount) || amount <= 0) return anchorMs;
  const sign = timingMode === 'before' ? -1 : 1;
  switch (timingUnit) {
    case 'minutes': return anchorMs + sign * amount * 60_000;
    case 'hours': return anchorMs + sign * amount * 3_600_000;
    case 'days': return addCalendarDays(anchorMs, sign * amount);
    case 'weeks': return addCalendarDays(anchorMs, sign * amount * 7);
    case 'months': return addCalendarMonths(anchorMs, sign * amount);
    default: return anchorMs;
  }
}

/**
 * The anchor instant for an event given the trigger context.
 * trigger_time → the moment the trigger fired.
 * tour_datetime → the linked tour's local start (date+startTime, Israel);
 * null when the context has no scheduled tour — the delivery is created as
 * waiting_dependency and re-resolved by the worker.
 */
export function resolveAnchorMs(event, ctx, triggerAtMs) {
  if (event.anchorType === 'tour_datetime') {
    const tour = ctx.tour;
    if (!tour?.date) return null;
    const minutes = tour.startTime
      ? Number(tour.startTime.slice(0, 2)) * 60 + Number(tour.startTime.slice(3, 5))
      : 0;
    return israelLocalToMs(tour.date, minutes);
  }
  return triggerAtMs;
}

/** intendedAt for a delivery — null ⇒ anchor unavailable (waiting_dependency). */
export function computeIntendedAt(event, ctx, triggerAtMs) {
  const anchor = resolveAnchorMs(event, ctx, triggerAtMs);
  if (anchor == null) return null;
  return applyOffset(anchor, event);
}
