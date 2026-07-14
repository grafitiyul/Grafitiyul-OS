import test from 'node:test';
import assert from 'node:assert/strict';
import './openTourGeneration.js'; // side-effect: registers the detector + issue type
import { issueTypeDef } from '../registry.js';
import { GENERATION_HEALTH_KEY } from '../../tours/generationWorker.js';

const DEF = issueTypeDef('open_tour_generation_failed');

const clientWithHealth = (health) => ({
  maintenanceJob: { findUnique: async ({ where }) => (where.key === GENERATION_HEALTH_KEY ? health : null) },
});

test('the generation-failure issue type is registered with no in-app action', () => {
  assert.ok(DEF);
  assert.deepEqual(DEF.buildActions({ data: {} }), []);
});

test('recheck stays true only for a PERSISTENT failure (>= 3 consecutive)', async () => {
  assert.equal(await DEF.recheck(clientWithHealth({ status: 'failed', summary: { consecutiveFailures: 3 } })), true);
  assert.equal(await DEF.recheck(clientWithHealth({ status: 'failed', summary: { consecutiveFailures: 2 } })), false);
  assert.equal(await DEF.recheck(clientWithHealth({ status: 'done', summary: { consecutiveFailures: 0 } })), false);
  assert.equal(await DEF.recheck(clientWithHealth(null)), false); // no health row yet
});
