import test from 'node:test';
import assert from 'node:assert/strict';
import { pastYears, pastMonths, filterPastTours } from './pastFilter.js';
import { monthName } from '../format.js';

const T = (date) => ({ date });
const FEED = [T('2026-07-20'), T('2026-07-01'), T('2026-03-15'), T('2025-12-31'), T('2025-03-02')];

test('pastYears — distinct, newest first', () => {
  assert.deepEqual(pastYears(FEED), ['2026', '2025']);
  assert.deepEqual(pastYears([]), []);
});

test('pastMonths — all months, or narrowed to a year', () => {
  assert.deepEqual(pastMonths(FEED), ['03', '07', '12']);
  assert.deepEqual(pastMonths(FEED, '2025'), ['03', '12']);
  assert.deepEqual(pastMonths(FEED, '2026'), ['03', '07']);
});

test('filterPastTours — year, month, both, none', () => {
  assert.equal(filterPastTours(FEED, {}).length, 5);
  assert.equal(filterPastTours(FEED, { year: '2026' }).length, 3);
  assert.equal(filterPastTours(FEED, { month: '03' }).length, 2);
  assert.equal(filterPastTours(FEED, { year: '2025', month: '03' }).length, 1);
  assert.equal(filterPastTours(FEED, { year: '2024' }).length, 0);
});

// Month names come from the ONE portal registry and follow the guide's
// language — the filter module itself holds no words.
test('monthName — the reader language decides, one registry', () => {
  assert.equal(monthName('01', 'he'), 'ינואר');
  assert.equal(monthName('12', 'he'), 'דצמבר');
  assert.equal(monthName('01', 'en'), 'January');
  assert.equal(monthName('12', 'en'), 'December');
  // Unsupported language → the portal default, never a blank.
  assert.equal(monthName('01', 'fr'), 'ינואר');
});

test('undated rows never crash and never match a restriction', () => {
  const feed = [...FEED, T(null), T('')];
  assert.deepEqual(pastYears(feed), ['2026', '2025']);
  assert.equal(filterPastTours(feed, { year: '2026' }).length, 3);
  assert.equal(filterPastTours(feed, {}).length, 7); // unrestricted keeps them
});
