import test from 'node:test';
import assert from 'node:assert/strict';
import { planTemplateGeneration, addExceptionRuleId } from './openTourGeneration.js';

// The pure open-tour date planner: recurring weekday rules bounded by a validity
// window, with one-off cancel / time_override / add exceptions layered on top.
// No DB, no product resolution — just the "which occurrences, when" contract.

const HORIZON = { today: '2026-07-09', target: '2026-09-07' }; // 60 days, Thu start

test('a weekly rule hits every matching weekday in the horizon exactly once', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }], // Thursday
    exceptions: [],
  };
  const { rows, cursorPatches } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 9); // 9 Thursdays in a 60-day window
  assert.ok(rows.every((r) => r.startTime === '17:00'));
  assert.ok(rows.every((r) => r.generatedByRuleId === 'r1'));
  assert.equal(rows[0].date, '2026-07-09');
  assert.deepEqual(cursorPatches, [{ id: 'r1', generatedThrough: '2026-09-07' }]);
});

test('validFrom / validUntil clamp the generated range', () => {
  const tpl = {
    scheduleRules: [
      { id: 'r1', weekday: 4, startTime: '10:00', validFrom: '2026-07-20', validUntil: '2026-08-10' },
    ],
    exceptions: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  // Thursdays in [2026-07-20, 2026-08-10]: 23/7, 30/7, 6/8 → 3
  assert.deepEqual(rows.map((r) => r.date), ['2026-07-23', '2026-07-30', '2026-08-06']);
});

test('the generatedThrough cursor is respected (only dates beyond it)', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00', generatedThrough: '2026-08-15' }],
    exceptions: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  // First Thursday strictly after 2026-08-15 is 2026-08-20.
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-20', '2026-08-27', '2026-09-03']);
});

test('a cancel exception suppresses exactly that occurrence', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-16', type: 'cancel' }],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 8);
  assert.ok(!rows.some((r) => r.date === '2026-07-16'));
});

test('a time_override exception changes only that occurrence time', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-23', type: 'time_override', time: '20:30' }],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  const overridden = rows.find((r) => r.date === '2026-07-23');
  assert.equal(overridden.startTime, '20:30');
  assert.ok(rows.filter((r) => r.date !== '2026-07-23').every((r) => r.startTime === '17:00'));
});

test('an add exception injects an extra occurrence on a non-rule day', () => {
  const tpl = {
    scheduleRules: [{ id: 'r1', weekday: 4, startTime: '17:00' }],
    exceptions: [{ id: 'e1', date: '2026-07-14', type: 'add', time: '11:00' }], // a Tuesday
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  const extra = rows.find((r) => r.date === '2026-07-14');
  assert.ok(extra);
  assert.equal(extra.startTime, '11:00');
  assert.equal(extra.generatedByRuleId, addExceptionRuleId('e1'));
});

test('add exceptions are ignored when in the past, timeless, or also cancelled', () => {
  const tpl = {
    scheduleRules: [],
    exceptions: [
      { id: 'past', date: '2026-07-01', type: 'add', time: '11:00' }, // before today
      { id: 'notime', date: '2026-07-20', type: 'add' }, // no time
      { id: 'both1', date: '2026-07-21', type: 'add', time: '11:00' },
      { id: 'both2', date: '2026-07-21', type: 'cancel' }, // contradicts the add
    ],
    products: [],
  };
  const { rows } = planTemplateGeneration(tpl, HORIZON);
  assert.equal(rows.length, 0);
});
