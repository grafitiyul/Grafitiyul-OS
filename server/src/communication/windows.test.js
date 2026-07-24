import test from 'node:test';
import assert from 'node:assert/strict';
import { israelParts, israelLocalToMs, evaluateAt, nextAllowedAt, parseHHMM } from './windows.js';
import { applyOffset, computeIntendedAt } from './timing.js';

// Default customer window: Sun–Thu 08:30–20:00, Fri 08:30–14:00, Sat blocked.
const WINDOW = {
  id: 'w1',
  name: 'לקוחות',
  rules: [
    { days: [0, 1, 2, 3, 4], start: '08:30', end: '20:00' },
    { days: [5], start: '08:30', end: '14:00' },
  ],
};
const policy = (over = {}) => ({ windowEnabled: true, window: WINDOW, exceptions: [], ...over });

// 2026-07-22 is a Wednesday (IDT, UTC+3).
const wed2330 = israelLocalToMs('2026-07-22', 23 * 60 + 30);
const wed1000 = israelLocalToMs('2026-07-22', 10 * 60);
const sat1200 = israelLocalToMs('2026-07-25', 12 * 60);

test('israelLocalToMs round-trips through israelParts (DST)', () => {
  const p = israelParts(wed2330);
  assert.equal(p.date, '2026-07-22');
  assert.equal(p.minutes, 23 * 60 + 30);
  assert.equal(p.weekday, 3);
  // Winter (standard time, UTC+2) round-trip too.
  const winter = israelLocalToMs('2026-01-15', 9 * 60);
  const wp = israelParts(winter);
  assert.equal(wp.date, '2026-01-15');
  assert.equal(wp.minutes, 9 * 60);
});

test('inside the weekly window → allowed', () => {
  assert.equal(evaluateAt(policy(), wed1000).allowed, true);
});

test('23:30 → waiting; next allowed is 08:30 next morning', () => {
  const gate = evaluateAt(policy(), wed2330);
  assert.equal(gate.allowed, false);
  const next = nextAllowedAt(policy(), wed2330);
  const p = israelParts(next);
  assert.equal(p.date, '2026-07-23');
  assert.equal(p.minutes, 8 * 60 + 30);
});

test('Saturday blocked by rules; next allowed Sunday 08:30', () => {
  assert.equal(evaluateAt(policy(), sat1200).allowed, false);
  const p = israelParts(nextAllowedAt(policy(), sat1200));
  assert.equal(p.date, '2026-07-26');
  assert.equal(p.weekday, 0);
  assert.equal(p.minutes, 8 * 60 + 30);
});

test('message NOT subject to a window sends any time — unless globally blocked', () => {
  const free = { windowEnabled: false, window: null, exceptions: [] };
  assert.equal(evaluateAt(free, wed2330).allowed, true);
  const blocked = {
    windowEnabled: false, window: null,
    exceptions: [{ windowId: null, kind: 'block', label: 'יום כיפור', dateFrom: '2026-07-22', dateTo: '2026-07-22', active: true }],
  };
  assert.equal(evaluateAt(blocked, wed2330).allowed, false);
  assert.match(evaluateAt(blocked, wed2330).reason, /יום כיפור/);
  // Next allowed = the following day.
  const p = israelParts(nextAllowedAt(blocked, wed2330));
  assert.equal(p.date, '2026-07-23');
});

test('allow exception opens outside the weekly rules', () => {
  const p = policy({
    exceptions: [{ windowId: 'w1', kind: 'allow', label: 'ביטול דחוף', dateFrom: '2026-07-22', active: true }],
  });
  assert.equal(evaluateAt(p, wed2330).allowed, true);
  assert.match(evaluateAt(p, wed2330).reason, /ביטול דחוף/);
});

test('block beats allow (deterministic precedence)', () => {
  const p = policy({
    exceptions: [
      { windowId: null, kind: 'allow', label: 'אישור', dateFrom: '2026-07-22', active: true },
      { windowId: null, kind: 'block', label: 'חסימה', dateFrom: '2026-07-22', active: true },
    ],
  });
  assert.equal(evaluateAt(p, wed1000).allowed, false);
  assert.match(evaluateAt(p, wed1000).reason, /חסימה/);
});

