// THE canonical Israel-calendar date module for the server.
//
// Before this module existed there were THREE independent "today in Israel"
// implementations (tours/completion.js `businessToday`, tours/slotGeneration.js
// `israelToday`, search/searchService.js's private `todayIsoUtc`) and no
// date-bounds helper at all. This module is the single source of truth; the
// other modules now re-export from here rather than reimplementing.
//
// Two distinct concepts live here and must not be confused:
//
//   1. A CALENDAR DATE ("YYYY-MM-DD") — what a human in Israel calls "today".
//      Computed in Asia/Jerusalem, because the server runs UTC and a task due
//      "today" must mean today in Tel Aviv, not in UTC.
//
//   2. A UTC INSTANT — what Postgres compares a DateTime column against.
//
// Task.dueDate is a DateTime that stores a CALENDAR DATE anchored at UTC
// midnight (verified against production 2026-07-16: 7/7 rows are exactly
// T00:00:00.000Z; the clock lives in the separate `dueTime` string). So the
// bounds here are UTC-midnight half-open ranges over calendar dates, NOT
// Israel-local instants. `dayBounds('2026-07-15')` → dueDate >= 2026-07-15T00:00Z
// AND dueDate < 2026-07-16T00:00Z.
//
// Pure: no imports, no I/O, injectable clock everywhere.

export const ISRAEL_TZ = 'Asia/Jerusalem';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const tzDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const tzHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: ISRAEL_TZ, hour: '2-digit', hourCycle: 'h23',
});

/** Today's calendar date in Israel, as "YYYY-MM-DD". Clock is injectable. */
export function israelToday(nowMs = Date.now()) {
  return tzDate.format(new Date(nowMs));
}

/**
 * Strict validity: correct shape AND a real calendar date.
 * Rejects '2026-02-30', which JS would otherwise roll over to March 2.
 */
export function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/** Calendar-date arithmetic. UTC-anchored so no DST shift can move a date. */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. Israel weeks start on Sunday. */
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** The Sunday of dateStr's week. */
export function startOfWeek(dateStr) {
  return addDays(dateStr, -weekdayOf(dateStr));
}

/** The Saturday of dateStr's week. */
export function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

/** Lexicographic comparison is correct for "YYYY-MM-DD". */
export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Half-open UTC bounds for an inclusive calendar-date range.
 * `dayBounds(d)` covers exactly the single date d.
 * Returns Date objects ready for Prisma: { gte, lt }.
 */
export function dateRangeBounds(fromDateStr, toDateStr) {
  return {
    gte: new Date(`${fromDateStr}T00:00:00.000Z`),
    lt: new Date(`${addDays(toDateStr, 1)}T00:00:00.000Z`),
  };
}

/** Bounds covering exactly one calendar date. */
export function dayBounds(dateStr) {
  return dateRangeBounds(dateStr, dateStr);
}

/** The UTC instant of the start of a calendar date (its lower bound). */
export function startOfDayUtc(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * The UTC instant of midnight (in Israel) AFTER the given calendar date — i.e.
 * when "the date has passed". Israel is UTC+2 (standard) or UTC+3 (DST), so
 * that instant is 22:00Z or 21:00Z of the date itself; probe both and pick the
 * one that actually renders as next-day 00:00. DST-correct without a tz library.
 *
 * NOTE: this is a real-time INSTANT, used by the tour-completion sweep. It is
 * NOT the bound used for dueDate filtering (see the module header).
 */
export function midnightAfterMs(dateStr) {
  for (const utcHour of [21, 22]) {
    const t = Date.parse(`${dateStr}T${String(utcHour).padStart(2, '0')}:00:00Z`);
    if (Number.isNaN(t)) return Number.NaN;
    const d = new Date(t);
    if (tzDate.format(d) !== dateStr && tzHour.format(d) === '00') return t;
  }
  return Number.NaN;
}
