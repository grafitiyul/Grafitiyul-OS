import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISRAEL_TZ, israelToday, isValidDate, addDays, weekdayOf, startOfWeek, endOfWeek,
  compareDates, dateRangeBounds, dayBounds, startOfDayUtc, midnightAfterMs,
} from './israelDate.js';

// businessToday/midnightAfterMs behaviour is additionally pinned by
// tours/completion.test.js, and addDays/weekdayOf by tours/slotGeneration.test.js
// — both now re-export from here, so those suites also guard this module.

test('ISRAEL_TZ', () => assert.equal(ISRAEL_TZ, 'Asia/Jerusalem'));

test('israelToday renders the Israel calendar date, not the server one', () => {
  // July = UTC+3. 22:30Z is already tomorrow in Tel Aviv.
  assert.equal(israelToday(Date.parse('2026-07-14T22:30:00Z')), '2026-07-15');
  assert.equal(israelToday(Date.parse('2026-07-14T20:30:00Z')), '2026-07-14');
  // January = UTC+2. 22:30Z is still today; 23:30Z is tomorrow.
  assert.equal(israelToday(Date.parse('2026-01-14T21:30:00Z')), '2026-01-14');
  assert.equal(israelToday(Date.parse('2026-01-14T22:30:00Z')), '2026-01-15');
});

test('isValidDate rejects impossible dates JS would silently roll over', () => {
  assert.ok(isValidDate('2026-07-15'));
  assert.ok(isValidDate('2024-02-29'), 'real leap day');
  assert.ok(!isValidDate('2026-02-30'), 'JS would roll this to Mar 2');
  assert.ok(!isValidDate('2026-02-31'));
  assert.ok(!isValidDate('2025-02-29'), 'not a leap year');
  assert.ok(!isValidDate('2026-13-01'));
  for (const bad of ['', '2026-7-15', '15/07/2026', 'today', null, undefined, 20260715, {}]) {
    assert.ok(!isValidDate(bad), `${JSON.stringify(bad)} must be invalid`);
  }
});

test('addDays crosses months, years, and leap days', () => {
  assert.equal(addDays('2026-07-15', 1), '2026-07-16');
  assert.equal(addDays('2026-07-15', -1), '2026-07-14');
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29', 'leap year');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01', 'non-leap year');
  assert.equal(addDays('2026-07-15', 0), '2026-07-15');
});

test('addDays is DST-proof (UTC-anchored, so a clock shift cannot move a date)', () => {
  // Israel DST starts 2026-03-27 and ends 2026-10-25. Stepping across either
  // boundary must advance exactly one calendar day.
  assert.equal(addDays('2026-03-26', 1), '2026-03-27');
  assert.equal(addDays('2026-03-27', 1), '2026-03-28');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test('weekdayOf uses 0=Sunday', () => {
  assert.equal(weekdayOf('2026-07-12'), 0); // Sunday
  assert.equal(weekdayOf('2026-07-18'), 6); // Saturday
});

test('weeks run Sunday..Saturday', () => {
  for (let i = 0; i < 7; i++) {
    const day = addDays('2026-07-12', i);
    assert.equal(startOfWeek(day), '2026-07-12', `startOfWeek(${day})`);
    assert.equal(endOfWeek(day), '2026-07-18', `endOfWeek(${day})`);
  }
  // A Sunday is its own week start; a Saturday its own week end.
  assert.equal(startOfWeek('2026-07-12'), '2026-07-12');
  assert.equal(endOfWeek('2026-07-18'), '2026-07-18');
  // The week is exactly 7 days.
  assert.equal(addDays(startOfWeek('2026-07-15'), 6), endOfWeek('2026-07-15'));
});

test('compareDates orders lexicographically, which is correct for YYYY-MM-DD', () => {
  assert.equal(compareDates('2026-01-01', '2026-01-02'), -1);
  assert.equal(compareDates('2026-01-02', '2026-01-01'), 1);
  assert.equal(compareDates('2026-01-01', '2026-01-01'), 0);
  assert.equal(compareDates('2026-09-30', '2026-10-01'), -1, 'month rollover');
});

test('dayBounds is a half-open UTC range covering exactly one calendar date', () => {
  const b = dayBounds('2026-07-15');
  assert.equal(b.gte.toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(b.lt.toISOString(), '2026-07-16T00:00:00.000Z');
});

test('dayBounds matches how dueDate is actually stored (UTC-midnight anchored)', () => {
  // Production stores dueDate as the calendar date at exactly T00:00:00.000Z,
  // with the clock in the separate dueTime string. A task due 2026-07-15 must
  // fall inside that day's bounds and outside its neighbours'.
  const due = new Date('2026-07-15T00:00:00.000Z');
  const today = dayBounds('2026-07-15');
  assert.ok(due >= today.gte && due < today.lt, 'inside its own day');
  const yesterday = dayBounds('2026-07-14');
  assert.ok(!(due >= yesterday.gte && due < yesterday.lt), 'not in the previous day');
  const tomorrow = dayBounds('2026-07-16');
  assert.ok(!(due >= tomorrow.gte && due < tomorrow.lt), 'not in the next day');
});

test('adjacent day bounds abut exactly — no gap, no overlap', () => {
  assert.equal(dayBounds('2026-07-15').lt.getTime(), dayBounds('2026-07-16').gte.getTime());
});

test('dateRangeBounds is inclusive of both endpoints', () => {
  const b = dateRangeBounds('2026-07-01', '2026-07-31');
  assert.equal(b.gte.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(b.lt.toISOString(), '2026-08-01T00:00:00.000Z', 'the last day is included');
  const last = new Date('2026-07-31T00:00:00.000Z');
  assert.ok(last >= b.gte && last < b.lt, 'a task due on the final day is inside the range');
});

test('startOfDayUtc', () => {
  assert.equal(startOfDayUtc('2026-07-15').toISOString(), '2026-07-15T00:00:00.000Z');
});

test('midnightAfterMs is DST-correct in both directions', () => {
  assert.equal(midnightAfterMs('2026-01-15'), Date.parse('2026-01-15T22:00:00Z'), 'winter UTC+2');
  assert.equal(midnightAfterMs('2026-07-15'), Date.parse('2026-07-15T21:00:00Z'), 'summer UTC+3');
  assert.ok(Number.isNaN(midnightAfterMs('')), 'garbage never locks anything');
});
