// Asia/Jerusalem date helpers for the Tours calendar.
//
// Tour date/startTime are Israel-local WALL values ("YYYY-MM-DD" + "HH:MM"),
// so all grid math here is pure day arithmetic on date STRINGS (done in UTC on
// purpose — no DST edge can shift a calendar day). The ONLY timezone-sensitive
// value is "today", which must be the Israel calendar date even when an admin
// opens the system abroad, across DST changes, midnight, week and month
// boundaries — never the browser's local date.

export const TOUR_TZ = 'Asia/Jerusalem';

const IL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: TOUR_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayIL() {
  return IL_DATE.format(new Date()); // "YYYY-MM-DD"
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0=ראשון … 6=שבת (JS getDay convention — same as TourScheduleRule.weekday).
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// Israel weeks start on Sunday.
export function startOfWeek(dateStr) {
  return addDays(dateStr, -weekdayOf(dateStr));
}

export function startOfMonth(dateStr) {
  return `${dateStr.slice(0, 8)}01`;
}

export function addMonths(monthStart, n) {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

// Full visible month grid: whole weeks (Sunday-first) covering the month,
// including leading/trailing days from the neighbouring months.
// Returns an array of weeks, each week an array of 7 "YYYY-MM-DD" strings.
export function monthGrid(monthStart) {
  const nextMonth = addMonths(monthStart, 1);
  const weeks = [];
  let cur = startOfWeek(monthStart);
  while (cur < nextMonth) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const MONTH_NAMES_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export function monthTitle(monthStart) {
  return `${MONTH_NAMES_HE[Number(monthStart.slice(5, 7)) - 1]} ${monthStart.slice(0, 4)}`;
}

// "13/07" — compact numeric day for range titles and week headers.
export function fmtDayShort(dateStr) {
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

// "HH:MM" → minutes since midnight (NaN-safe: null → NaN).
export function timeToMinutes(t) {
  if (!t) return NaN;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

// End time label for an event given its duration in hours (may be fractional).
export function endTimeOf(startTime, durationHours) {
  const start = timeToMinutes(startTime);
  if (Number.isNaN(start) || !durationHours) return null;
  const end = Math.min(start + Math.round(durationHours * 60), 24 * 60 - 1);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}