test('window-scoped exception does not leak to other windows', () => {
  const p = {
    windowEnabled: true,
    window: { id: 'OTHER', name: 'אחר', rules: WINDOW.rules },
    exceptions: [{ windowId: 'w1', kind: 'block', label: 'רק w1', dateFrom: '2026-07-22', active: true }],
  };
  assert.equal(evaluateAt(p, wed1000).allowed, true);
});

test('inactive exceptions are ignored', () => {
  const p = policy({
    exceptions: [{ windowId: null, kind: 'block', label: 'כבוי', dateFrom: '2026-07-22', active: false }],
  });
  assert.equal(evaluateAt(p, wed1000).allowed, true);
});

test('timed block: window reopens after endTime', () => {
  const p = policy({
    exceptions: [{ windowId: null, kind: 'block', label: 'תחזוקה', dateFrom: '2026-07-22', startTime: '09:00', endTime: '11:00', active: true }],
  });
  assert.equal(evaluateAt(p, wed1000).allowed, false);
  const next = israelParts(nextAllowedAt(p, wed1000));
  assert.equal(next.date, '2026-07-22');
  assert.equal(next.minutes, 11 * 60);
});

test('parseHHMM validates', () => {
  assert.equal(parseHHMM('08:30'), 510);
  assert.equal(parseHHMM('25:00'), null);
  assert.equal(parseHHMM('x'), null);
});

// ── timing (anchor + offset) ─────────────────────────────────────────────────

test('immediate keeps the anchor instant', () => {
  assert.equal(applyOffset(wed1000, { timingMode: 'immediate' }), wed1000);
});

test('minutes/hours are exact arithmetic', () => {
  assert.equal(applyOffset(wed1000, { timingMode: 'after', timingAmount: 90, timingUnit: 'minutes' }), wed1000 + 90 * 60_000);
  assert.equal(applyOffset(wed1000, { timingMode: 'before', timingAmount: 2, timingUnit: 'hours' }), wed1000 - 2 * 3_600_000);
});

test('days are calendar days preserving Israel wall-clock across DST', () => {
  // 2026-10-25 is the DST fall-back date in Israel; 3 days before 2026-10-27
  // 09:00 must still land at 09:00 local.
  const anchor = israelLocalToMs('2026-10-27', 9 * 60);
  const before3d = applyOffset(anchor, { timingMode: 'before', timingAmount: 3, timingUnit: 'days' });
  const p = israelParts(before3d);
  assert.equal(p.date, '2026-10-24');
  assert.equal(p.minutes, 9 * 60);
});

test('weeks = 7 calendar days', () => {
  const p = israelParts(applyOffset(wed1000, { timingMode: 'after', timingAmount: 2, timingUnit: 'weeks' }));
  assert.equal(p.date, '2026-08-05');
  assert.equal(p.minutes, 10 * 60);
});

test('months clamp to end of target month', () => {
  const jan31 = israelLocalToMs('2026-01-31', 12 * 60);
  const plus1m = israelParts(applyOffset(jan31, { timingMode: 'after', timingAmount: 1, timingUnit: 'months' }));
  assert.equal(plus1m.date, '2026-02-28');
  assert.equal(plus1m.minutes, 12 * 60);
});

test('tour_datetime anchor: before offset lands ahead of the tour', () => {
  const event = { anchorType: 'tour_datetime', timingMode: 'before', timingAmount: 3, timingUnit: 'days' };
  const ctx = { tour: { date: '2026-08-10', startTime: '09:30' } };
  const intended = computeIntendedAt(event, ctx, Date.parse('2026-07-01T00:00:00Z'));
  const p = israelParts(intended);
  assert.equal(p.date, '2026-08-07');
  assert.equal(p.minutes, 9 * 60 + 30);
});

test('tour_datetime anchor without a scheduled tour → null (waiting_dependency)', () => {
  const event = { anchorType: 'tour_datetime', timingMode: 'immediate' };
  assert.equal(computeIntendedAt(event, { tour: null }, Date.now()), null);
});
