// Day navigation for the payroll daily screen — the ONE source of truth for
// both the rendered chevrons and the date arithmetic, so the RTL semantics
// can be regression-tested.
//
// RTL rule (Hebrew UI): the RIGHT-pointing chevron goes BACK a day (the past
// sits to the right), the LEFT-pointing chevron goes FORWARD. The chevrons
// are rendered as explicit SVG paths — never mirrored Unicode characters
// (‹ ›), which the bidi algorithm flips inside RTL text (the original bug).

export function shiftDay(dateISO, days) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Render order = DOM order = right-to-left in an RTL flex row: the first
// item is the RIGHTMOST control.
export const DAY_NAV = [
  { key: 'prev', delta: -1, points: 'right', title: 'יום קודם' },
  { key: 'next', delta: 1, points: 'left', title: 'יום הבא' },
];

// Bidi-safe chevron polyline points (24×24 viewBox) per pointing direction.
export const CHEVRON_POINTS = {
  right: '9 6 15 12 9 18',
  left: '15 6 9 12 15 18',
};
