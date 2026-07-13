import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlotReconcile } from './service.js';

// Regression for the "changed guide is silently reverted" bug: the tour payroll
// reconcile (which runs on every activity open) must match entries to
// assignment SLOTS, not people. A payroll-only guide change repoints an entry's
// owner away from the assignment's person while keeping the slot; matching by
// person recreated the old guide and cancelled the reassigned entry.

const A1 = { id: 'asg1', externalPersonId: 'guide:dor', displayName: 'דור', role: 'workshop_assistant' };

test('normal case: assignment already has its own entry → nothing to do', () => {
  const entries = [{ id: 'e1', tourAssignmentId: 'asg1', externalPersonId: 'guide:dor', state: 'active' }];
  const plan = planSlotReconcile([A1], entries);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.reactivate, []);
  assert.deepEqual(plan.cancel, []);
});

test('reassigned entry survives: owner ≠ assignment person but same slot', () => {
  // The entry was reassigned Dor → Avi; it still occupies slot asg1.
  const entries = [{ id: 'e1', tourAssignmentId: 'asg1', externalPersonId: 'guide:avi', state: 'active' }];
  const plan = planSlotReconcile([A1], entries);
  assert.deepEqual(plan.create, [], 'does NOT recreate an entry for the old guide (slot is occupied)');
  assert.deepEqual(plan.cancel, [], 'does NOT cancel the reassigned entry (its slot is still assigned)');
  assert.deepEqual(plan.reactivate, []);
});

test('brand-new assignment with no entry → create one', () => {
  const A2 = { id: 'asg2', externalPersonId: 'guide:sara', displayName: 'שרה', role: 'guide' };
  const entries = [{ id: 'e1', tourAssignmentId: 'asg1', externalPersonId: 'guide:dor', state: 'active' }];
  const plan = planSlotReconcile([A1, A2], entries);
  assert.deepEqual(plan.create.map((a) => a.id), ['asg2']);
  assert.deepEqual(plan.cancel, []);
});

test('assignment slot removed → cancel the entry occupying it (even after reassignment)', () => {
  // Slot asg1 no longer assigned; the reassigned Avi entry occupies it → cancel.
  const entries = [{ id: 'e1', tourAssignmentId: 'asg1', externalPersonId: 'guide:avi', state: 'active' }];
  const plan = planSlotReconcile([], entries);
  assert.deepEqual(plan.cancel.map((e) => e.id), ['e1']);
  assert.deepEqual(plan.create, []);
});

test('cancelled entry whose slot is assigned again → reactivate with the assignment role', () => {
  const entries = [{ id: 'e1', tourAssignmentId: 'asg1', externalPersonId: 'guide:avi', state: 'cancelled' }];
  const plan = planSlotReconcile([A1], entries);
  assert.equal(plan.reactivate.length, 1);
  assert.equal(plan.reactivate[0].entry.id, 'e1');
  assert.equal(plan.reactivate[0].assignment.role, 'workshop_assistant');
  assert.deepEqual(plan.create, [], 'a reactivatable entry is never duplicated by a create');
});

test('legacy entry without a slot falls back to person matching', () => {
  const entries = [{ id: 'e1', tourAssignmentId: null, externalPersonId: 'guide:dor', state: 'active' }];
  const plan = planSlotReconcile([A1], entries);
  assert.deepEqual(plan.create, [], 'person match prevents a duplicate');
  assert.deepEqual(plan.cancel, [], 'slotless legacy entries are never auto-cancelled');
});
