import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPlanAssignments, planComponentRows } from './planMaterialize.js';

// Materialization decisions (WON: DealTourPlan → real tour) — planned guides
// re-pass the canonical eligibility rule; component copy honors the
// componentsCustomized contract (false = follow variant defaults).

const staff = (over = {}) => ({ status: 'active', lifecycleHint: 'staff', ...over });

test('eligible planned guides materialize; departed/blocked/deleted are skipped', () => {
  const plan = [
    { id: 'a1', displayName: 'דנה', personRef: staff() },
    { id: 'a2', displayName: 'יובל', personRef: staff({ lifecycleHint: 'trainee' }) },
    { id: 'a3', displayName: 'עומר', personRef: staff({ lifecycleHint: 'former' }) },
    { id: 'a4', displayName: 'נועה', personRef: staff({ status: 'blocked' }) },
    { id: 'a5', displayName: 'רוני', personRef: null }, // PersonRef deleted
  ];
  const { create, skipped } = splitPlanAssignments(plan);
  assert.deepEqual(create.map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(skipped.map((a) => a.displayName), ['עומר', 'נועה', 'רוני']);
});

test('empty / missing planned team materializes nothing', () => {
  assert.deepEqual(splitPlanAssignments([]), { create: [], skipped: [] });
  assert.deepEqual(splitPlanAssignments(undefined), { create: [], skipped: [] });
});

test('non-customized (or absent) plan returns null → caller seeds variant defaults', () => {
  assert.equal(planComponentRows(null, 't1'), null);
  assert.equal(planComponentRows({ componentsCustomized: false, activityComponents: [{}] }, 't1'), null);
});

test('customized plan copies its rows in order, locations included', () => {
  const plan = {
    componentsCustomized: true,
    activityComponents: [
      { activityComponentId: 'c2', workshopLocationId: 'w1', sortOrder: 5 },
      { activityComponentId: 'c1', workshopLocationId: null, sortOrder: 9 },
    ],
  };
  assert.deepEqual(planComponentRows(plan, 't1'), [
    { tourEventId: 't1', activityComponentId: 'c2', workshopLocationId: 'w1', sortOrder: 0 },
    { tourEventId: 't1', activityComponentId: 'c1', workshopLocationId: null, sortOrder: 1 },
  ]);
});

test('customized-to-EMPTY plan is authoritative: [] (never variant defaults)', () => {
  assert.deepEqual(planComponentRows({ componentsCustomized: true, activityComponents: [] }, 't1'), []);
});
