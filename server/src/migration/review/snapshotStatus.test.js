import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotStatus } from './snapshotStatus.js';

const RUN = {
  kind: 'snapshot', snapshotId: 'snap-x', status: 'complete',
  startedAt: new Date('2026-07-14T12:51:00Z'), finishedAt: new Date('2026-07-15T06:54:54Z'),
  counters: { _pipedriveRequests: 1414, _pipedriveRequestLimit: 1800, 'pipedrive/deals': 24359 },
};
const MANIFEST = {
  status: 'complete', startedAt: '2026-07-14T12:51:00Z', finishedAt: '2026-07-15T06:54:54Z',
  totals: { entities: 49, records: 493506 },
  requestBudget: { used: 1414, limit: 1800 },
  scope: { pipedriveFiles: 'METADATA ONLY' },
};
const VERIFICATION = { verdict: 'PASS', verifiedAt: '2026-07-15T07:00:00Z', blockingCount: 0, warningCount: 0, checks: { noPipedriveFileBodies: true } };

function stubs({ run = RUN, manifest = MANIFEST, verification = VERIFICATION, objects = [{ key: 'a', size: 100 }, { key: 'b', size: 50 }] } = {}) {
  const client = { migrationRun: { findFirst: async () => run } };
  const r2 = {
    getObjectText: async (key) => {
      if (key.endsWith('manifest.json') && !key.includes('_verification')) {
        if (!manifest) throw new Error('404');
        return JSON.stringify(manifest);
      }
      if (key.endsWith('_verification.json')) {
        if (!verification) throw new Error('404');
        return JSON.stringify(verification);
      }
      throw new Error('404');
    },
    listKeys: async () => objects,
  };
  return { client, r2 };
}

test('renders the real snapshot facts from the manifest', async () => {
  const { client, r2 } = stubs();
  const s = await buildSnapshotStatus(client, r2);
  assert.equal(s.snapshotId, 'snap-x');
  assert.equal(s.status, 'complete');
  assert.equal(s.complete, true);
  assert.equal(s.entityCount, 49);
  assert.equal(s.recordCount, 493506);
  assert.equal(s.objectCount, 2);
  assert.equal(s.totalBytes, 150);
  assert.deepEqual(s.requests, { used: 1414, limit: 1800 });
  assert.equal(s.verification.verdict, 'PASS');
  assert.equal(s.verification.blocking, 0);
});

test('exposes NO secrets and NO raw record payloads', async () => {
  const { client, r2 } = stubs();
  const s = await buildSnapshotStatus(client, r2);
  const json = JSON.stringify(s);
  for (const forbidden of ['api_token', 'apiToken', 'SECRET', 'ACCESS_KEY', 'Bearer', 'password', 'pat']) {
    assert.ok(!json.toLowerCase().includes(forbidden.toLowerCase()), `must not expose "${forbidden}"`);
  }
  // Only summary facts — never entity payloads or shard contents.
  assert.equal(s.shards, undefined);
  assert.equal(s.payload, undefined);
  assert.equal(s.records, undefined);
  assert.deepEqual(Object.keys(s).sort(), [
    'complete', 'createdAt', 'entityCount', 'finishedAt', 'objectCount', 'recordCount',
    'requests', 'scope', 'snapshotId', 'status', 'totalBytes', 'verification',
  ]);
});

test('no snapshot run → null (the UI shows an honest empty state)', async () => {
  const s = await buildSnapshotStatus({ migrationRun: { findFirst: async () => null } }, {});
  assert.equal(s, null);
});

test('missing verification file → verification null, page still renders', async () => {
  const { client, r2 } = stubs({ verification: null });
  const s = await buildSnapshotStatus(client, r2);
  assert.equal(s.verification, null);
  assert.equal(s.recordCount, 493506);
});

test('storage listing failure degrades gracefully', async () => {
  const { client, r2 } = stubs();
  r2.listKeys = async () => { throw new Error('r2 down'); };
  const s = await buildSnapshotStatus(client, r2);
  assert.equal(s.objectCount, null);
  assert.equal(s.totalBytes, null);
  assert.equal(s.recordCount, 493506, 'the rest still renders');
});
