import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  addMonths,
  startOfWeek,
  startOfMonth,
  monthGrid,
  weekdayOf,
  monthTitle,
  timeToMinutes,
  endTimeOf,
  msUntilNextIsraelMidnight,
} from './dates.js';

// Calendar navigation math — the helpers behind navigate(dir):
//   month mode: addMonths(startOfMonth(anchor), ±1)
//   week mode:  addDays(anchor, ±7)
//   day mode:   addDays(anchor, ±1)
// Direction semantics are asserted here (previous = -1 goes back in time,
// next = +1 goes forward) so an icon/handler mix-up can never silently pass.

test('addDays: next/previous day, including month and year boundaries', () => {
  assert.equal(addDays('2026-07-15', 1), '2026-07-16');
  assert.equal(addDays('2026-07-15', -1), '2026-07-14');
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-08-01', -1), '2026-07-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  // Leap year.
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('addDays ±7 (week navigation) crosses month boundaries correctly', () => {
  assert.equal(addDays('2026-07-28', 7), '2026-08-04');
  assert.equal(addDays('2026-08-04', -7), '2026-07-28');
});

test('addMonths: next/previous month, including year boundaries', () => {
  assert.equal(addMonths('2026-07-01', 1), '2026-08-01');
  assert.equal(addMonths('2026-07-01', -1), '2026-06-01');
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(addMonths('2026-01-01', -13), '2024-12-01');
});

test('previous then next is always identity (no drift)', () => {
  for (const d of ['2026-01-01', '2026-07-15', '2026-12-31']) {
    assert.equal(addDays(addDays(d, 1), -1), d);
    assert.equal(addDays(addDays(d, 7), -7), d);
  }
  for (const m of ['2026-01-01', '2026-12-01']) {
    assert.equal(addMonths(addMonths(m, 1), -1), m);
  }
});

test('startOfWeek: Israel weeks start on Sunday', () => {
  // 2026-07-15 is a Wednesday → week starts Sunday 2026-07-12.
  assert.equal(weekdayOf('2026-07-15'), 3);
  assert.equal(startOfWeek('2026-07-15'), '2026-07-12');
  assert.equal(startOfWeek('2026-07-12'), '2026-07-12'); // Sunday is its own start
  assert.equal(startOfWeek('2026-08-01'), '2026-07-26'); // crosses a month back
});

test('startOfMonth + monthTitle', () => {
  assert.equal(startOfMonth('2026-07-15'), '2026-07-01');
  assert.equal(monthTitle('2026-07-01'), 'יולי 2026');
  assert.equal(monthTitle('2026-01-01'), 'ינואר 2026');
});

test('monthGrid: whole Sunday-first weeks covering the month', () => {
  const weeks = monthGrid('2026-07-01');
  // Every week has exactly 7 days, each starting on Sunday.
  for (const week of weeks) {
    assert.equal(week.length, 7);
    assert.equal(weekdayOf(week[0]), 0);
  }
  // The grid covers July 1 through July 31 inclusive.
  const flat = weeks.flat();
  assert.ok(flat.includes('2026-07-01'));
  assert.ok(flat.includes('2026-07-31'));
  // First cell is on/before the 1st, last cell on/after the 31st.
  assert.ok(flat[0] <= '2026-07-01');
  assert.ok(flat[flat.length - 1] >= '2026-07-31');
});

test('time helpers: minutes conversion and event end label', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.ok(Number.isNaN(timeToMinutes(null)));
  assert.equal(endTimeOf('10:00', 2.5), '12:30');
  assert.equal(endTimeOf('23:30', 3), '23:59'); // clamped to end of day
  assert.equal(endTimeOf(null, 2), null);
});

// msUntilNextIsraelMidnight — Israel wall-clock countdown to 00:00 IL. Verified
// timezone-correctly: now + result must LAND on IL midnight (00:00:00),
// regardless of the browser's own timezone or DST offset. Deterministic given
// a fixed `now`; non-DST-transition dates used on purpose.
const IL_HMS = (d) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(d);

test('msUntilNextIsraelMidnight lands exactly on the next IL midnight (summer, IDT +3)', () => {
  // 2026-07-12T21:30:00Z = 00:30 IDT on 2026-07-13.
  const now = new Date('2026-07-12T21:30:00Z');
  const ms = msUntilNextIsraelMidnight(now);
  assert.ok(ms > 0 && ms <= 24 * 3600 * 1000);
  assert.equal(IL_HMS(new Date(now.getTime() + ms)), '00:00:00');
  // 00:30 → next midnight is 23h30m away.
  assert.equal(Math.round(ms / 1000), 23 * 3600 + 30 * 60);
});

test('msUntilNextIsraelMidnight lands on midnight (winter, IST +2)', () => {
  // 2026-01-12T21:30:00Z = 23:30 IST on 2026-01-12 → 30m to midnight.
  const now = new Date('2026-01-12T21:30:00Z');
  const ms = msUntilNextIsraelMidnight(now);
  assert.equal(IL_HMS(new Date(now.getTime() + ms)), '00:00:00');
  assert.equal(Math.round(ms / 1000), 30 * 60);
});

test('msUntilNextIsraelMidnight just after midnight → ~24h, never negative', () => {
  // 2026-07-12T21:00:01Z = 00:00:01 IDT → ~24h minus 1s to the following midnight.
  const now = new Date('2026-07-12T21:00:01Z');
  const ms = msUntilNextIsraelMidnight(now);
  assert.ok(ms > 0);
  assert.equal(IL_HMS(new Date(now.getTime() + ms)), '00:00:00');
  assert.equal(Math.round(ms / 1000), 24 * 3600 - 1);
});

test('msUntilNextIsraelMidnight is always at least 1s (exactly at midnight → full day)', () => {
  const now = new Date('2026-07-11T21:00:00Z'); // 00:00:00 IDT
  const ms = msUntilNextIsraelMidnight(now);
  assert.ok(ms >= 1000);
  assert.equal(Math.round(ms / 1000), 24 * 3600);
});
