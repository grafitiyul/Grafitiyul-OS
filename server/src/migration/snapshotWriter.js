// Immutable snapshot writer — the ONE path that lays down snapshot objects.
//
// Layout under the private bucket:
//   snapshots/<snapshotId>/manifest.json          top-level (written at finalize)
//   snapshots/<snapshotId>/_run.json              authoritative resumable run state
//   snapshots/<snapshotId>/<system>/<entity>/shard-00001.jsonl … (NDJSON)
//   snapshots/<snapshotId>/<system>/<entity>/_manifest.json      per-entity manifest
//
// Every shard is content-hashed (sha256). Each entity manifest carries per-shard
// hashes + a combined hash (sha256 over the ordered shard hashes) + the exact
// record count. Verification re-reads manifests and reconciles counts/hashes.
//
// The storage functions (put/head/getText) are INJECTED so the writer is unit-
// testable with an in-memory store and never needs R2 in tests.
import crypto from 'node:crypto';

export const SHARD_SIZE = 5000; // records per shard (bounds memory + object size)

const pad5 = (n) => String(n).padStart(5, '0');
const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const jsonlBuffer = (records) =>
  Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8');

export class SnapshotWriter {
  // store: { put({key,body,contentType,ifAbsent}), head(key), getText(key) }
  constructor({ snapshotId, store }) {
    if (!snapshotId) throw new Error('snapshotId required');
    if (!store?.put) throw new Error('store.put required');
    this.snapshotId = snapshotId;
    this.store = store;
    this.root = `snapshots/${snapshotId}`;
  }

  entityDir(system, entity) { return `${this.root}/${system}/${entity}`; }
  shardKey(system, entity, shardIndex) { return `${this.entityDir(system, entity)}/shard-${pad5(shardIndex)}.jsonl`; }
  entityManifestKey(system, entity) { return `${this.entityDir(system, entity)}/_manifest.json`; }

  // Write one NDJSON shard; returns its descriptor {key,records,bytes,sha256}.
  async writeShard({ system, entity, shardIndex, records }) {
    const body = jsonlBuffer(records);
    const key = this.shardKey(system, entity, shardIndex);
    await this.store.put({ key, body, contentType: 'application/x-ndjson' });
    return { key, records: records.length, bytes: body.length, sha256: sha256Hex(body) };
  }

  // A raw object (attachment body, reference bundle). Returns {key,bytes,sha256}.
  async writeObject({ key, body, contentType }) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await this.store.put({ key: `${this.root}/${key}`, body: buf, contentType });
    return { key: `${this.root}/${key}`, bytes: buf.length, sha256: sha256Hex(buf) };
  }

  // Finalize an entity: combined hash over ordered shard hashes + totals.
  async writeEntityManifest({ system, entity, shards, params = {}, note = null }) {
    const combinedSha256 = sha256Hex(Buffer.from(shards.map((s) => s.sha256).join(''), 'utf8'));
    const manifest = {
      snapshotId: this.snapshotId, system, entity,
      totalRecords: shards.reduce((n, s) => n + s.records, 0),
      totalBytes: shards.reduce((n, s) => n + s.bytes, 0),
      shardCount: shards.length,
      shards,
      combinedSha256,
      params, note,
      createdAt: new Date().toISOString(),
    };
    await this.store.put({
      key: this.entityManifestKey(system, entity),
      body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    return manifest;
  }

  async readEntityManifest(system, entity) {
    if (!this.store.getText) return null;
    const exists = this.store.head ? await this.store.head(this.entityManifestKey(system, entity)) : true;
    if (!exists) return null;
    try { return JSON.parse(await this.store.getText(this.entityManifestKey(system, entity))); }
    catch { return null; }
  }

  // Authoritative resumable run state (single source of truth for progress).
  runStateKey() { return `${this.root}/_run.json`; }
  async writeRunState(state) {
    await this.store.put({
      key: this.runStateKey(),
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    return state;
  }
  async readRunState() {
    if (!this.store.getText) return null;
    const exists = this.store.head ? await this.store.head(this.runStateKey()) : true;
    if (!exists) return null;
    try { return JSON.parse(await this.store.getText(this.runStateKey())); }
    catch { return null; }
  }

  async writeTopManifest(manifest) {
    await this.store.put({
      key: `${this.root}/manifest.json`,
      body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    return manifest;
  }
}

export const _internals = { jsonlBuffer, sha256Hex, pad5 };
