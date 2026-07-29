import test from 'node:test';
import assert from 'node:assert/strict';
import { readIsoDate } from './tourNormalize.js';

// The defect this guards: Airtable returns {"error":"#ERROR!"} for a failed
// formula field. String(that).slice(0,10) === "[object Ob" — truthy, so it
// passed the old presence check, and "[" (0x5B) sorts above every digit, so it
// compared as LATER than any real date and entered the future-tour population.

test('a structured Airtable error is REJECTED, never coerced', () => {
  const r = readIsoDate({ error: '#ERROR!' });
  assert.equal(r.date, null);
  assert.equal(r.reason, 'source_error:#ERROR!');
});

test('the exact historical failure string can no longer be produced', () => {
  for (const bad of [{ error: '#ERROR!' }, {}, [{ error: '#ERROR!' }], { specialValue: 'NaN' }]) {
    const r = readIsoDate(bad);
    assert.equal(r.date, null, `${JSON.stringify(bad)} must not yield a date`);
    assert.notEqual(r.date, '[object Ob');
  }
});

test('a rejected date can never sort as "future"', () => {
  // The property that actually caused the incident.
  const r = readIsoDate({ error: '#ERROR!' });
  assert.equal(r.date, null);
  assert.equal(r.date >= '2026-08-01', false, 'null never compares as a later date');
});

test('a real ISO date passes through, including from an array field', () => {
  assert.deepEqual(readIsoDate('2026-08-10'), { date: '2026-08-10', reason: null });
  assert.deepEqual(readIsoDate(['2026-08-10']), { date: '2026-08-10', reason: null });
  // Airtable often returns a full timestamp — the date part is taken.
  assert.equal(readIsoDate('2026-08-10T07:00:00.000Z').date, '2026-08-10');
});

test('empty and missing values are reported as empty, not as errors', () => {
  for (const v of [null, undefined, '', []]) assert.equal(readIsoDate(v).reason, 'empty');
});

test('a non-ISO string is rejected with the offending value in the reason', () => {
  const r = readIsoDate('10/08/2026');
  assert.equal(r.date, null);
  assert.match(r.reason, /^not_iso:10\/08\/2026/);
});

test('an impossible calendar date is rejected even though it matches the shape', () => {
  assert.equal(readIsoDate('2026-02-30').date, null);
  assert.match(readIsoDate('2026-02-30').reason, /not_a_calendar_date/);
  assert.equal(readIsoDate('2026-13-01').date, null);
  // …and a real leap day is kept.
  assert.equal(readIsoDate('2028-02-29').date, '2028-02-29');
});

test('the reason is always a short, loggable string', () => {
  const long = 'x'.repeat(500);
  assert.ok(readIsoDate(long).reason.length < 60);
});
