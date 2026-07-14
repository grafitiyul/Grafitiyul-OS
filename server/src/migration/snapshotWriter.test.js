import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SnapshotWriter, SHARD_SIZE, _internals } from './snapshotWriter.js';

function memStore() {
  const m = new Map();
  return {
    map: m,
    put: async ({ key, body }) => { m.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
    head: async (key) => (m.has(key) ? { size: m.get(key).length } : null),
    getText: async (key) => { if (!m.has(key)) throw new Error('404'); return m.get(key).toString('utf8'); },
  };
}

test('writeShard: NDJSON body, exact record count, sha256 matches content', async () => {
  const store = memStore();
  const w = new SnapshotWriter({ snapshotId: 'snapT', store });
  const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const d = await w.writeShard({ system: 'pipedrive', entity: 'deals', shardIndex: 0, records });
  assert.equal(d.key, 'snapshots/snapT/pipedrive/deals/shard-00000.jsonl');
  assert.equal(d.records, 3);
  const stored = store.map.get(d.key);
  assert.equal(stored.toString('utf8'), '{"id":1}\n{"id":2}\n{"id":3}\n');
  assert.equal(d.bytes, stored.length);
  assert.equal(d.sha256, crypto.createHash('sha256').update(stored).digest('hex'));
});

test('writeEntityManifest: totals + combined hash over ordered shard hashes', async () => {
  const store = memStore();
  const w = new SnapshotWriter({ snapshotId: 'snapT', store });
  const shards = [
    { key: 'a', records: 5000, bytes: 100, sha256: 'aa' },
    { key: 'b', records: 1234, bytes: 40, sha256: 'bb' },
  ];
  const man = await w.writeEntityManifest({ system: 'pipedrive', entity: 'persons', shards });
  assert.equal(man.totalRecords, 6234);
  assert.equal(man.totalBytes, 140);
  assert.equal(man.shardCount, 2);
  assert.equal(man.combinedSha256, _internals.sha256Hex(Buffer.from('aabb', 'utf8')));
  const readBack = await w.readEntityManifest('pipedrive', 'persons');
  assert.equal(readBack.totalRecords, 6234);
});

test('run state round-trips through the store', async () => {
  const store = memStore();
  const w = new SnapshotWriter({ snapshotId: 'snapT', store });
  assert.equal(await w.readRunState(), null);
  await w.writeRunState({ snapshotId: 'snapT', status: 'running', current: { key: 'x' } });
  const s = await w.readRunState();
  assert.equal(s.status, 'running');
  assert.equal(s.current.key, 'x');
});

test('empty shard produces empty body (no stray newline)', async () => {
  assert.equal(_internals.jsonlBuffer([]).length, 0);
  assert.equal(_internals.jsonlBuffer([{ a: 1 }]).toString('utf8'), '{"a":1}\n');
});

test('SHARD_SIZE is a sane bound', () => {
  assert.ok(SHARD_SIZE >= 1000 && SHARD_SIZE <= 20000);
});
