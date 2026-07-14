import test from 'node:test';
import assert from 'node:assert/strict';
import { runGenerationTick, GENERATION_HEALTH_KEY } from './generationWorker.js';

// The scheduled generation tick over an in-memory client: it runs the canonical
// ensureOpenTourSlots and records health on the MaintenanceJob row so the בקרה
// detector can surface persistent failures. (ensureOpenTourSlots itself is
// covered in openTourGeneration.test.js; here we exercise the health bookkeeping
// and failure handling.)

function makeClient({ throwOnTemplates = false } = {}) {
  const jobs = {};
  return {
    _jobs: jobs,
    openTourTemplate: {
      findMany: async () => {
        if (throwOnTemplates) throw new Error('db down');
        return []; // no templates → ensureOpenTourSlots returns 0 immediately
      },
    },
    maintenanceJob: {
      findUnique: async ({ where }) => jobs[where.key] || null,
      upsert: async ({ where, create, update }) => {
        jobs[where.key] = jobs[where.key] ? { ...jobs[where.key], ...update } : { key: where.key, ...create };
        return jobs[where.key];
      },
    },
  };
}

const silent = { log() {}, warn() {} };

test('a successful tick records health as done with zero consecutive failures', async () => {
  const client = makeClient();
  const res = await runGenerationTick(client, silent);
  assert.deepEqual(res, { ok: true, created: 0 });
  const health = client._jobs[GENERATION_HEALTH_KEY];
  assert.equal(health.status, 'done');
  assert.equal(health.summary.consecutiveFailures, 0);
  assert.ok(health.summary.lastSuccessAt);
});

test('a failing tick records failed + increments consecutive failures; success resets', async () => {
  const client = makeClient({ throwOnTemplates: true });
  const r1 = await runGenerationTick(client, silent);
  assert.equal(r1.ok, false);
  assert.equal(client._jobs[GENERATION_HEALTH_KEY].status, 'failed');
  assert.equal(client._jobs[GENERATION_HEALTH_KEY].summary.consecutiveFailures, 1);

  // A second failure increments (the detector surfaces after several in a row).
  client.openTourTemplate.findMany = async () => { throw new Error('still down'); };
  await runGenerationTick(client, silent);
  assert.equal(client._jobs[GENERATION_HEALTH_KEY].summary.consecutiveFailures, 2);

  // Recovery resets the counter and stamps a fresh success.
  client.openTourTemplate.findMany = async () => [];
  const r3 = await runGenerationTick(client, silent);
  assert.equal(r3.ok, true);
  assert.equal(client._jobs[GENERATION_HEALTH_KEY].status, 'done');
  assert.equal(client._jobs[GENERATION_HEALTH_KEY].summary.consecutiveFailures, 0);
});
