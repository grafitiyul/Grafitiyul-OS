import test from 'node:test';
import assert from 'node:assert/strict';
import { planExceptionReconcile, classifyExceptionPlan } from './exceptionEdit.js';

// Pure one-off exception-edit reconciliation.

test('cancel exception: empty slots cancelled, registered ones need confirm', () => {
  const plan = planExceptionReconcile({ type: 'cancel', date: '2026-07-20' }, [
    { id: 'a', startTime: '17:00', seats: 0 },
    { id: 'b', startTime: '18:00', seats: 3 },
  ]);
  assert.deepEqual(plan.cancel.map((s) => s.id), ['a']);
  assert.deepEqual(plan.registered.map((s) => s.id), ['b']);

  const noConfirm = classifyExceptionPlan(plan);
  assert.deepEqual(noConfirm.apply.cancel.map((s) => s.id), ['a']); // registered NOT cancelled
  assert.equal(noConfirm.summary.requiresConfirmation.length, 1);
  assert.equal(noConfirm.apply.impacted.length, 0);

  const confirmed = classifyExceptionPlan(plan, { confirmRegistered: true });
  assert.deepEqual(confirmed.apply.cancel.map((s) => s.id).sort(), ['a', 'b']);
  assert.deepEqual(confirmed.apply.impacted.map((s) => s.id), ['b']);
});

test('time_override: retimes empty, confirms registered, skips no-op same-time', () => {
  const plan = planExceptionReconcile({ type: 'time_override', date: '2026-07-20', time: '19:00' }, [
    { id: 'noop', startTime: '19:00', seats: 0 }, // already at the new time → skip
    { id: 'empty', startTime: '17:00', seats: 0 },
    { id: 'reg', startTime: '17:00', seats: 2 },
  ]);
  assert.deepEqual(plan.retime.map((s) => s.id), ['empty']);
  assert.deepEqual(plan.registered.map((s) => s.id), ['reg']);
  const confirmed = classifyExceptionPlan(plan, { confirmRegistered: true });
  assert.ok(confirmed.apply.retime.every((s) => s.toTime === '19:00'));
  assert.deepEqual(confirmed.apply.retime.map((s) => s.id).sort(), ['empty', 'reg']);
});

test("'add' exception does not reconcile existing slots (generation handles it)", () => {
  const plan = planExceptionReconcile({ type: 'add', date: '2026-07-20', time: '11:00' }, [
    { id: 'x', startTime: '17:00', seats: 0 },
  ]);
  assert.deepEqual(plan, { cancel: [], retime: [], registered: [] });
});
