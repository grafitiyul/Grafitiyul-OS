import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSendableDay, blockReason, moveEarlierToSendableDay, sendDateForLeadDays, SHABBAT_WEEKDAY,
} from './businessCalendar.js';
import { weekdayOf } from './israelDate.js';

// 2026-08-01 is a Saturday; 2026-07-31 a Friday; 2026-07-30 a Thursday.
const SAT = '2026-08-01';
const FRI = '2026-07-31';
const THU = '2026-07-30';
const WED = '2026-07-29';

test('the weekday anchors this suite relies on are what we think they are', () => {
  assert.equal(weekdayOf(SAT), SHABBAT_WEEKDAY);
  assert.equal(weekdayOf(FRI), 5);
  assert.equal(weekdayOf(THU), 4);
});

test('Shabbat is never a send day; Friday IS a normal send day', () => {
  assert.equal(isSendableDay(SAT), false);
  assert.equal(isSendableDay(FRI), true);
  assert.equal(isSendableDay(THU), true);
});

test('a holiday and a holiday eve both block the day', () => {
  const holidays = new Map([
    [THU, { type: 'chag', nameHe: 'סוכות' }],
    [WED, { type: 'erev_chag', nameHe: 'סוכות' }],
  ]);
  assert.equal(isSendableDay(THU, holidays), false);
  assert.equal(isSendableDay(WED, holidays), false);
  assert.equal(blockReason(THU, holidays), 'סוכות');
  assert.equal(blockReason(WED, holidays), 'ערב סוכות');
  assert.equal(blockReason(SAT), 'שבת');
  assert.equal(blockReason(FRI), null);
});

test('holiday eve beats Friday — a Friday that is also a holiday eve moves', () => {
  const holidays = new Map([[FRI, { type: 'erev_chag', nameHe: 'ראש השנה' }]]);
  assert.equal(isSendableDay(FRI), true, 'plain Friday sends');
  assert.equal(isSendableDay(FRI, holidays), false, 'holiday-eve Friday does not');
  assert.equal(moveEarlierToSendableDay(FRI, holidays).date, THU);
});

test('the walk steps back one day at a time until a clear day', () => {
  // Sat blocked → Fri is clear.
  assert.deepEqual(
    { ...moveEarlierToSendableDay(SAT), reasons: undefined },
    { date: FRI, movedDays: 1, reasons: undefined },
  );
  // Sat + a holiday-eve Friday + a holiday Thursday → lands on Wednesday.
  const holidays = new Map([
    [FRI, { type: 'erev_chag', nameHe: 'יום כיפור' }],
    [THU, { type: 'chag', nameHe: 'משהו' }],
  ]);
  const r = moveEarlierToSendableDay(SAT, holidays);
  assert.equal(r.date, WED);
  assert.equal(r.movedDays, 3);
  assert.deepEqual(r.reasons.map((x) => x.reason), ['שבת', 'ערב יום כיפור', 'משהו']);
});

test('an already-clear date is returned untouched', () => {
  const r = moveEarlierToSendableDay(THU);
  assert.equal(r.date, THU);
  assert.equal(r.movedDays, 0);
  assert.deepEqual(r.reasons, []);
});

test('the lead-time rule: two days before the tour, then walk earlier', () => {
  // A Monday tour → D-2 is Saturday → sends Friday.
  const MON = '2026-08-03';
  assert.equal(weekdayOf(MON), 1);
  assert.equal(sendDateForLeadDays(MON, 2).date, FRI);
  // A Thursday tour → D-2 is Tuesday, a clear day: no movement.
  assert.equal(sendDateForLeadDays('2026-08-06', 2).date, '2026-08-04');
});

test('the walk is bounded and never swallows the message', () => {
  // An absurd 20 blocked days in a row still returns a date.
  const holidays = new Map();
  let d = SAT;
  for (let i = 0; i < 20; i++) { holidays.set(d, { type: 'chag', nameHe: 'x' }); d = `2026-07-${String(31 - i).padStart(2, '0')}`; }
  const r = moveEarlierToSendableDay(SAT, holidays);
  assert.ok(r.date);
  assert.equal(r.exhausted, true);
});
