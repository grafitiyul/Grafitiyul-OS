// One-off BOUNDED pass: build an id→location index per snapshot entity so the
// Review Center's browser can look up a source record and run a small label
// filter WITHOUT ever scanning the 782 MB snapshot.
//
// Reads each shard exactly once; writes snapshots/<id>/_index/<entity>.json.
// READS R2 ONLY — no Pipedrive/Airtable calls, no database writes.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/build-snapshot-index.mjs --snapshot <id>
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotId = arg('--snapshot');
if (!snapshotId) { console.error('usage: --snapshot <id>'); process.exit(1); }

const store = { getText: r2.getObjectText };
const reader = createSnapshotReader({ store, snapshotId });

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

// id + human label per entity family. Airtable records use their rec… id and the
// first non-empty text field as a label.
function extract(entityKey, rec) {
  if (entityKey.startsWith('airtable/')) {
    const fields = rec?.fields || {};
    let label = '';
    for (const v of Object.values(fields)) {
      if (typeof v === 'string' && v.trim()) { label = v.trim(); break; }
      if (typeof v === 'number') { label = String(v); break; }
    }
    return { id: rec?.id ?? null, label: clip(label) };
  }
  switch (entityKey) {
    case 'pipedrive/organizations':
    case 'pipedrive/persons':
    case 'pipedrive/products':
    case 'pipedrive/files':
      return { id: rec?.id ?? null, label: clip(String(rec?.name || '')) };
    case 'pipedrive/deals':
      return { id: rec?.id ?? null, label: clip(String(rec?.title || '')) };
    case 'pipedrive/activities':
      return { id: rec?.id ?? null, label: clip(String(rec?.subject || '')) };
    case 'pipedrive/notes':
      return { id: rec?.id ?? null, label: clip(stripHtml(rec?.content)) };
    case 'pipedrive/deal_products':
      return { id: rec?.deal_id ?? null, label: `עסקה ${rec?.deal_id ?? '?'} · ${rec?.products?.length ?? 0} שורות` };
    default:
      return { id: rec?.id ?? null, label: '' };
  }
}

const entities = await reader.listEntities();
console.log(`indexing ${entities.length} browsable entities of ${snapshotId}\n`);

let totalEntries = 0;
for (const e of entities) {
  const man = await reader.entityManifest(e.key);
  const entries = [];
  let shardIdx = 0;
  for (const shard of man.shards || []) {
    const recs = await reader.readShard(shard.key);
    for (let line = 0; line < recs.length; line++) {
      const { id, label } = extract(e.key, recs[line]);
      if (id == null) continue;
      entries.push([id, shardIdx, line, label]);
    }
    shardIdx++;
    reader._shardCache.clear(); // bounded memory: never hold the whole entity
  }
  const body = Buffer.from(JSON.stringify({ entity: e.key, count: entries.length, builtAt: new Date().toISOString(), entries }), 'utf8');
  const key = `snapshots/${snapshotId}/_index/${e.key.replace(/\//g, '__')}.json`;
  await r2.putObject({ key, body, contentType: 'application/json' });
  totalEntries += entries.length;
  console.log(`  ✓ ${e.key.padEnd(34)} ${String(entries.length).padStart(7)} entries · ${(body.length / 1048576).toFixed(1)} MB`);
}
console.log(`\n✔ indexed ${totalEntries} records across ${entities.length} entities`);
