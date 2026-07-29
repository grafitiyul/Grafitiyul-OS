// MARKETING AUDIT — what marketing/attribution information does Pipedrive
// actually hold, and how much of it is really filled in?
//
// READ-ONLY, and zero API calls: everything is read from an existing snapshot in
// R2 (field definitions from pipedrive/reference, fill rates measured across the
// pipedrive/deals shards). The extraction gate stays closed.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/marketing-audit.mjs [--snapshot <id>] [--json]
//
// The point is to decide the canonical DealMarketing model from EVIDENCE — a
// field that exists but is filled on 12 of 24,358 deals is not worth a column,
// and a field nobody predicted may turn out to be the real lead source.
import * as r2 from '../../src/migration/r2.js';
import { createSnapshotReader } from '../../src/migration/review/snapshotReader.js';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const AS_JSON = process.argv.includes('--json');

// Terms that mark a field as marketing/attribution relevant. Deliberately broad —
// the audit is meant to DISCOVER, and a false positive costs one line of output.
const MARKETING_TERMS = [
  'utm', 'campaign', 'medium', 'source', 'referr', 'landing', 'channel', 'ad', 'adset',
  'gclid', 'fbclid', 'keyword', 'term', 'content', 'attribution', 'touch', 'lead',
  'מקור', 'קמפיין', 'ערוץ', 'פרסום', 'מודעה', 'הגעה', 'שיווק', 'דף נחיתה', 'ליד',
];

const looksMarketing = (f) => {
  const hay = `${f.name || ''} ${f.key || ''}`.toLowerCase();
  return MARKETING_TERMS.some((t) => hay.includes(t.toLowerCase()));
};

async function findLatestSnapshot() {
  const objs = await r2.listKeys('snapshots/');
  const ids = new Set();
  for (const o of objs) { const m = o.key.match(/^snapshots\/([^/]+)\/manifest\.json$/); if (m) ids.add(m[1]); }
  return [...ids].sort().pop() || null;
}

async function main() {
  const snapshotId = arg('--snapshot') || (await findLatestSnapshot());
  if (!snapshotId) { console.error('no snapshot found'); process.exit(1); }
  const reader = createSnapshotReader({ store: { getText: r2.getObjectText }, snapshotId });

  // ── 1) field definitions ────────────────────────────────────────────────────
  // The reference entity is stored as ONE pretty-printed JSON object
  // (reference.json), not as NDJSON like every other entity — so it is read
  // whole here rather than through the line-oriented shard reader.
  const refMan = await reader.entityManifest('pipedrive/reference');
  const refKey = refMan.shards?.[0]?.key;
  if (!refKey) { console.error('no reference shard in the snapshot'); process.exit(1); }
  const reference = JSON.parse(await r2.getObjectText(refKey));
  const dealFields = reference?.dealFields || reference?.reference?.dealFields || [];
  if (!dealFields.length) { console.error('no dealFields in the snapshot reference'); process.exit(1); }

  const candidates = dealFields.filter(looksMarketing);
  const byKey = new Map(candidates.map((f) => [f.key, f]));

  // ── 2) measured fill rates across every deal ────────────────────────────────
  const filled = new Map();          // key → count of non-empty
  const samples = new Map();         // key → up to 5 distinct example values
  let deals = 0;

  const dealsMan = await reader.entityManifest('pipedrive/deals');
  for (const s of dealsMan.shards || []) {
    for (const d of await reader.readShard(s.key)) {
      deals++;
      for (const key of byKey.keys()) {
        const raw = d[key];
        const v = raw && typeof raw === 'object' ? (raw.value ?? raw.name ?? null) : raw;
        if (v === null || v === undefined || v === '') continue;
        filled.set(key, (filled.get(key) || 0) + 1);
        const set = samples.get(key) || new Set();
        if (set.size < 5) set.add(String(v).slice(0, 60));
        samples.set(key, set);
      }
    }
    reader._shardCache.clear();
  }

  const rows = candidates
    .map((f) => ({
      key: f.key,
      name: f.name,
      type: f.field_type,
      options: (f.options || []).length || null,
      filled: filled.get(f.key) || 0,
      pct: deals ? +(((filled.get(f.key) || 0) / deals) * 100).toFixed(1) : 0,
      samples: [...(samples.get(f.key) || [])],
    }))
    .sort((a, b) => b.filled - a.filled);

  if (AS_JSON) {
    console.log(JSON.stringify({ snapshotId, deals, fields: rows }, null, 2));
    return;
  }

  console.log(`snapshot        : ${snapshotId}`);
  console.log(`deals examined  : ${deals.toLocaleString('en-US')}`);
  console.log(`deal fields     : ${dealFields.length} (${candidates.length} marketing-related)\n`);
  console.log('field'.padEnd(38) + 'type'.padEnd(14) + 'filled'.padStart(9) + '   %      samples');
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      String(r.name).slice(0, 36).padEnd(38) +
      String(r.type).padEnd(14) +
      String(r.filled).padStart(9) +
      String(r.pct).padStart(7) + '   ' +
      r.samples.slice(0, 3).join(' | ').slice(0, 60),
    );
  }
  const useful = rows.filter((r) => r.filled > 0);
  console.log(`\n${useful.length} of ${rows.length} marketing-related fields carry ANY data.`);
  console.log('fields with zero data are not worth a column in DealMarketing.');
}

main().catch((e) => { console.error('marketing audit fatal:', e?.message || e); process.exit(1); });
