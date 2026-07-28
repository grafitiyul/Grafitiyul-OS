// THE Israel business-day calendar — day-level questions the platform did not
// previously have an answer for.
//
// The existing canonical detector, pricing/engine.js `sabbathHolidayWindow`,
// answers "is this INSTANT holy time?" (it needs a minute-of-day and returns a
// pricing-relevant window). That is the right tool for pricing and payroll and
// stays untouched. What was missing is the DAY-level question — "is this
// calendar date a day we send operational messages on?" — and the calendar walk
// that follows from it. Both live here, once.
//
// Source of truth for holidays is the SAME data pricing reads: approved, active
// HolidayRule rows (type 'chag' | 'erev_chag'). Nothing is hardcoded — a year
// with no imported holidays simply has no holiday days, which is honest.

import { prisma } from '../db.js';
import { addDays, weekdayOf } from './israelDate.js';

/** Saturday. Friday is a normal working day (owner rule, 2026-07-28). */
export const SHABBAT_WEEKDAY = 6;

/** Holiday kinds that block an operational send. */
export const BLOCKING_HOLIDAY_TYPES = ['chag', 'erev_chag'];

/** How far back the walk may step before giving up (safety bound). */
const MAX_STEPS = 14;

/**
 * Load the blocking holiday dates in a range as a Set of "YYYY-MM-DD".
 * Only APPROVED + active rows count — the same gate pricing applies, so an
 * imported-but-unreviewed holiday never silently moves a message.
 */
export async function loadBlockingHolidays(fromDate, toDate, client = prisma) {
  const rows = await client.holidayRule.findMany({
    where: {
      status: 'approved',
      active: true,
      type: { in: BLOCKING_HOLIDAY_TYPES },
      date: { gte: new Date(`${fromDate}T00:00:00.000Z`), lte: new Date(`${toDate}T00:00:00.000Z`) },
    },
    select: { date: true, type: true, nameHe: true },
  });
  const byDate = new Map();
  for (const r of rows) {
    // HolidayRule.date is @db.Date — read it as a plain UTC calendar date, the
    // same normalisation pricing/engine.js uses.
    byDate.set(r.date.toISOString().slice(0, 10), { type: r.type, nameHe: r.nameHe });
  }
  return byDate;
}

/**
 * Is this calendar date a day operational messages may be sent on?
 * Blocked by: Shabbat, a holiday, or a holiday eve. Friday is allowed unless
 * that Friday is itself a holiday eve — holiday eve wins (owner rule).
 */
export function isSendableDay(dateStr, holidays = new Map()) {
  if (weekdayOf(dateStr) === SHABBAT_WEEKDAY) return false;
  return !holidays.has(dateStr);
}

/** Why a date is blocked — for honest logging/audit, never for logic. */
export function blockReason(dateStr, holidays = new Map()) {
  if (holidays.has(dateStr)) {
    const h = holidays.get(dateStr);
    return h.type === 'erev_chag' ? `ערב ${h.nameHe}` : h.nameHe;
  }
  if (weekdayOf(dateStr) === SHABBAT_WEEKDAY) return 'שבת';
  return null;
}

/**
 * Walk BACKWARDS from `dateStr` to the first sendable day (inclusive of the
 * start date). Returns { date, movedDays, reasons } — reasons lists what each
 * skipped day was, so a delivery row can explain itself.
 *
 * Moving EARLIER (never later) is deliberate: these are "do this before the
 * tour" messages, so a delay would defeat the message.
 */
export function moveEarlierToSendableDay(dateStr, holidays = new Map()) {
  let date = dateStr;
  const reasons = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    if (isSendableDay(date, holidays)) return { date, movedDays: i, reasons };
    reasons.push({ date, reason: blockReason(date, holidays) });
    date = addDays(date, -1);
  }
  // Fourteen consecutive blocked days cannot happen; if it somehow did, send on
  // the original date rather than swallow the message.
  return { date: dateStr, movedDays: 0, reasons, exhausted: true };
}

/**
 * The whole rule in one call: given a tour date and a lead time in days, the
 * calendar date the message should actually go out on.
 */
export function sendDateForLeadDays(tourDate, leadDays, holidays = new Map()) {
  return moveEarlierToSendableDay(addDays(tourDate, -leadDays), holidays);
}
