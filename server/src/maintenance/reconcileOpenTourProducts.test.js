import test from 'node:test';
import assert from 'node:assert/strict';
import { runReconcileOpenTourProductsOnce } from './reconcileOpenTourProducts.js';

// The durable marker + concurrency-safe claim. reconcileAllOpenTourProducts is
// exercised end-to-end in derivationReconcile.test.js; here we pin the run-once /
// retry-safe / concurrency-safe semantics with an empty tour scan.

function fakeClient({ job = null, findManyThrows = false } = {}) {
  const state = { job, updates: [] };
  return {
    state,
    maintenanceJob: {
      upsert: async ({ where, create }) => {
        if (!state.job) state.job = { key: create.key, status: 'pending', startedAt: null, attempts: 0 };
        return state.job;
      },
      updateMany: async ({ where, data }) => {
        const j = state.job;
        if (!j || j.key !== where.key) return { count: 0 };
        const matches = (where.OR || []).some((c) => {
          if (c.status === 'pending') return j.status === 'pending';
          if (c.status === 'failed') return j.status === 'failed';
          if (c.status === 'running' && c.startedAt?.lt) return j.status === 'running' && j.startedAt && j.startedAt < c.startedAt.lt;
          return false;
        });
        if (!matches) return { count: 0 };
        Object.assign(j, { status: 'running', startedAt: data.startedAt, attempts: j.attempts + 1 });
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(state.job, data);
        state.updates.push(data);
        return state.job;
      },
    },
    // reconcileAllOpenTourProducts pages this; [] → scans 0 and completes fast.
    tourEvent: {
      findMany: async () => {
        if (findManyThrows) throw new Error('db down');
        return [];
      },
    },
  };
}

test('runs once: pending → claimed → done, with a stored summary marker', async () => {
  const c = fakeClient();
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.done, true);
  assert.equal(c.state.job.status, 'done');
  assert.equal(c.state.job.summary.scanned, 0);
  assert.equal(c.state.job.attempts, 1);
});

test('idempotent: a done marker is skipped (no re-run)', async () => {
  const c = fakeClient({ job: { key: 'reconcile_open_tour_products_v3', status: 'done', startedAt: new Date(), attempts: 1 } });
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.skipped, true);
  assert.equal(c.state.job.status, 'done');
  assert.equal(c.state.job.attempts, 1); // untouched
});

test('concurrency-safe: a freshly-running marker (another instance) is skipped', async () => {
  const c = fakeClient({ job: { key: 'reconcile_open_tour_products_v3', status: 'running', startedAt: new Date(), attempts: 1 } });
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.skipped, true);
});

test('retry-safe: a failed marker is reclaimed and completed on the next run', async () => {
  const c = fakeClient({ job: { key: 'reconcile_open_tour_products_v3', status: 'failed', startedAt: new Date(0), attempts: 1 } });
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.done, true);
  assert.equal(c.state.job.status, 'done');
  assert.equal(c.state.job.attempts, 2);
});

test('retry-safe: a STALE running marker (crashed instance) is reclaimed', async () => {
  const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago > 15m stale window
  const c = fakeClient({ job: { key: 'reconcile_open_tour_products_v3', status: 'running', startedAt: old, attempts: 1 } });
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.done, true);
});

test('a failure leaves the marker failed (reclaimable), never throws into boot', async () => {
  const c = fakeClient({ findManyThrows: true });
  const res = await runReconcileOpenTourProductsOnce(c, null);
  assert.equal(res.failed, true);
  assert.equal(c.state.job.status, 'failed');
});
