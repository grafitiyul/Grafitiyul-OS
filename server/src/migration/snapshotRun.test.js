import test from 'node:test';
import assert from 'node:assert/strict';
import { runSnapshot } from './snapshotRun.js';
import { EXCLUDED_TABLE_NAME } from './sources/airtable.js';

function memStore(faultKey = null) {
  const m = new Map();
  let armed = !!faultKey;
  return {
    map: m,
    put: async ({ key, body }) => {
      if (armed && key === faultKey) { armed = false; throw new Error(`injected fault on ${key}`); }
      m.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    head: async (key) => (m.has(key) ? { size: m.get(key).length } : null),
    getText: async (key) => { if (!m.has(key)) throw new Error('404'); return m.get(key).toString('utf8'); },
  };
}

function fakePd(data, counters) {
  const pageOf = (arr, start, limit = 500) => {
    const slice = arr.slice(start, start + limit);
    const nextStart = start + limit;
    const hasMore = nextStart < arr.length;
    return { records: slice, nextStart: hasMore ? nextStart : null, hasMore };
  };
  const byPath = {
    '/organizations': data.orgs || [], '/persons': data.persons || [], '/deals': data.deals || [],
    '/notes': data.notes || [], '/activities': data.activities || [], '/files': data.files || [],
  };
  return {
    reference: async () => ({ pipelines: [{ id: 1 }], stages: [{ id: 10 }], users: [{ id: 7 }] }),
    page: async (path, _params, start) => { if (counters) counters.page = (counters.page || 0) + 1; return pageOf(byPath[path] || [], start); },
    dealProducts: async (id) => (data.products?.[id] || []),
  };
}

function fakeAt(data) {
  const recs = data.records || {};
  return {
    bases: [{ role: 'main', id: 'baseM' }, { role: 'legacy', id: 'baseL' }],
    tables: async (baseId) => data.tablesByBase[baseId] || [],
    recordsPage: async (baseId, tableId, { offset = null } = {}) => {
      const arr = recs[`${baseId}/${tableId}`] || [];
      const start = offset ? Number(offset) : 0;
      const slice = arr.slice(start, start + 100);
      const next = start + 100 < arr.length ? String(start + 100) : null;
      return { records: slice, offset: next };
    },
    download: async () => Buffer.from('BODY'),
  };
}

const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function baseData() {
  return {
    orgs: mk(2905, (i) => ({ id: i + 1, name: `org${i}` })),
    persons: mk(12000, (i) => ({ id: i + 1, first_name: `p${i}` })),
    deals: mk(300, (i) => ({ id: i + 1, status: 'won', products_count: i < 40 ? 2 : 0 })),
    notes: mk(700, (i) => ({ id: i + 1, content: `n${i}` })),
    activities: mk(1200, (i) => ({ id: i + 1, subject: `a${i}` })),
    files: mk(900, (i) => ({ id: i + 1, name: `f${i}`, file_size: 10 })),
    products: Object.fromEntries(mk(40, (i) => [i + 1, [{ name: `line${i}`, quantity: 1 }]])),
  };
}
function atData() {
  return {
    tablesByBase: {
      baseM: [{ id: 'tblTours', name: 'סיורים', primaryFieldId: 'f1', fields: [], attachmentFields: ['pic'] }],
      baseL: [{ id: 'tblPW', name: EXCLUDED_TABLE_NAME, primaryFieldId: 'f1', fields: [], attachmentFields: [] }],
    },
    records: {
      'baseM/tblTours': mk(250, (i) => ({ id: `recT${i}`, fields: i < 3 ? { pic: [{ url: 'http://x/1', filename: `p${i}.png`, size: 4, type: 'image/png' }] } : {} })),
    },
  };
}

test('full run: every entity count matches source; excluded table skipped; attachments captured', async () => {
  const store = memStore();
  const data = baseData();
  const top = await runSnapshot({ snapshotId: 'snapA', store, pd: fakePd(data), at: fakeAt(atData()) });

  assert.equal(top.status, 'complete');
  assert.equal(top.counters['pipedrive/organizations'], 2905);
  assert.equal(top.counters['pipedrive/persons'], 12000);
  assert.equal(top.counters['pipedrive/deals'], 300);
  assert.equal(top.counters['pipedrive/notes'], 700);
  assert.equal(top.counters['pipedrive/activities'], 1200);
  assert.equal(top.counters['pipedrive/files'], 900);
  assert.equal(top.counters['pipedrive/deal_products'], 40); // only products_count>0
  assert.equal(top.counters['airtable/main/tblTours'], 250);
  // excluded passwords table never planned/extracted
  assert.ok(!('airtable/legacy/tblPW' in top.counters));
  assert.ok(![...store.map.keys()].some((k) => k.includes('tblPW')));
  // attachments: 3 bodies downloaded + a manifest
  const attManifest = JSON.parse(store.map.get('snapshots/snapA/airtable/attachments/_manifest.json').toString());
  assert.equal(attManifest.fileCount, 3);
  assert.equal(top.counters['airtable/attachments'], 3);
});

test('deals persist across exactly ceil(12000/5000)=3 shards for persons', async () => {
  const store = memStore();
  await runSnapshot({ snapshotId: 'snapB', store, pd: fakePd(baseData()), at: fakeAt(atData()) });
  const man = JSON.parse(store.map.get('snapshots/snapB/pipedrive/persons/_manifest.json').toString());
  assert.equal(man.shardCount, 3);
  assert.equal(man.totalRecords, 12000);
  assert.deepEqual(man.shards.map((s) => s.records), [5000, 5000, 2000]);
});

test('resume: a completed snapshot re-run does no extraction (skips all entities)', async () => {
  const store = memStore();
  const data = baseData();
  await runSnapshot({ snapshotId: 'snapC', store, pd: fakePd(data), at: fakeAt(atData()) });
  const counters = {};
  const top2 = await runSnapshot({ snapshotId: 'snapC', store, pd: fakePd(data, counters), at: fakeAt(atData()) });
  assert.equal(counters.page || 0, 0, 'no pagination on a fully-complete resume');
  assert.equal(top2.counters['pipedrive/persons'], 12000);
});

test('mid-crash resume: injected fault on 2nd persons shard, re-run yields correct total, no double count', async () => {
  const faultKey = 'snapshots/snapD/pipedrive/persons/shard-00001.jsonl';
  const store = memStore(faultKey);
  const data = baseData();
  await assert.rejects(() => runSnapshot({ snapshotId: 'snapD', store, pd: fakePd(data), at: fakeAt(atData()) }));
  // resume with same store (fault now disarmed)
  const top = await runSnapshot({ snapshotId: 'snapD', store, pd: fakePd(data), at: fakeAt(atData()) });
  const man = JSON.parse(store.map.get('snapshots/snapD/pipedrive/persons/_manifest.json').toString());
  assert.equal(man.totalRecords, 12000);
  assert.deepEqual(man.shards.map((s) => s.records), [5000, 5000, 2000]);
  assert.equal(top.counters['pipedrive/persons'], 12000);
});
