// Time windows for the CRM Tasks workspace — the chips are the workspace's
// primary navigation, and this is the ONE place their meaning is defined.
//
// BINDING RULE (architecture decision #4): the windows are MUTUALLY EXCLUSIVE.
// They tile the timeline with no gaps and no overlaps, so the chip counts sum
// to a real number and the bar reads as a timeline rather than a filter menu.
//
//   באיחור      overdue    dueDate < today          (open tasks only — see below)
//   היום        today      exactly today
//   מחר         tomorrow   exactly tomorrow
//   השבוע       this_week  today+2 … Saturday of this week   (may be EMPTY)
//   השבוע הבא   next_week  the next calendar week, minus anything already
//                          claimed by today/tomorrow
//   טווח תאריכים range      an explicit inclusive range (the only window
//                          allowed to overlap the others)
//
// Two edges that fall out of mutual exclusivity, both deliberate:
//
//  * this_week is EMPTY on Friday and Saturday. "The remaining days after
//    tomorrow" has nowhere to go at the end of an Israeli week. The chip
//    renders disabled with count 0 — it is never redefined to overlap another
//    chip (decision #4).
//
//  * On SATURDAY, tomorrow (Sunday) is also the first day of the next calendar
//    week. A naive "next_week = Sunday…Saturday" would double-count it. So
//    next_week starts at max(next Sunday, today+2). On Saturday that is Monday;
//    Sunday stays under מחר, where the operator just put it. Every future day
//    is still reachable through exactly one chip.
//
// Coverage check (the invariant the tests pin):
//   Sun:  today=Sun  tomorrow=Mon  this_week=Tue–Sat  next_week=Sun–Sat
//   Thu:  today=Thu  tomorrow=Fri  this_week=Sat      next_week=Sun–Sat
//   Fri:  today=Fri  tomorrow=Sat  this_week=(empty)  next_week=Sun–Sat
//   Sat:  today=Sat  tomorrow=Sun  this_week=(empty)  next_week=Mon–Sat
//
// Windows resolve to CALENDAR-DATE bounds; the caller converts to the Prisma
// dueDate filter via israelDate.dateRangeBounds (see israelDate.js for why the
// bounds are UTC-midnight anchored rather than Israel-local instants).
//
// Pure: injectable clock, no I/O, no Prisma import.

import { israelToday, addDays, startOfWeek, endOfWeek, isValidDate, compareDates } from '../lib/israelDate.js';

export const WINDOWS = Object.freeze(['overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'range']);

/** The workspace default. Decision: first-time state is owner=me, window=today, status=open. */
export const DEFAULT_WINDOW = 'today';

export function isValidWindow(w) {
  return WINDOWS.includes(w);
}

/**
 * Resolve a window to inclusive calendar-date bounds.
 *
 * @param {string} window one of WINDOWS
 * @param {object} [opts]
 * @param {number} [opts.nowMs]      injectable clock
 * @param {string} [opts.today]      override the resolved date directly (tests)
 * @param {string} [opts.rangeFrom]  required when window === 'range'
 * @param {string} [opts.rangeTo]    required when window === 'range'
 * @returns {{ok: true, bounds: {from: string|null, to: string|null}, empty: boolean, openOnly: boolean}
 *          | {ok: false, error: string}}
 *
 * bounds.from === null means "unbounded backwards" (overdue only).
 * `empty: true` means the window covers no dates at all — the caller must
 * return zero rows WITHOUT querying, and render the chip disabled.
 * `openOnly: true` means the window also pins status='open' (overdue only).
 */
export function resolveWindow(window, opts = {}) {
  if (!isValidWindow(window)) return { ok: false, error: 'invalid_window' };

  const today = opts.today ?? israelToday(opts.nowMs);
  if (!isValidDate(today)) return { ok: false, error: 'invalid_today' };

  const ok = (from, to, extra = {}) => ({
    ok: true,
    bounds: { from, to },
    empty: false,
    openOnly: false,
    ...extra,
  });

  switch (window) {
    case 'overdue':
      // Unbounded backwards. Overdue is meaningless for a completed task, so
      // this is the ONE window that also constrains status (decision, §3.2).
      return ok(null, addDays(today, -1), { openOnly: true });

    case 'today':
      return ok(today, today);

    case 'tomorrow':
      return ok(addDays(today, 1), addDays(today, 1));

    case 'this_week': {
      const from = addDays(today, 2);
      const to = endOfWeek(today);
      // Friday/Saturday: nothing left after tomorrow in this week.
      if (compareDates(from, to) > 0) {
        return { ok: true, bounds: { from: null, to: null }, empty: true, openOnly: false };
      }
      return ok(from, to);
    }

    case 'next_week': {
      const nextSunday = addDays(startOfWeek(today), 7);
      const afterTomorrow = addDays(today, 2);
      // On Saturday, Sunday belongs to מחר — do not double-count it.
      const from = compareDates(nextSunday, afterTomorrow) >= 0 ? nextSunday : afterTomorrow;
      return ok(from, addDays(nextSunday, 6));
    }

    case 'range': {
      const { rangeFrom, rangeTo } = opts;
      if (!isValidDate(rangeFrom) || !isValidDate(rangeTo)) return { ok: false, error: 'invalid_range' };
      if (compareDates(rangeFrom, rangeTo) > 0) return { ok: false, error: 'invalid_range' };
      return ok(rangeFrom, rangeTo);
    }

    default:
      return { ok: false, error: 'invalid_window' };
  }
}

/**
 * Every window's bounds at once — for the counts endpoint, and for proving the
 * tiling invariant in tests.
 */
export function resolveAllWindows(opts = {}) {
  const out = {};
  for (const w of WINDOWS) {
    if (w === 'range' && !(opts.rangeFrom && opts.rangeTo)) continue;
    out[w] = resolveWindow(w, opts);
  }
  return out;
}

/**
 * The outer calendar span the counts endpoint must scan to bucket
 * today/tomorrow/this_week/next_week in ONE query: today … end of next week.
 * `overdue` is unbounded backwards and is counted separately.
 */
export function countScanBounds(opts = {}) {
  const today = opts.today ?? israelToday(opts.nowMs);
  return { from: today, to: addDays(addDays(startOfWeek(today), 7), 6) };
}

/**
 * Which bucket a due date falls into, for in-memory bucketing of the counts
 * scan. Returns null when the date is outside every counted window.
 * MUST agree with resolveWindow — the tests pin that.
 */
export function bucketOf(dueDateStr, opts = {}) {
  const today = opts.today ?? israelToday(opts.nowMs);
  for (const w of ['today', 'tomorrow', 'this_week', 'next_week']) {
    const r = resolveWindow(w, { today });
    if (!r.ok || r.empty) continue;
    if (compareDates(dueDateStr, r.bounds.from) >= 0 && compareDates(dueDateStr, r.bounds.to) <= 0) return w;
  }
  return null;
}
