// Read-only access to Snapshot #1 in R2, for the TEMPORARY Review Center.
//
// Performance contract: the snapshot is ~782 MB across ~286 objects. NOTHING here
// ever loads the whole snapshot. Reads are per-shard with a bounded LRU cache, and
// record lookup uses a prebuilt index (see scripts/migration/build-snapshot-index.mjs)
// so a lookup costs one small index read + one shard read — never a scan.
//
// Storage is injected so this is unit-testable without R2.
import { EXCLUDED_TABLE_NAME } from '../excludedTables.js';

// Hard deny-list: the passwords table was never snapshotted, but the browser
// refuses it by name/key too (defence in depth — it can never be reachable).
const DENY_TABLE_NAMES = new Set([EXCLUDED_TABLE_NAME]);

const CACHE_BUDGET_BYTES = 96 * 1024 * 1024; // bounded: a few shards at a time

class LruCache {
  constructor(budget) { this.budget = budget; this.bytes = 0; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return null;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v); // refresh recency
    return v.value;
  }
  set(k, value, size) {
    if (this.map.has(k)) { this.bytes -= this.map.get(k).size; this.map.delete(k); }
    this.map.set(k, { value, size });
    this.bytes += size;
    while (this.bytes > this.budget && this.map.size > 1) {
      const oldest = this.map.keys().next().value;
      this.bytes -= this.map.get(oldest).size;
      this.map.delete(oldest);
    }
  }
  clear() { this.map.clear(); this.bytes = 0; }
}

export function createSnapshotReader({ store, snapshotId }) {
  const root = `snapshots/${snapshotId}`;
  const shardCache = new LruCache(CACHE_BUDGET_BYTES);
  const jsonCache = new Map(); // manifests + indexes (small, long-lived)

  async function readJson(key) {
    if (jsonCache.has(key)) return jsonCache.get(key);
    const text = await store.getText(`${root}/${key}`);
    const parsed = JSON.parse(text);
    jsonCache.set(key, parsed);
    return parsed;
  }

  // The snapshot's own top manifest is the authoritative entity registry.
  async function topManifest() { return readJson('manifest.json'); }

  async function entityManifest(entityKey) {
    return readJson(`${entityKey}/_manifest.json`);
  }

  // One shard, parsed to records. Cached by object key.
  async function readShard(key) {
    const hit = shardCache.get(key);
    if (hit) return hit;
    const text = await store.getText(key);
    const records = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip a malformed line rather than fail the page */ }
    }
    shardCache.set(key, records, text.length);
    return records;
  }

  // Browsable entities, derived from the snapshot itself (never a hardcoded list),
  // with the excluded table refused even if it somehow appeared.
  async function listEntities() {
    const top = await topManifest();
    const keys = Object.keys(top.entities || {});
    const out = [];
    for (const key of keys) {
      if (key === 'airtable/attachments' || key === 'pipedrive/reference') continue; // not row-shaped
      let man = null;
      try { man = await entityManifest(key); } catch { continue; }
      const tableName = man?.params?.tableName || null;
      if (tableName && DENY_TABLE_NAMES.has(tableName)) continue; // never browsable
      const [system] = key.split('/');
      out.push({
        key,
        system,
        label: tableName || key.split('/').slice(1).join('/'),
        tableName,
        records: man.totalRecords ?? 0,
        shardSize: man.shards?.[0]?.records ?? 0,
      });
    }
    return out;
  }

  async function assertBrowsable(entityKey) {
    const entities = await listEntities();
    const e = entities.find((x) => x.key === entityKey);
    if (!e) { const err = new Error('entity_not_browsable'); err.code = 'NOT_BROWSABLE'; throw err; }
    return e;
  }

  // A page of records. Shard math → reads at most 2 shards, never the entity.
  async function page(entityKey, { offset = 0, limit = 25 } = {}) {
    const e = await assertBrowsable(entityKey);
    const man = await entityManifest(entityKey);
    const shards = man.shards || [];
    const total = man.totalRecords ?? 0;
    const out = [];
    let cursor = offset;
    let remaining = Math.min(limit, Math.max(0, total - offset));
    // Walk shards using their recorded record counts (no scanning).
    let base = 0;
    for (const s of shards) {
      if (remaining <= 0) break;
      const end = base + s.records;
      if (cursor < end) {
        const recs = await readShard(s.key);
        const from = cursor - base;
        const take = recs.slice(from, from + remaining);
        out.push(...take);
        remaining -= take.length;
        cursor += take.length;
      }
      base = end;
    }
    return { entity: e, total, offset, limit, records: out };
  }

  // The prebuilt index: [[id, shardIdx, lineIdx, label], …]. Absent → null, and
  // callers degrade to "lookup unavailable" rather than scanning 782 MB.
  async function index(entityKey) {
    try { return await readJson(`_index/${entityKey.replace(/\//g, '__')}.json`); }
    catch { return null; }
  }

  async function getById(entityKey, id) {
    await assertBrowsable(entityKey);
    const idx = await index(entityKey);
    if (!idx) { const e = new Error('index_unavailable'); e.code = 'NO_INDEX'; throw e; }
    const hit = (idx.entries || []).find((row) => String(row[0]) === String(id));
    if (!hit) return null;
    const man = await entityManifest(entityKey);
    const shard = man.shards?.[hit[1]];
    if (!shard) return null;
    const recs = await readShard(shard.key);
    return recs[hit[2]] ?? null;
  }

  // Small label filter over the INDEX only (never over payloads) — bounded and
  // cheap. Deliberately not a search engine.
  async function filter(entityKey, q, { limit = 25 } = {}) {
    await assertBrowsable(entityKey);
    const idx = await index(entityKey);
    if (!idx) { const e = new Error('index_unavailable'); e.code = 'NO_INDEX'; throw e; }
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return { matches: [], truncated: false };
    const matches = [];
    for (const row of idx.entries || []) {
      const label = String(row[3] || '');
      if (label.toLowerCase().includes(needle) || String(row[0]) === needle) {
        matches.push({ id: row[0], label });
        if (matches.length >= limit) return { matches, truncated: true };
      }
    }
    return { matches, truncated: false };
  }

  return { root, topManifest, entityManifest, listEntities, assertBrowsable, page, getById, filter, index, readShard, _shardCache: shardCache };
}

export { DENY_TABLE_NAMES };
