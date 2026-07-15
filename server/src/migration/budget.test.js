import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget, RunLimitReached } from './budget.js';

test('the hard limit stops BEFORE the next call is made', async () => {
  const b = new RequestBudget({ limit: 3 });
  await b.take(); await b.take(); await b.take();
  assert.equal(b.used, 3);
  await assert.rejects(() => b.take(), (e) => e.code === 'RUN_LIMIT_REACHED' && e instanceof RunLimitReached);
  assert.equal(b.used, 3, 'a refused take does not consume budget');
  assert.equal(b.remaining(), 0);
});

test('a process restart CANNOT reset the allowance (counter is seeded from persisted state)', async () => {
  const persisted = { limit: 5, used: 0 };
  const b1 = new RequestBudget({ limit: 5, used: 0, onPersist: async (s) => Object.assign(persisted, s), persistEvery: 1 });
  await b1.take(); await b1.take(); await b1.take();
  assert.equal(persisted.used, 3, 'counter persisted');

  // simulate process restart: new budget seeded from the persisted counter
  const b2 = new RequestBudget({ limit: 5, used: persisted.used });
  assert.equal(b2.remaining(), 2, 'restart continues from 3/5 — it does not start over');
  await b2.take(); await b2.take();
  await assert.rejects(() => b2.take(), (e) => e.code === 'RUN_LIMIT_REACHED');
});

test('persists on the configured cadence and on flush', async () => {
  const seen = [];
  const b = new RequestBudget({ limit: 100, onPersist: async (s) => seen.push(s.used), persistEvery: 5 });
  for (let i = 0; i < 12; i++) await b.take();
  assert.deepEqual(seen, [5, 10], 'checkpointed every 5 requests');
  await b.flush();
  assert.deepEqual(seen, [5, 10, 12], 'flush captures the tail');
});

test('an invalid limit is rejected — a run cannot start without a declared ceiling', () => {
  assert.throws(() => new RequestBudget({ limit: 0 }));
  assert.throws(() => new RequestBudget({}));
  assert.throws(() => new RequestBudget({ limit: 'many' }));
});
