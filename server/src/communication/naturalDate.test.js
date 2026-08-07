import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalDateLabel, shortDayMonth } from './naturalDate.js';

// The clock is pinned to a real Israel afternoon so "today" is unambiguous:
// 2026-08-07 15:00 Israel time (UTC+3 in August) = 12:00Z.
const NOW = Date.parse('2026-08-07T12:00:00Z');

test('today / yesterday / tomorrow in both languages', () => {
  assert.equal(naturalDateLabel('2026-08-07', 'he', NOW), 'היום');
  assert.equal(naturalDateLabel('2026-08-07', 'en', NOW), 'today');
  assert.equal(naturalDateLabel('2026-08-06', 'he', NOW), 'אתמול');
  assert.equal(naturalDateLabel('2026-08-06', 'en', NOW), 'yesterday');
  assert.equal(naturalDateLabel('2026-08-08', 'he', NOW), 'מחר');
  assert.equal(naturalDateLabel('2026-08-08', 'en', NOW), 'tomorrow');
});

test('two to four days back reads as the weekday name', () => {
  // 2026-08-05 is a Wednesday, 08-04 Tuesday, 08-03 Monday.
  assert.equal(naturalDateLabel('2026-08-05', 'he', NOW), 'יום רביעי');
  assert.equal(naturalDateLabel('2026-08-04', 'he', NOW), 'יום שלישי');
  assert.equal(naturalDateLabel('2026-08-03', 'he', NOW), 'יום שני');
  assert.equal(naturalDateLabel('2026-08-05', 'en', NOW), 'Wednesday');
  assert.equal(naturalDateLabel('2026-08-03', 'en', NOW), 'Monday');
});

test('older than four days falls back to a short day.month date', () => {
  assert.equal(naturalDateLabel('2026-08-02', 'he', NOW), '2.8');
  assert.equal(naturalDateLabel('2026-07-03', 'he', NOW), '3.7');
  assert.equal(naturalDateLabel('2026-07-14', 'en', NOW), '14.7');
  // Never a technical full date.
  for (const lang of ['he', 'en']) {
    const out = naturalDateLabel('2026-07-03', lang, NOW);
    assert.ok(!out.includes('/'), 'must not use slashes');
    assert.ok(!out.includes('2026'), 'must not include the year');
  }
});

test('the Israel calendar decides which day "today" is, not UTC', () => {
  // 2026-08-07T21:30Z is already 08-08 00:30 in Israel (UTC+3 in August).
  const lateNight = Date.parse('2026-08-07T21:30:00Z');
  assert.equal(naturalDateLabel('2026-08-08', 'he', lateNight), 'היום');
  assert.equal(naturalDateLabel('2026-08-07', 'he', lateNight), 'אתמול');
});

test('a missing or impossible date is reported as missing, never invented', () => {
  assert.equal(naturalDateLabel(null, 'he', NOW), null);
  assert.equal(naturalDateLabel('', 'he', NOW), null);
  assert.equal(naturalDateLabel('07/08/2026', 'he', NOW), null);
  assert.equal(naturalDateLabel('2026-02-30', 'he', NOW), null);
});

test('shortDayMonth drops leading zeros and the year', () => {
  assert.equal(shortDayMonth('2026-07-03'), '3.7');
  assert.equal(shortDayMonth('2026-12-25'), '25.12');
  assert.equal(shortDayMonth('nope'), null);
});
