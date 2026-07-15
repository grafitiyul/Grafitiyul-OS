import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './browser.js';
import { createSnapshotReader } from './snapshotReader.js';
import { EXCLUDED_TABLE_NAME } from '../excludedTables.js';

const SNAP = 'snap-t';
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// An in-memory snapshot shaped exactly like the real one.
function store(extra = {}) {
  const m = new Map(Object.entries({
    [`snapshots/${SNAP}/manifest.json`]: JSON.stringify({
      status: 'complete',
      entities: {
        'pipedrive/organizations': {}, 'pipedrive/persons': {}, 'pipedrive/reference': {},
        'airtable/main/tblTours': {}, 'airtable/attachments': {},
      },
    }),
    [`snapshots/${SNAP}/pipedrive/organizations/_manifest.json`]: JSON.stringify({
      totalRecords: 3, shards: [{ key: `snapshots/${SNAP}/pipedrive/organizations/shard-00000.jsonl`, records: 3 }],
    }),
    [`snapshots/${SNAP}/pipedrive/organizations/shard-00000.jsonl`]: jsonl([
      { id: 1, name: 'אלפא', address: 'הרצל 1', '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac': '512345678', owner_id: { value: 9, name: 'Elinoy' }, empty: '', api_token: 'SHOULD-NEVER-APPEAR' },
      { id: 2, name: 'ביתא' },
      { id: 3, name: 'גמא' },
    ]),
    [`snapshots/${SNAP}/pipedrive/persons/_manifest.json`]: JSON.stringify({
      totalRecords: 2, shards: [{ key: `snapshots/${SNAP}/pipedrive/persons/shard-00000.jsonl`, records: 2 }],
    }),
    [`snapshots/${SNAP}/pipedrive/persons/shard-00000.jsonl`]: jsonl([
      { id: 10, name: 'דנה', email: [{ value: 'dana@acme.co.il', primary: true }], org_id: { value: 1, name: 'אלפא' } },
      { id: 11, name: 'רון' },
    ]),
    [`snapshots/${SNAP}/pipedrive/reference/reference.json`]: JSON.stringify({
      organizationFields: [{ key: '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac', name: 'ח.פ / עוסק מורשה' }],
    }),
    [`snapshots/${SNAP}/airtable/main/tblTours/_manifest.json`]: JSON.stringify({
      totalRecords: 1, params: { tableName: 'סיורים' },
      shards: [{ key: `snapshots/${SNAP}/airtable/main/tblTours/shard-00000.jsonl`, records: 1 }],
    }),
    [`snapshots/${SNAP}/airtable/main/tblTours/shard-00000.jsonl`]: jsonl([{ id: 'recA', createdTime: '2026-01-01', fields: { 'שם הסיור': 'סיור בוקר' } }]),
    [`snapshots/${SNAP}/_index/pipedrive__organizations.json`]: JSON.stringify({
      entity: 'pipedrive/organizations', count: 3,
      entries: [[1, 0, 0, 'אלפא'], [2, 0, 1, 'ביתא'], [3, 0, 2, 'גמא']],
    }),
    [`snapshots/${SNAP}/_index/pipedrive__persons.json`]: JSON.stringify({
      entity: 'pipedrive/persons', count: 2, entries: [[10, 0, 0, 'דנה'], [11, 0, 1, 'רון']],
    }),
    [`snapshots/${SNAP}/_index/airtable__main__tblTours.json`]: JSON.stringify({
      entity: 'airtable/main/tblTours', count: 1, entries: [['recA', 0, 0, 'סיור בוקר']],
    }),
    ...extra,
  }));
  let reads = 0;
  return {
    reads: () => reads,
    getText: async (key) => { reads++; if (!m.has(key)) throw new Error(`404 ${key}`); return m.get(key); },
    _map: m,
  };
}
const mk = (s = store()) => createBrowser({ store: s, snapshotId: SNAP });

test('lists browsable entities from the snapshot itself (not a hardcoded list)', async () => {
  const entities = await mk().entities();
  const keys = entities.map((e) => e.key).sort();
  assert.deepEqual(keys, ['airtable/main/tblTours', 'pipedrive/organizations', 'pipedrive/persons']);
  // Airtable tables show their real name; non-row entities are excluded.
  assert.equal(entities.find((e) => e.key === 'airtable/main/tblTours').label, 'סיורים');
  assert.ok(!keys.includes('pipedrive/reference'));
  assert.ok(!keys.includes('airtable/attachments'));
});

test('the excluded passwords table is IMPOSSIBLE to browse', async () => {
  // Even if it somehow appeared in a manifest, it is denied by name.
  const s = store({
    [`snapshots/${SNAP}/manifest.json`]: JSON.stringify({ status: 'complete', entities: { 'airtable/legacy/tblPW': {}, 'pipedrive/organizations': {} } }),
    [`snapshots/${SNAP}/airtable/legacy/tblPW/_manifest.json`]: JSON.stringify({
      totalRecords: 1, params: { tableName: EXCLUDED_TABLE_NAME },
      shards: [{ key: `snapshots/${SNAP}/airtable/legacy/tblPW/shard-00000.jsonl`, records: 1 }],
    }),
    [`snapshots/${SNAP}/airtable/legacy/tblPW/shard-00000.jsonl`]: jsonl([{ id: 'recPW', fields: { סיסמה: 'hunter2' } }]),
  });
  const b = mk(s);
  const entities = await b.entities();
  assert.ok(!entities.some((e) => e.key.includes('tblPW')), 'never listed');
  await assert.rejects(() => b.page('airtable/legacy/tblPW', {}), (e) => e.code === 'NOT_BROWSABLE');
  await assert.rejects(() => b.record('airtable/legacy/tblPW', 'recPW'), (e) => e.code === 'NOT_BROWSABLE');
  await assert.rejects(() => b.filter('airtable/legacy/tblPW', 'hunter'), (e) => e.code === 'NOT_BROWSABLE');
});

