import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COORDINATION_LEAD_DAYS, tourStartMs, coordinationDeadlineMs, isOnTime, latenessLabel,
  coordinationStatus,
} from './coordination.js';
import { israelLocalToMs } from '../communication/windows.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (date, minutes) => israelLocalToMs(date, minutes);

test('the deadline is exactly 2 days before the effective tour start (Israel time)', () => {
  const tour = { date: '2026-09-20', startTime: '10:00' };
  assert.equal(COORDINATION_LEAD_DAYS, 2);
  assert.equal(tourStartMs(tour), at('2026-09-20', 10 * 60));
  assert.equal(coordinationDeadlineMs(tour), at('2026-09-20', 10 * 60) - 2 * DAY);
});

test('the deadline is DST-correct across the Israel autumn transition', () => {
  // Israel leaves DST on 2026-10-25. A tour on 2026-10-26 10:00 (winter, UTC+2)
  // has its deadline 48 REAL hours earlier — which lands back in summer time
  // (UTC+3), i.e. 11:00 local. A naive wall-clock "minus 2 days" would give
  // 10:00 and be an hour off.
  const tour = { date: '2026-10-26', startTime: '10:00' };
  const deadline = coordinationDeadlineMs(tour);
  assert.equal(deadline, tourStartMs(tour) - 2 * DAY);
  assert.equal(deadline, at('2026-10-24', 11 * 60));
  assert.notEqual(deadline, at('2026-10-24', 10 * 60));
});

test('a tour with no datetime has no decidable deadline', () => {
  assert.equal(tourStartMs({ date: null, startTime: null }), null);
  assert.equal(coordinationDeadlineMs({ date: null }), null);
  assert.equal(isOnTime(Date.now(), null), null);
});

test('a tour without a start time falls back to midnight, not to "no deadline"', () => {
  assert.equal(tourStartMs({ date: '2026-09-20', startTime: null }), at('2026-09-20', 0));
});

test('completing exactly at the deadline is ON TIME (inclusive)', () => {
  const deadline = coordinationDeadlineMs({ date: '2026-09-20', startTime: '10:00' });
  assert.equal(isOnTime(deadline, deadline), true);
  assert.equal(isOnTime(deadline - 1, deadline), true);
  assert.equal(isOnTime(deadline + 1, deadline), false);
});

test('lateness is measured from the deadline and reads naturally in Hebrew', () => {
  const d = 1_000_000_000;
  assert.equal(latenessLabel(d, d), null);
  assert.equal(latenessLabel(d + 30 * 60_000, d), '30 דקות');
  assert.equal(latenessLabel(d + 60 * 60_000, d), 'שעה');
  assert.equal(latenessLabel(d + 2 * 3_600_000, d), 'שעתיים');
  assert.equal(latenessLabel(d + 5 * 3_600_000, d), '5 שעות');
  assert.equal(latenessLabel(d + DAY, d), 'יום');
  assert.equal(latenessLabel(d + DAY + 5 * 3_600_000, d), 'יום ו-5 שעות');
  assert.equal(latenessLabel(d + 2 * DAY, d), 'יומיים');
  assert.equal(latenessLabel(d + 3 * DAY + 2 * 3_600_000, d), '3 ימים ושעתיים');
});

test('monitoring status: submitted → done (even late), else overdue vs open', () => {
  const deadline = 1_000_000_000;
  assert.equal(coordinationStatus({ submittedAtMs: deadline - 1, deadlineMs: deadline, nowMs: deadline + DAY }), 'done');
  // A LATE submission is still done — the monitor reports reality, not blame.
  assert.equal(coordinationStatus({ submittedAtMs: deadline + DAY, deadlineMs: deadline, nowMs: deadline + 2 * DAY }), 'done');
  assert.equal(coordinationStatus({ submittedAtMs: null, deadlineMs: deadline, nowMs: deadline + 1 }), 'overdue');
  assert.equal(coordinationStatus({ submittedAtMs: null, deadlineMs: deadline, nowMs: deadline - 1 }), 'open');
  // Undecidable deadline never reads as overdue.
  assert.equal(coordinationStatus({ submittedAtMs: null, deadlineMs: null, nowMs: Date.now() }), 'open');
});
