import test from 'node:test';
import assert from 'node:assert/strict';
import { planRuleReconcile, classifyRulePlan } from './ruleEdit.js';
import { weekdayOf, addDays } from './slotGeneration.js';

// Pure weekly-rule reconciliation planner. Deterministic dates; weekday derived
// via weekdayOf so tests don't hardcode a calendar.

const TODAY = '2026-07-13';
const TARGET = '2026-08-10'; // ~4 weeks
const WD = weekdayOf('2026-07-16'); // some weekday
const OTHER_WD = (WD + 1) % 7;

function datesOfWeekday(from, to, wd) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdayOf(d) === wd) out.push(d);
  return out;
}
const WD_DATES = datesOfWeekday(TODAY, TARGET, WD);

test('time change (same weekday) → future occurrences retimed, missing ones created, no dup', () => {
  // Materialize the first two WD dates at 17:00; the rest are missing.
  const slots = WD_DATES.slice(0, 2).map((date, i) => ({ id: `s${i}`, date, startTime: '17:00', seats: 0, pinned: false }));
  const plan = planRuleReconcile({
    newRule: { weekday: WD, startTime: '18:00', validFrom: null, validUntil: null },
    slots, today: TODAY, target: TARGET,
  });
  assert.equal(plan.retime.length, 2);
  assert.ok(plan.retime.every((r) => r.toTime === '18:00'));
  assert.equal(plan.cancel.length, 0);
  // create = the remaining WD dates, none of them already materialized.
  assert.equal(plan.create.length, WD_DATES.length - 2);
  const created = new Set(plan.create.map((c) => c.date));
  assert.ok(slots.every((s) => !created.has(s.date)), 'never re-creates an existing date (no duplicate)');
});

test('past is out of scope — create never proposes a date before today', () => {
  const plan = planRuleReconcile({
    newRule: { weekday: WD, startTime: '18:00' }, slots: [], today: TODAY, target: TARGET,
  });
  assert.ok(plan.create.every((c) => c.date >= TODAY));
});

test('weekday change → old-weekday slots cancelled (orphans), new-weekday dates created', () => {
  const slots = WD_DATES.slice(0, 3).map((date, i) => ({ id: `s${i}`, date, startTime: '17:00', seats: 0, pinned: false }));
  const plan = planRuleReconcile({
    newRule: { weekday: OTHER_WD, startTime: '17:00' }, slots, today: TODAY, target: TARGET,
  });
  assert.equal(plan.cancel.length, 3); // all old-weekday slots orphaned
  assert.equal(plan.retime.length, 0);
  assert.ok(plan.create.length > 0);
  assert.ok(plan.create.every((c) => weekdayOf(c.date) === OTHER_WD));
});

test('registered occurrence → requiresConfirmation; not applied without confirm', () => {
  const slots = [
    { id: 'reg', date: WD_DATES[0], startTime: '17:00', seats: 4, pinned: false },
    { id: 'empty', date: WD_DATES[1], startTime: '17:00', seats: 0, pinned: false },
  ];
  const plan = planRuleReconcile({ newRule: { weekday: WD, startTime: '18:00' }, slots, today: TODAY, target: TARGET });
  const noConfirm = classifyRulePlan(plan);
  assert.equal(noConfirm.summary.requiresConfirmation.length, 1);
  assert.equal(noConfirm.summary.requiresConfirmation[0].id, 'reg');
  assert.deepEqual(noConfirm.apply.retime.map((r) => r.id), ['empty']); // reg NOT moved
  assert.equal(noConfirm.apply.impacted.length, 0);

  const confirmed = classifyRulePlan(plan, { confirmRegistered: true });
  assert.deepEqual(confirmed.apply.retime.map((r) => r.id).sort(), ['empty', 'reg']);
  assert.deepEqual(confirmed.apply.impacted.map((a) => a.id), ['reg']); // emits a canonical impact
});

test('manual-override (pinned) occurrence preserved unless overwrite', () => {
  const slots = [{ id: 'pin', date: WD_DATES[0], startTime: '17:00', seats: 0, pinned: true }];
  const plan = planRuleReconcile({ newRule: { weekday: WD, startTime: '18:00' }, slots, today: TODAY, target: TARGET });
  const preserve = classifyRulePlan(plan);
  assert.equal(preserve.summary.preserved.length, 1);
  assert.equal(preserve.apply.retime.length, 0); // pinned NOT retimed
  assert.equal(preserve.apply.blocked.length, 1);

  const overwrite = classifyRulePlan(plan, { overwritePinned: true });
  assert.deepEqual(overwrite.apply.retime.map((r) => r.id), ['pin']);
});

test('validity window shrink → out-of-window future slots cancelled', () => {
  const slots = WD_DATES.slice(0, 3).map((date, i) => ({ id: `s${i}`, date, startTime: '17:00', seats: 0, pinned: false }));
  const plan = planRuleReconcile({
    newRule: { weekday: WD, startTime: '17:00', validUntil: WD_DATES[0] }, // only the first date stays valid
    slots, today: TODAY, target: TARGET,
  });
  assert.deepEqual(plan.cancel.map((c) => c.date).sort(), WD_DATES.slice(1, 3).sort());
  assert.equal(plan.retime.length, 0);
});
