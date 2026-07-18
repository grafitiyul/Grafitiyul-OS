import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureTourPayroll, ensureDayPayroll } from './service.js';

// Runbook v2: migration-owned tours (completedReason='migration') carry FROZEN
// imported payroll evidence. Lazy-ensure must never create, reconcile or
// regenerate anything for them — suppression by migration ownership, not date.

const stubClient = (tour, calls) => ({
  tourEvent: {
    findUnique: async () => tour,
    findMany: async ({ where }) => { calls.dayWhere = where; return []; },
  },
  payrollActivity: {
    create: async () => { calls.created = true; throw new Error('must not create'); },
  },
});

test('ensureTourPayroll: a migration-owned tour is untouched — existing frozen activity returned as-is', async () => {
  const calls = {};
  const frozen = { id: 'act1', state: 'active', entries: [] };
  const tour = { id: 't1', status: 'completed', date: '2023-06-01', completedReason: 'migration', payrollActivity: frozen, assignments: [], bookings: [] };
  const res = await ensureTourPayroll(stubClient(tour, calls), 't1');
  assert.equal(res, frozen);
  assert.equal(calls.created, undefined, 'no reconcile/creation path may run');
});

test('ensureTourPayroll: a migration-owned tour WITHOUT payroll gets none generated (null, no create)', async () => {
  const calls = {};
  const tour = { id: 't2', status: 'completed', date: '2023-06-01', completedReason: 'migration', payrollActivity: null, assignments: [{ id: 'a1' }], bookings: [] };
  const res = await ensureTourPayroll(stubClient(tour, calls), 't2');
  assert.equal(res, null);
  assert.equal(calls.created, undefined);
});

test('ensureDayPayroll: the day sweep excludes migration-owned tours in its WHERE clause', async () => {
  const calls = {};
  await ensureDayPayroll(stubClient(null, calls), '2023-06-01');
  assert.deepEqual(calls.dayWhere.NOT, { completedReason: 'migration' });
  assert.equal(calls.dayWhere.status, 'completed');
});
