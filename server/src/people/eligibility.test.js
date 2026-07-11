import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssignableStaff } from './eligibility.js';

// The ONE Tour-assignment eligibility rule — active guides/trainees only;
// legacy null-lifecycle rows stay assignable; every departed/blocked/
// non-working state is out.

test('active staff, trainees and legacy (null lifecycle) rows are assignable', () => {
  assert.equal(isAssignableStaff({ status: 'active', lifecycleHint: 'staff' }), true);
  assert.equal(isAssignableStaff({ status: 'active', lifecycleHint: 'trainee' }), true);
  assert.equal(isAssignableStaff({ status: 'active', lifecycleHint: null }), true);
});

test('departed / non-working lifecycles are NOT assignable, even when active', () => {
  for (const lifecycleHint of ['former', 'none', 'evaluator', 'candidate', 'anything_new']) {
    assert.equal(
      isAssignableStaff({ status: 'active', lifecycleHint }),
      false,
      `lifecycle=${lifecycleHint} must be rejected`,
    );
  }
});

test('blocked or missing person is never assignable, whatever the lifecycle', () => {
  assert.equal(isAssignableStaff({ status: 'blocked', lifecycleHint: 'staff' }), false);
  assert.equal(isAssignableStaff(null), false);
  assert.equal(isAssignableStaff(undefined), false);
});
