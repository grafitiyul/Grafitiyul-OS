import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow, resolveAllWindows, countScanBounds, bucketOf, WINDOWS, DEFAULT_WINDOW, isValidWindow } from './windows.js';
import { addDays, weekdayOf } from '../lib/israelDate.js';

// Anchors — verified weekdays (0=Sun … 6=Sat):
const SUN = '2026-07-12';
const THU = '2026-07-16';
const FRI = '2026-07-17';
const SAT = '2026-07-18';
const WED = '2026-07-15';

test('anchor dates really are the weekdays this file assumes', () => {
  assert.equal(weekdayOf(SUN), 0);
  assert.equal(weekdayOf(WED), 3);
  assert.equal(weekdayOf(THU), 4);
  assert.equal(weekdayOf(FRI), 5);
  assert.equal(weekdayOf(SAT), 6);
});

test('defaults and vocabulary', () => {
  assert.equal(DEFAULT_WINDOW, 'today');
  assert.deepEqual(WINDOWS, ['overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'range']);
  assert.ok(isValidWindow('today'));
  assert.ok(!isValidWindow('yesterday'));
  assert.deepEqual(resolveWindow('nonsense', { today: WED }), { ok: false, error: 'invalid_window' });
});

test('today / tomorrow cover exactly one day each', () => {
  assert.deepEqual(resolveWindow('today', { today: WED }).bounds, { from: WED, to: WED });
  assert.deepEqual(resolveWindow('tomorrow', { today: WED }).bounds, { from: THU, to: THU });
});

test('overdue is unbounded backwards, ends yesterday, and pins status=open', () => {
  const r = resolveWindow('overdue', { today: WED });
  assert.deepEqual(r.bounds, { from: null, to: '2026-07-14' });
  assert.equal(r.openOnly, true, 'overdue is meaningless for completed tasks');
  // and it is the ONLY window that touches status
  for (const w of ['today', 'tomorrow', 'this_week', 'next_week']) {
    assert.equal(resolveWindow(w, { today: WED }).openOnly, false, `${w} must not constrain status`);
  }
});

test('this_week = day-after-tomorrow .. Saturday, on a normal day', () => {
  // Sunday: today=Sun, tomorrow=Mon, so this_week is Tue..Sat
  assert.deepEqual(resolveWindow('this_week', { today: SUN }).bounds, { from: '2026-07-14', to: '2026-07-18' });
});

test('this_week is a single day (Saturday) on Thursday', () => {
  assert.deepEqual(resolveWindow('this_week', { today: THU }).bounds, { from: SAT, to: SAT });
});

test('this_week is EMPTY on Friday and Saturday — never redefined to overlap', () => {
  for (const day of [FRI, SAT]) {
    const r = resolveWindow('this_week', { today: day });
    assert.equal(r.ok, true);
    assert.equal(r.empty, true, `this_week must be empty on ${day}`);
    assert.deepEqual(r.bounds, { from: null, to: null });
  }
});

test('next_week is the next calendar week on a normal day', () => {
  // Wednesday 2026-07-15 -> next week is Sun 07-19 .. Sat 07-25
  assert.deepEqual(resolveWindow('next_week', { today: WED }).bounds, { from: '2026-07-19', to: '2026-07-25' });
});

test('SATURDAY EDGE: next_week starts Monday, because Sunday is already מחר', () => {
  // The bug this guards: a naive "next_week = Sunday..Saturday" would include
  // Sunday, which on Saturday is ALSO tomorrow -> two chips claim one day.
  const tomorrow = resolveWindow('tomorrow', { today: SAT }).bounds;
  const next = resolveWindow('next_week', { today: SAT }).bounds;
  assert.deepEqual(tomorrow, { from: '2026-07-19', to: '2026-07-19' }, 'Sunday is tomorrow');
  assert.deepEqual(next, { from: '2026-07-20', to: '2026-07-25' }, 'next_week must start Monday');
});

test('next_week is never empty, on any weekday', () => {
  for (let i = 0; i < 7; i++) {
    const day = addDays(SUN, i);
    const r = resolveWindow('next_week', { today: day });
    assert.equal(r.ok && !r.empty, true, `next_week empty on ${day}`);
  }
});

// ── THE core invariant: the chips TILE the timeline ──────────────────────────
// Every future day is claimed by exactly one chip. No gaps, no overlaps.
// This is decision #4 stated as a property rather than an example.

function windowsCovering(day, today) {
  const hits = [];
  for (const w of ['today', 'tomorrow', 'this_week', 'next_week']) {
    const r = resolveWindow(w, { today });
    if (!r.ok || r.empty) continue;
    if (day >= r.bounds.from && day <= r.bounds.to) hits.push(w);
  }
  return hits;
}

test('INVARIANT: no future day is claimed by two chips (checked on all 7 weekdays)', () => {
  for (let i = 0; i < 7; i++) {
    const today = addDays(SUN, i);
    for (let d = 0; d <= 20; d++) {
      const day = addDays(today, d);
      const hits = windowsCovering(day, today);
      assert.ok(hits.length <= 1, `today=${today} day=${day} claimed by ${hits.join(' + ')}`);
    }
  }
});

test('INVARIANT: no gap from today through the end of next week', () => {
  for (let i = 0; i < 7; i++) {
    const today = addDays(SUN, i);
    const last = countScanBounds({ today }).to;
    for (let day = today; day <= last; day = addDays(day, 1)) {
      assert.equal(windowsCovering(day, today).length, 1, `today=${today}: ${day} is covered by no chip`);
    }
  }
});

test('INVARIANT: overdue and the forward chips never intersect', () => {
  for (let i = 0; i < 7; i++) {
    const today = addDays(SUN, i);
    const overdueEnd = resolveWindow('overdue', { today }).bounds.to;
    assert.equal(overdueEnd, addDays(today, -1));
    assert.equal(windowsCovering(overdueEnd, today).length, 0, 'yesterday must not be in a forward chip');
  }
});

// ── range ───────────────────────────────────────────────────────────────────

test('range takes explicit inclusive bounds', () => {
  assert.deepEqual(
    resolveWindow('range', { today: WED, rangeFrom: '2026-01-01', rangeTo: '2026-01-31' }).bounds,
    { from: '2026-01-01', to: '2026-01-31' },
  );
  // single-day range
  assert.deepEqual(
    resolveWindow('range', { today: WED, rangeFrom: WED, rangeTo: WED }).bounds,
    { from: WED, to: WED },
  );
});

test('range rejects reversed, missing, and impossible dates', () => {
  const bad = [
    { rangeFrom: '2026-01-31', rangeTo: '2026-01-01' }, // reversed
    { rangeFrom: '2026-01-01' }, // missing to
    { rangeTo: '2026-01-01' }, // missing from
    {}, // both missing
    { rangeFrom: '2026-02-30', rangeTo: '2026-03-01' }, // not a real date
    { rangeFrom: 'today', rangeTo: 'tomorrow' },
  ];
  for (const opts of bad) {
    assert.deepEqual(resolveWindow('range', { today: WED, ...opts }), { ok: false, error: 'invalid_range' });
  }
});

// ── clock injection / IL midnight ───────────────────────────────────────────

test('the window follows Israel midnight, not UTC midnight', () => {
  // 2026-07-14T22:30:00Z is already 2026-07-15 in Israel (UTC+3 in July).
  assert.deepEqual(resolveWindow('today', { nowMs: Date.parse('2026-07-14T22:30:00Z') }).bounds, { from: '2026-07-15', to: '2026-07-15' });
  assert.deepEqual(resolveWindow('today', { nowMs: Date.parse('2026-07-14T20:30:00Z') }).bounds, { from: '2026-07-14', to: '2026-07-14' });
});

test('resolveAllWindows returns every window, omitting range without bounds', () => {
  const all = resolveAllWindows({ today: WED });
  assert.deepEqual(Object.keys(all), ['overdue', 'today', 'tomorrow', 'this_week', 'next_week']);
  const withRange = resolveAllWindows({ today: WED, rangeFrom: WED, rangeTo: WED });
  assert.ok(withRange.range.ok);
});

// ── counts scan ─────────────────────────────────────────────────────────────

test('countScanBounds spans today through the end of next week', () => {
  assert.deepEqual(countScanBounds({ today: WED }), { from: WED, to: '2026-07-25' });
  // Saturday: scan must still reach the end of next week
  assert.deepEqual(countScanBounds({ today: SAT }), { from: SAT, to: '2026-07-25' });
});

test('countScanBounds covers every forward window it must bucket', () => {
  for (let i = 0; i < 7; i++) {
    const today = addDays(SUN, i);
    const scan = countScanBounds({ today });
    for (const w of ['today', 'tomorrow', 'this_week', 'next_week']) {
      const r = resolveWindow(w, { today });
      if (!r.ok || r.empty) continue;
      assert.ok(r.bounds.from >= scan.from && r.bounds.to <= scan.to, `${w} escapes the scan on ${today}`);
    }
  }
});

test('bucketOf agrees with resolveWindow for every day in the scan', () => {
  for (let i = 0; i < 7; i++) {
    const today = addDays(SUN, i);
    const scan = countScanBounds({ today });
    for (let day = scan.from; day <= scan.to; day = addDays(day, 1)) {
      const expected = windowsCovering(day, today)[0] ?? null;
      assert.equal(bucketOf(day, { today }), expected, `today=${today} day=${day}`);
    }
  }
});

test('bucketOf returns null outside the counted windows', () => {
  assert.equal(bucketOf(addDays(WED, -1), { today: WED }), null, 'yesterday is overdue, not a forward bucket');
  assert.equal(bucketOf(addDays(WED, 60), { today: WED }), null, 'far future belongs to no chip');
});
