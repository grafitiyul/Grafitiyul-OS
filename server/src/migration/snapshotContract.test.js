import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEntities, SnapshotContractError } from './snapshotContract.js';

// The contract check is the structural guard that replaced two failure modes found
// in the 2026-07-28 rehearsal: a raw NoSuchKey crash (identity import) and a silent
// `.catch(() => {})` that turned missing input into zero rows (cutover import).

const storeWith = (entities) => ({
  getText: async (key) => {
    if (key.endsWith('/manifest.json')) return JSON.stringify({ entities });
    throw new Error(`unexpected key ${key}`);
  },
});

test('passes when every required entity is present', async () => {
  const store = storeWith({ 'pipedrive/deals': {}, 'pipedrive/deal_participants': {} });
  const present = await requireEntities(store, 'snap-x', ['pipedrive/deals']);
  assert.ok(present.includes('pipedrive/deal_participants'));
});

test('throws a typed, actionable error naming the missing entities', async () => {
  const store = storeWith({ 'pipedrive/deals': {}, 'pipedrive/persons': {} });
  const err = await requireEntities(store, 'snap-x', ['pipedrive/deals', 'pipedrive/deal_participants'])
    .then(() => null, (e) => e);
  assert.ok(err instanceof SnapshotContractError);
  assert.equal(err.code, 'SNAPSHOT_CONTRACT_UNMET');
  assert.deepEqual(err.missing, ['pipedrive/deal_participants']);
  // the message must name the snapshot, the gap, and the remedy
  assert.match(err.message, /snap-x/);
  assert.match(err.message, /pipedrive\/deal_participants/);
  assert.match(err.message, /run-snapshot\.mjs/);
});

test('reports EVERY missing entity, not just the first', async () => {
  const store = storeWith({ 'pipedrive/deals': {} });
  const err = await requireEntities(store, 'snap-x', ['pipedrive/deal_participants', 'pipedrive/reference'])
    .then(() => null, (e) => e);
  assert.deepEqual(err.missing, ['pipedrive/deal_participants', 'pipedrive/reference']);
});

test('an omitted-but-unrequired entity (pipedrive/files) does NOT fail the contract', async () => {
  // The cutover Final Snapshot omits files by design; that must stay legal.
  const store = storeWith({ 'pipedrive/deals': {}, 'pipedrive/deal_participants': {}, 'pipedrive/reference': {} });
  await requireEntities(store, 'snap-x', ['pipedrive/deals', 'pipedrive/deal_participants', 'pipedrive/reference']);
});

test('an unreadable manifest is a distinct, typed failure', async () => {
  const store = { getText: async () => { throw new Error('NoSuchKey'); } };
  const err = await requireEntities(store, 'snap-missing', ['pipedrive/deals']).then(() => null, (e) => e);
  assert.equal(err.code, 'SNAPSHOT_MANIFEST_UNREADABLE');
  assert.match(err.message, /snap-missing/);
});
