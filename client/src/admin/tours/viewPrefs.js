// Tours module VIEW preferences (primary tab + calendar mode + calendar
// ANCHOR date), persisted in the ONE existing localStorage key. Split out of
// ToursPage so the persistence contract is unit-testable and there is exactly
// one place that reads/writes it.
//
// Why the anchor lives here now: production bug — only the mode was persisted,
// so a browser refresh threw the calendar back to today. The anchor is a
// stable Israel-local calendar date ("YYYY-MM-DD", never a timezone-dependent
// Date string), validated on read; an invalid/missing value yields null so
// the calendar falls back to today (Asia/Jerusalem) exactly as before.

const VIEW_KEY = 'tours.view.v1';
const MODES = ['month', 'week', 'day'];

// A calendar-date string the calendar math can trust: strict YYYY-MM-DD AND a
// real date (rejects 2026-13-40 etc.). No timezone parsing — compared as UTC
// midnight only to validate, never to derive "today".
export function isValidTourDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  // Round-trip guard: JS rolls invalid days over (2026-02-30 → Mar 2), so
  // require the parsed date to serialize back to the same string.
  return new Date(ms).toISOString().slice(0, 10) === s;
}

export function loadToursView() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
  } catch {
    raw = {};
  }
  return {
    tab: raw.tab === 'calendar' ? 'calendar' : 'table',
    calMode: MODES.includes(raw.calMode) ? raw.calMode : 'month',
    // null → the calendar starts at today (Asia/Jerusalem).
    calAnchor: isValidTourDate(raw.calAnchor) ? raw.calAnchor : null,
  };
}

export function saveToursView(v) {
  try {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        tab: v.tab === 'calendar' ? 'calendar' : 'table',
        calMode: MODES.includes(v.calMode) ? v.calMode : 'month',
        calAnchor: isValidTourDate(v.calAnchor) ? v.calAnchor : null,
      }),
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}
