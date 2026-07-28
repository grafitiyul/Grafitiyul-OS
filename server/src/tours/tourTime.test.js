import test from 'node:test';
import assert from 'node:assert/strict';
import { tourDurationHours, tourStartMs, tourEndMs, hasTourEnded, DEFAULT_DURATION_HOURS } from './tourTime.js';

const base = { date: '2026-07-20', startTime: '10:00' };            // summer, UTC+3
const winter = { date: '2026-12-20', startTime: '10:00' };          // winter, UTC+2

test('start is the Israel wall clock, not the server timezone', () => {
  assert.equal(tourStartMs(base), Date.parse('2026-07-20T07:00:00Z'));
  assert.equal(tourStartMs(winter), Date.parse('2026-12-20T08:00:00Z'));
});

test('duration precedence: open-tour override → variant → platform default', () => {
  assert.equal(tourDurationHours({ productVariant: { durationHours: 3 } }), 3);
  assert.equal(tourDurationHours({
    productVariant: { durationHours: 3 },
    openTourTemplate: { durationHoursOverride: 4.5 },
  }), 4.5);
  assert.equal(tourDurationHours({}), DEFAULT_DURATION_HOURS);
  // A zero/negative/garbage duration is not a duration.
  assert.equal(tourDurationHours({ productVariant: { durationHours: 0 } }), DEFAULT_DURATION_HOURS);
  assert.equal(tourDurationHours({ productVariant: { durationHours: -1 } }), DEFAULT_DURATION_HOURS);
});

test('end = start + duration, and an open-tour override moves it', () => {
  const tour = { ...base, productVariant: { durationHours: 3 } };
  assert.equal(tourEndMs(tour), tourStartMs(tour) + 3 * 3_600_000);
  const overridden = { ...tour, openTourTemplate: { durationHoursOverride: 5 } };
  assert.equal(tourEndMs(overridden), tourStartMs(tour) + 5 * 3_600_000);
});

test('a fractional duration is honoured to the minute', () => {
  const tour = { ...base, productVariant: { durationHours: 1.5 } };
  assert.equal(tourEndMs(tour), tourStartMs(tour) + 90 * 60_000);
});

test('an undated tour has no start, no end and has not ended', () => {
  assert.equal(tourStartMs({ date: null }), null);
  assert.equal(tourEndMs({ date: null }), null);
  assert.equal(hasTourEnded({ date: null }), false);
});

test('hasTourEnded flips exactly at the end instant', () => {
  const tour = { ...base, productVariant: { durationHours: 2 } };
  const end = tourEndMs(tour);
  assert.equal(hasTourEnded(tour, end - 1), false);
  assert.equal(hasTourEnded(tour, end), true);
});

test('a tour with no start time runs from midnight', () => {
  assert.equal(tourStartMs({ date: '2026-07-20', startTime: null }), Date.parse('2026-07-19T21:00:00Z'));
});