test('secret-looking fields are never exposed', async () => {
  const rec = await mk().record('pipedrive/organizations', 1);
  const json = JSON.stringify(rec);
  assert.ok(!json.includes('SHOULD-NEVER-APPEAR'), 'api_token value stripped');
  assert.ok(!rec.fields.some((f) => /token/i.test(f.key)));
});

test('custom-field hashes resolve to real field names (no jargon)', async () => {
  const rec = await mk().record('pipedrive/organizations', 1);
  const tax = rec.fields.find((f) => f.key === '49f67a1342a56c48ed9ef2cb8a07264d4f3b58ac');
  assert.equal(tax.label, 'ח.פ / עוסק מורשה');
  assert.equal(tax.display, '512345678');
  assert.equal(tax.technical, false);
});

test('values are flattened to readable label→value (never raw JSON)', async () => {
  const rec = await mk().record('pipedrive/organizations', 1);
  assert.equal(rec.sourceSystem, 'Pipedrive');
  assert.equal(rec.sourceId, 1);
  for (const f of rec.fields) assert.equal(typeof f.display, 'string', `${f.key} is a display string`);
  // Empty values are dropped rather than rendered as noise.
  assert.ok(!rec.fields.some((f) => f.key === 'empty'));
  // A Pipedrive reference renders its name, and carries a link to the source record.
  const person = await mk().record('pipedrive/persons', 10);
  const orgRef = person.fields.find((f) => f.key === 'org_id');
  assert.equal(orgRef.display, 'אלפא');
  assert.deepEqual(orgRef.ref, { entity: 'pipedrive/organizations', id: 1 });
  // email array → joined values, not "[object Object]".
  assert.equal(person.fields.find((f) => f.key === 'email').display, 'dana@acme.co.il');
});

test('airtable records render their fields', async () => {
  const rec = await mk().record('airtable/main/tblTours', 'recA');
  assert.equal(rec.sourceSystem, 'Airtable');
  assert.equal(rec.sourceId, 'recA');
  assert.equal(rec.fields.find((f) => f.key === 'שם הסיור').display, 'סיור בוקר');
});

test('pagination is bounded and correct', async () => {
  const b = mk();
  const p1 = await b.page('pipedrive/organizations', { offset: 0, limit: 2 });
  assert.equal(p1.total, 3);
  assert.deepEqual(p1.rows.map((r) => r.id), [1, 2]);
  const p2 = await b.page('pipedrive/organizations', { offset: 2, limit: 2 });
  assert.deepEqual(p2.rows.map((r) => r.id), [3]);
  const past = await b.page('pipedrive/organizations', { offset: 99, limit: 2 });
  assert.deepEqual(past.rows, []);
  // A list ships id+label only — never whole payloads.
  assert.deepEqual(Object.keys(p1.rows[0]).sort(), ['id', 'label']);
});

test('source-id lookup works and is not a scan', async () => {
  const s = store();
  const b = mk(s);
  await b.entities();
  const readsBefore = s.reads();
  const rec = await b.record('pipedrive/organizations', 2);
  assert.equal(rec.sourceId, 2);
  assert.equal(rec.fields.find((f) => f.key === 'name').display, 'ביתא');
  // manifest+index+shard only — bounded, and shards are cached afterwards.
  assert.ok(s.reads() - readsBefore <= 4, 'lookup touches only a handful of objects');
  assert.equal(await b.record('pipedrive/organizations', 999), null);
});

test('label filter searches the index only, and is capped', async () => {
  const b = mk();
  const r = await b.filter('pipedrive/organizations', 'ית');
  assert.deepEqual(r.matches, [{ id: 2, label: 'ביתא' }]);
  assert.equal((await b.filter('pipedrive/organizations', 'לא קיים')).matches.length, 0);
  assert.deepEqual((await b.filter('pipedrive/organizations', '')).matches, [], 'empty query returns nothing');
  // Lookup by exact id through the filter box.
  assert.deepEqual((await b.filter('pipedrive/organizations', '3')).matches, [{ id: 3, label: 'גמא' }]);
});

test('without an index, lookup fails honestly instead of scanning', async () => {
  const s = store();
  s._map.delete(`snapshots/${SNAP}/_index/pipedrive__organizations.json`);
  await assert.rejects(() => mk(s).record('pipedrive/organizations', 1), (e) => e.code === 'NO_INDEX');
});

test('the shard cache is bounded and reused (no repeated full reads)', async () => {
  const s = store();
  const reader = createSnapshotReader({ store: s, snapshotId: SNAP });
  await reader.page('pipedrive/organizations', { offset: 0, limit: 1 });
  const after = s.reads();
  await reader.page('pipedrive/organizations', { offset: 1, limit: 1 });
  assert.equal(s.reads(), after, 'second page served from cache — the shard is not re-read');
});
