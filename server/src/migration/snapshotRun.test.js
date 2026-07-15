import test from 'node:test';
import assert from 'node:assert/strict';
import { runSnapshot } from './snapshotRun.js';
import { EXCLUDED_TABLE_NAME } from './sources/airtable.js';
import { RequestBudget } from './budget.js';

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

// Counts every kind of Pipedrive access so tests can assert "zero calls".
function fakePd(data, counters = {}) {
  const pageOf = (arr, start, limit) => {
    const slice = arr.slice(start, start + limit);
    const nextStart = start + limit;
    const hasMore = nextStart < arr.length;
    return { records: slice, nextStart: hasMore ? nextStart : null, hasMore };
  };
  const byPath = {
    '/organizations': data.orgs || [], '/persons': data.persons || [], '/deals': data.deals || [],
    '/notes': data.notes || [], '/activities': data.activities || [], '/files': data.files || [],
    '/products': data.catalog || [],
  };
  counters.page = 0; counters.bulk = 0; counters.batchSizes = [];
  return {
    reference: async () => ({ pipelines: [{ id: 1 }] }),
    page: async (path, _params, start, limit = 500) => { counters.page++; return pageOf(byPath[path] || [], start, limit); },
    dealProductsBulk: async (dealIds, cursor = null) => {
      counters.bulk++; counters.batchSizes.push(dealIds.length);
      if (data.bulkThrows) throw data.bulkThrows;
      const rows = dealIds.flatMap((id) => (data.products?.[id] || []));
      return { records: data.stripField ? rows.map((r) => { const c = { ...r }; delete c[data.stripField]; return c; }) : rows, nextCursor: null };
    },
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
      return { records: slice, offset: start + 100 < arr.length ? String(start + 100) : null };
    },
    download: async () => Buffer.from('BODY'),
  };
}

const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const TARGETS = 250; // deals with products → 3 batches of 100

function baseData() {
  const products = {};
  for (let i = 1; i <= TARGETS; i++) {
    products[i] = [
      { deal_id: i, product_id: 7, quantity: 2, item_price: 100, comments: '<div>3800 ש"ח עד 30 ילדים</div>', order_nr: 2 },
      { deal_id: i, product_id: 8, quantity: 1, item_price: 50, comments: null, order_nr: 1 },
    ];
  }
  return {
    orgs: mk(2905, (i) => ({ id: i + 1 })),
    persons: mk(12000, (i) => ({ id: i + 1 })),
    deals: mk(300, (i) => ({ id: i + 1, products_count: i < TARGETS ? 2 : 0 })),
    notes: mk(700, (i) => ({ id: i + 1 })),
    activities: mk(1200, (i) => ({ id: i + 1 })),
    files: mk(900, (i) => ({ id: i + 1 })),
    catalog: mk(12, (i) => ({ id: i + 1, name: `prod${i}` })),
    products,
  };
}
function atData() {
  return {
    tablesByBase: {
      baseM: [{ id: 'tblTours', name: 'סיורים', primaryFieldId: 'f1', fields: [], attachmentFields: ['pic'] }],
      baseL: [{ id: 'tblPW', name: EXCLUDED_TABLE_NAME, primaryFieldId: 'f1', fields: [], attachmentFields: [] }],
    },
    records: { 'baseM/tblTours': mk(250, (i) => ({ id: `recT${i}`, fields: i < 3 ? { pic: [{ url: 'http://x/1', filename: `p${i}.png`, size: 4, type: 'image/png' }] } : {} })) },
  };
}

test('deal_products are BATCHED (v2 bulk), not one call per deal', async () => {
  const store = memStore(); const c = {};
  const top = await runSnapshot({ snapshotId: 'snapA', store, pd: fakePd(baseData(), c), at: fakeAt(atData()) });
  assert.equal(top.counters['pipedrive/deal_products'], TARGETS, 'one record per target deal');
  assert.equal(c.bulk, Math.ceil(TARGETS / 100), '3 bulk calls for 250 deals');
  assert.deepEqual(c.batchSizes, [100, 100, 50]);
  assert.ok(c.bulk < TARGETS / 10, `batched: ${c.bulk} calls vs ${TARGETS} deals (old per-deal path)`);
});

