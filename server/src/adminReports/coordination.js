// Coordination-call timing — the ONE place the "2 days before the tour"
// deadline is defined.
//
// Audit note: GOS had NO coordination deadline rule before this module; the
// 2-day rule is a business rule introduced here (specified by the owner) and
// lives in code because these reports are code-managed. It is expressed
// against the CANONICAL effective tour datetime (TourEvent.date + startTime,
// Israel time, DST-correct via the shared israelLocalToMs), so a rescheduled
// tour automatically moves its own deadline — nothing is cached.
//
// Canonical unit (owner decision): a coordination call is ONE form per
// BOOKING (QuestionnaireSubmission purpose='coordination', subjectType=
// 'booking'), fillable by any assigned guide — NOT a per-guide obligation.

import { israelLocalToMs } from '../communication/windows.js';

/** Days before the tour by which the coordination call must be completed. */
export const COORDINATION_LEAD_DAYS = 2;

/**
 * How many Israel calendar days forward the daily coordination monitor covers,
 * counting today. 5 ⇒ today .. today+4. This is the ONE definition — the
 * collector's query window and the report's wording both derive from it.
 */
export const COORDINATION_MONITOR_DAYS = 5;

/** Statuses that count as a real, completed coordination call. */
export const DONE_STATUSES = ['submitted', 'reviewed'];

/** The tour's effective start instant (ms), or null when it has no datetime. */
export function tourStartMs(tour) {
  if (!tour?.date) return null;
  const t = tour.startTime || '00:00';
  const minutes = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return israelLocalToMs(tour.date, Number.isFinite(minutes) ? minutes : 0);
}

/**
 * The coordination deadline instant for a tour: COORDINATION_LEAD_DAYS before
 * its effective start. Inclusive — completing exactly at the deadline is ON
 * TIME (see onTime() below).
 */
export function coordinationDeadlineMs(tour) {
  const start = tourStartMs(tour);
  return start == null ? null : start - COORDINATION_LEAD_DAYS * 24 * 60 * 60 * 1000;
}

/** Inclusive on-time test: submitted at or before the deadline. */
export function isOnTime(submittedAtMs, deadlineMs) {
  if (deadlineMs == null || submittedAtMs == null) return null; // undecidable
  return submittedAtMs <= deadlineMs;
}

/**
 * Human lateness ("יומיים ו-3 שעות"), computed from the canonical deadline —
 * never from a status label.
 */
export function latenessLabel(submittedAtMs, deadlineMs) {
  if (deadlineMs == null || submittedAtMs == null) return null;
  let ms = submittedAtMs - deadlineMs;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  ms -= days * 86_400_000;
  const hours = Math.floor(ms / 3_600_000);
  ms -= hours * 3_600_000;
  const minutes = Math.floor(ms / 60_000);
  const parts = [];
  if (days === 1) parts.push('יום');
  else if (days === 2) parts.push('יומיים');
  else if (days > 2) parts.push(`${days} ימים`);
  if (hours === 1) parts.push('שעה');
  else if (hours === 2) parts.push('שעתיים');
  else if (hours > 2) parts.push(`${hours} שעות`);
  if (!parts.length) parts.push(minutes === 1 ? 'דקה' : `${minutes} דקות`);
  // Hebrew "ו" attaches to the next word ("ושעתיים") but takes a hyphen before
  // a numeral ("ו-5 שעות").
  return parts.reduce((acc, part) => (acc ? `${acc} ${/^\d/.test(part) ? 'ו-' : 'ו'}${part}` : part), '');
}

/**
 * Monitoring status for one coordination call:
 *   'done'    ✅ a valid submission exists (late or not)
 *   'overdue' ⛔ deadline passed, no valid submission
 *   'open'    ⌛ no submission yet, deadline has not passed
 */
export function coordinationStatus({ submittedAtMs, deadlineMs, nowMs }) {
  if (submittedAtMs != null) return 'done';
  if (deadlineMs != null && nowMs > deadlineMs) return 'overdue';
  return 'open';
}
