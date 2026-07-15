import test from 'node:test';
import assert from 'node:assert/strict';
import { pipedriveClient, DEAL_IDS_PER_BULK_CALL, BULK_PAGE_LIMIT } from './pipedrive.js';
import { RequestBudget } from '../budget.js';

process.env.PIPEDRIVE_API_TOKEN ||= 'test-token';
process.env.PIPEDRIVE_COMPANY_DOMAIN ||= 'testco';

const budget = () => new RequestBudget({ limit: 1000 });

function fakeRes({ status = 200, body = {}, headers = {} }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

test('fails FAST (RATE_BUDGET_EXCEEDED) on a daily-budget 429 — never sleeps for hours', async () => {
  let calls = 0;
  const client = pipedriveClient({
    throttleMs: 0, budget: budget(),
    fetchImpl: async () => { calls++; return fakeRes({ status: 429, headers: { 'retry-after': '31323' }, body: { success: false, error: 'daily request budget exceeded' } }); },
  });
  const t0 = Date.now();
  await assert.rejects(() => client.page('/files', {}, 0), (e) => e.code === 'RATE_BUDGET_EXCEEDED' && e.retryAfter === 31323);
  assert.ok(Date.now() - t0 < 2000, 'must not sleep on the long retry-after');
  assert.equal(calls, 1, 'no hidden retry against an exhausted daily budget');
});

test('short 429 is retried then succeeds (and each attempt consumes budget)', async () => {
  let calls = 0;
  const b = new RequestBudget({ limit: 10 });
  const client = pipedriveClient({
    throttleMs: 0, budget: b,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return fakeRes({ status: 429, headers: { 'retry-after': '0' }, body: {} });
      return fakeRes({ status: 200, body: { data: [{ id: 1 }], additional_data: { pagination: { more_items_in_collection: false } } } });
    },
  });
  const { records, hasMore } = await client.page('/deals', {}, 0);
  assert.equal(records.length, 1);
  assert.equal(hasMore, false);
  assert.equal(calls, 2);
  assert.equal(b.used, 2, 'the retry was counted against the run ceiling');
});

test('page() maps v1 pagination fields', async () => {
  const client = pipedriveClient({
    throttleMs: 0, budget: budget(),
    fetchImpl: async () => fakeRes({ status: 200, body: { data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 500 } } } }),
  });
  const r = await client.page('/persons', {}, 0);
  assert.equal(r.records.length, 2);
  assert.equal(r.nextStart, 500);
  assert.equal(r.hasMore, true);
});

test('dealProductsBulk hits the v2 BULK endpoint with ≤100 deal_ids and limit 500', async () => {
  let seen = null;
  const client = pipedriveClient({
    throttleMs: 0, budget: budget(),
    fetchImpl: async (u) => { seen = new URL(u); return fakeRes({ status: 200, body: { data: [{ deal_id: 1, product_id: 9 }], additional_data: { next_cursor: null } } }); },
  });
  const ids = Array.from({ length: 100 }, (_, i) => i + 1);
  const r = await client.dealProductsBulk(ids);
  assert.match(seen.pathname, /\/api\/v2\/deals\/products$/, 'v2 bulk endpoint');
  assert.equal(seen.searchParams.get('deal_ids'), ids.join(','));
  assert.equal(seen.searchParams.get('limit'), String(BULK_PAGE_LIMIT));
  assert.equal(r.records.length, 1);
  assert.equal(r.nextCursor, null);
});

test('dealProductsBulk refuses more than the documented 100 deal_ids', async () => {
  const client = pipedriveClient({ throttleMs: 0, budget: budget(), fetchImpl: async () => fakeRes({}) });
  await assert.rejects(() => client.dealProductsBulk(Array.from({ length: 101 }, (_, i) => i)), /too many deal_ids/);
  assert.equal(DEAL_IDS_PER_BULK_CALL, 100);
});

test('dealProductsBulk follows the cursor when a batch exceeds one page', async () => {
  let n = 0;
  const client = pipedriveClient({
    throttleMs: 0, budget: budget(),
    fetchImpl: async (u) => {
      n++;
      const cur = new URL(u).searchParams.get('cursor');
      return fakeRes({ status: 200, body: { data: [{ deal_id: 1 }], additional_data: { next_cursor: cur ? null : 'c2' } } });
    },
  });
  const p1 = await client.dealProductsBulk([1]);
  assert.equal(p1.nextCursor, 'c2');
  const p2 = await client.dealProductsBulk([1], 'c2');
  assert.equal(p2.nextCursor, null);
  assert.equal(n, 2);
});