test('deal_products target list costs ZERO Pipedrive calls (read from R2 deals snapshot)', async () => {
  const store = memStore(); const c = {};
  await runSnapshot({ snapshotId: 'snapZ', store, pd: fakePd(baseData(), c), at: fakeAt(atData()) });
  // deals=300@500 → 1 page; if targets were discovered by re-paging /deals it would be ≥2.
  const dealsPages = 1, orgPages = 6, personPages = 24, notePages = 2, actPages = 3, filePages = 9, catPages = 1;
  assert.equal(c.page, dealsPages + orgPages + personPages + notePages + actPages + filePages + catPages,
    'no extra /deals pagination to build the deal_products target list');
});

test('product-line order (order_nr) and comments/HTML are preserved', async () => {
  const store = memStore();
  await runSnapshot({ snapshotId: 'snapO', store, pd: fakePd(baseData()), at: fakeAt(atData()) });
  const shard = store.map.get('snapshots/snapO/pipedrive/deal_products/shard-00000.jsonl').toString('utf8');
  const first = JSON.parse(shard.split('\n')[0]);
  assert.deepEqual(first.products.map((p) => p.order_nr), [1, 2], 'sorted by order_nr');
  assert.match(first.products[1].comments, /3800 ש"ח/, 'HTML comments preserved verbatim');
});

test('field-parity gate ABORTS before writing if a frozen-spec field is missing', async () => {
  const store = memStore();
  const data = { ...baseData(), stripField: 'comments' };
  await assert.rejects(
    () => runSnapshot({ snapshotId: 'snapP', store, pd: fakePd(data), at: fakeAt(atData()) }),
    (e) => e.code === 'FIELD_PARITY_FAILED' && /comments/.test(e.message),
  );
  assert.equal(store.map.get('snapshots/snapP/pipedrive/deal_products/_manifest.json'), undefined, 'nothing written');
});

test('completed entities are never fetched again; existing snapshot id is resumed', async () => {
  const store = memStore(); const data = baseData();
  await runSnapshot({ snapshotId: 'snapC', store, pd: fakePd(data, {}), at: fakeAt(atData()) });
  const c2 = {};
  const top2 = await runSnapshot({ snapshotId: 'snapC', store, pd: fakePd(data, c2), at: fakeAt(atData()) });
  assert.equal(c2.page, 0, 'zero pagination on a complete resume');
  assert.equal(c2.bulk, 0, 'zero bulk calls on a complete resume');
  assert.equal(top2.snapshotId, 'snapC', 'same snapshot id resumed — no second snapshot');
});

test('duplicate resume does not duplicate snapshot records', async () => {
  const store = memStore(); const data = baseData();
  const a = await runSnapshot({ snapshotId: 'snapD2', store, pd: fakePd(data), at: fakeAt(atData()) });
  const keysAfter1 = [...store.map.keys()].filter((k) => k.includes('shard-')).length;
  const b = await runSnapshot({ snapshotId: 'snapD2', store, pd: fakePd(data), at: fakeAt(atData()) });
  assert.deepEqual(b.counters, a.counters, 'counters identical');
  assert.equal([...store.map.keys()].filter((k) => k.includes('shard-')).length, keysAfter1, 'no extra shards');
  const man = JSON.parse(store.map.get('snapshots/snapD2/pipedrive/deal_products/_manifest.json').toString());
  assert.equal(man.totalRecords, TARGETS, 'no duplicated deal_products records');
});

test('an implementation change UPGRADES the existing snapshot plan (no second snapshot)', async () => {
  const store = memStore(); const data = baseData(); const c = {};
  // Seed a run state written by the OLD per-deal implementation.
  const stale = {
    snapshotId: 'snapU', kind: 'snapshot', status: 'paused', startedAt: new Date().toISOString(),
    excludedTables: [EXCLUDED_TABLE_NAME],
    plan: ['pipedrive/deals', 'pipedrive/deal_products'],
    planDetail: [
      { key: 'pipedrive/deals', system: 'pipedrive', entity: 'deals', kind: 'pdBulk', path: '/deals', params: {}, limit: 500, shardSize: 5000 },
      { key: 'pipedrive/deal_products', system: 'pipedrive', entity: 'deal_products', kind: 'pdPerDeal', shardSize: 1000 }, // ← retired kind
    ],
    completed: {}, current: null, counters: {},
  };
  await store.put({ key: 'snapshots/snapU/_run.json', body: Buffer.from(JSON.stringify(stale)) });
  const top = await runSnapshot({ snapshotId: 'snapU', store, pd: fakePd(data, c), at: fakeAt(atData()) });
  assert.equal(top.snapshotId, 'snapU', 'same snapshot');
  assert.equal(c.bulk, 3, 'retired pdPerDeal kind was replaced by the v2 bulk path');
  assert.equal(top.counters['pipedrive/deal_products'], TARGETS);
});

test('a daily-budget 429 pauses immediately and preserves the checkpoint', async () => {
  const store = memStore();
  const err = new Error('pipedrive_rate_budget_exceeded: retry-after 31323s (daily budget)');
  err.code = 'RATE_BUDGET_EXCEEDED'; err.retryAfter = 31323;
  const data = { ...baseData(), bulkThrows: err };
  await assert.rejects(() => runSnapshot({ snapshotId: 'snapR', store, pd: fakePd(data), at: fakeAt(atData()) }),
    (e) => e.code === 'RATE_BUDGET_EXCEEDED');
  const state = JSON.parse(store.map.get('snapshots/snapR/_run.json').toString());
  assert.equal(state.status, 'paused');
  assert.match(state.pausedReason, /daily budget/);
  assert.equal(state.retryAfter, 31323);
  assert.ok(state.completed['pipedrive/deals'], 'earlier entities stay completed (checkpoint preserved)');
});

test('run-limit stop pauses the run and persists the counter', async () => {
  const store = memStore();
  const budget = new RequestBudget({ limit: 3 });
  const c = {};
  await assert.rejects(() => runSnapshot({ snapshotId: 'snapL', store, pd: fakePdWithBudget(baseData(), c, budget), at: fakeAt(atData()), budget }),
    (e) => e.code === 'RUN_LIMIT_REACHED');
  const state = JSON.parse(store.map.get('snapshots/snapL/_run.json').toString());
  assert.equal(state.status, 'paused');
  assert.equal(state.requestBudget.limit, 3);
  assert.equal(state.requestBudget.used, 3, 'counter persisted at the ceiling');
});

// A pd whose every call goes through the real budget guard.
function fakePdWithBudget(data, counters, budget) {
  const inner = fakePd(data, counters);
  return {
    reference: async () => { await budget.take(); return inner.reference(); },
    page: async (...a) => { await budget.take(); return inner.page(...a); },
    dealProductsBulk: async (...a) => { await budget.take(); return inner.dealProductsBulk(...a); },
  };
}

test('excluded passwords table is never planned or read', async () => {
  const store = memStore();
  const top = await runSnapshot({ snapshotId: 'snapE', store, pd: fakePd(baseData()), at: fakeAt(atData()) });
  assert.ok(!('airtable/legacy/tblPW' in top.counters));
  assert.ok(![...store.map.keys()].some((k) => k.includes('tblPW')));
});

test('manifest + checksum behaviour remains correct (shard sums, combined hash)', async () => {
  const store = memStore();
  await runSnapshot({ snapshotId: 'snapM', store, pd: fakePd(baseData()), at: fakeAt(atData()) });
  const man = JSON.parse(store.map.get('snapshots/snapM/pipedrive/persons/_manifest.json').toString());
  assert.equal(man.shardCount, 3);
  assert.equal(man.totalRecords, 12000);
  assert.deepEqual(man.shards.map((s) => s.records), [5000, 5000, 2000]);
  assert.equal(man.shards.reduce((n, s) => n + s.records, 0), man.totalRecords);
  assert.ok(/^[0-9a-f]{64}$/.test(man.combinedSha256));
});

test('mid-crash resume yields correct totals with no double count', async () => {
  const faultKey = 'snapshots/snapF/pipedrive/persons/shard-00001.jsonl';
  const store = memStore(faultKey); const data = baseData();
  await assert.rejects(() => runSnapshot({ snapshotId: 'snapF', store, pd: fakePd(data), at: fakeAt(atData()) }));
  const top = await runSnapshot({ snapshotId: 'snapF', store, pd: fakePd(data), at: fakeAt(atData()) });
  const man = JSON.parse(store.map.get('snapshots/snapF/pipedrive/persons/_manifest.json').toString());
  assert.equal(man.totalRecords, 12000);
  assert.equal(top.counters['pipedrive/persons'], 12000);
});
