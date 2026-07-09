import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekdayOf, israelToday } from './slotGeneration.js';

// Date math the slot generator relies on: string-space "YYYY-MM-DD"
// arithmetic (no timezone drift) and the 0=Sunday weekday convention that
// TourScheduleRule.weekday stores.

test('addDays crosses month and year boundaries in date-string space', () => {
  assert.equal(addDays('2026-07-30', 3), '2026-08-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-07-09', 0), '2026-07-09');
  assert.equal(addDays('2026-07-09', 60), '2026-09-07');
});

test('weekdayOf follows the 0=Sunday convention', () => {
  assert.equal(weekdayOf('2026-07-09'), 4); // Thursday
  assert.equal(weekdayOf('2026-07-11'), 6); // Saturday
  assert.equal(weekdayOf('2026-07-12'), 0); // Sunday
});

test('every Thursday inside a 60-day horizon is hit exactly once', () => {
  const start = '2026-07-09'; // a Thursday
  const target = addDays(start, 60);
  const thursdays = [];
  for (let d = start; d <= target; d = addDays(d, 1)) {
    if (weekdayOf(d) === 4) thursdays.push(d);
  }
  assert.equal(thursdays.length, 9);
  assert.equal(thursdays[0], '2026-07-09');
  assert.equal(new Set(thursdays).size, thursdays.length);
});

test('israelToday returns a YYYY-MM-DD string', () => {
  assert.match(israelToday(), /^\d{4}-\d{2}-\d{2}$/);
});
