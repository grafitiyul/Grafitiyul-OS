import test from 'node:test';
import assert from 'node:assert/strict';
import { markGuideFutureToursCalendarPending } from './service.js';
import { israelToday } from '../../lib/israelDate.js';

// Fixed "now" so the future/past boundary is deterministic.
const NOW = Date.parse('2026-08-15T09:00:00Z');
const TODAY = israelToday(NOW);

function fakeClient(count = 0) {
  const calls = [];
  return {
    calls,
    tourEvent: { updateMany: async (args) => { calls.push(args); return { count }; } },
  };
}

test('only FUTURE scheduled tours the guide is assigned to are re-pended', async () => {
  const c = fakeClient(3);
  const n = await markGuideFutureToursCalendarPending(c, 'pr_1', NOW);
  assert.equal(n, 3);
  const { where, data } = c.calls[0];
  assert.equal(where.status, 'scheduled', 'cancelled/postponed tours are never re-invited');
  assert.deepEqual(where.date, { gte: TODAY }, 'history is never re-invited');
  assert.deepEqual(where.assignments, { some: { personRefId: 'pr_1' } }, 'only this guide’s tours');
  assert.deepEqual(data, { gcalSyncStatus: 'pending', gcalAttempts: 0, gcalNextRetryAt: null });
});

test('a tour already pending is left alone — repeated calls cannot reset a retry ladder', async () => {
  const c = fakeClient(0);
  await markGuideFutureToursCalendarPending(c, 'pr_1', NOW);
  assert.deepEqual(c.calls[0].where.NOT, { gcalSyncStatus: 'pending' });
});

test('the mark is idempotent — calling twice issues the same query and adds nothing', async () => {
  const c = fakeClient(2);
  await markGuideFutureToursCalendarPending(c, 'pr_1', NOW);
  await markGuideFutureToursCalendarPending(c, 'pr_1', NOW);
  assert.deepEqual(c.calls[0], c.calls[1]);
});

test('no person means no query at all', async () => {
  const c = fakeClient(5);
  assert.equal(await markGuideFutureToursCalendarPending(c, null, NOW), 0);
  assert.equal(await markGuideFutureToursCalendarPending(c, undefined, NOW), 0);
  assert.equal(c.calls.length, 0);
});

test('nothing to re-pend is a silent no-op, not an error', async () => {
  const c = fakeClient(0);
  assert.equal(await markGuideFutureToursCalendarPending(c, 'pr_nobody', NOW), 0);
});

test('it never talks to Google — the only write is the dirty flag', async () => {
  const c = fakeClient(1);
  await markGuideFutureToursCalendarPending(c, 'pr_1', NOW);
  // One updateMany on TourEvent and nothing else on the client surface.
  assert.equal(c.calls.length, 1);
  assert.deepEqual(Object.keys(c.calls[0]).sort(), ['data', 'where']);
});
