import test from 'node:test';
import assert from 'node:assert/strict';
import { pipedriveClient } from './pipedrive.js';

process.env.PIPEDRIVE_API_TOKEN ||= 'test-token';
process.env.PIPEDRIVE_COMPANY_DOMAIN ||= 'testco';

function fakeRes({ status = 200, body = {}, headers = {} }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body };
}

test('fails FAST (RATE_BUDGET_EXCEEDED) on a daily-budget 429 — never sleeps for hours', async () => {
  let calls = 0;
  const client = pipedriveClient({
    throttleMs: 0,
    fetchImpl: async () => { calls++; return fakeRes({ status: 429, headers: { 'retry-after': '31323' }, body: { success: false, error: 'daily request budget exceeded' } }); },
  });
  const t0 = Date.now();
  await assert.rejects(() => client.page('/files', {}, 0), (e) => e.code === 'RATE_BUDGET_EXCEEDED' && e.retryAfter === 31323);
  assert.ok(Date.now() - t0 < 2000, 'must not sleep on the long retry-after');
  assert.equal(calls, 1, 'no wasteful retries against an exhausted budget');
});

test('short 429 is retried then succeeds', async () => {
  let calls = 0;
  const client = pipedriveClient({
    throttleMs: 0,
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
});

test('page() maps pagination fields', async () => {
  const client = pipedriveClient({
    throttleMs: 0,
    fetchImpl: async () => fakeRes({ status: 200, body: { data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 500 } } } }),
  });
  const r = await client.page('/persons', {}, 0);
  assert.equal(r.records.length, 2);
  assert.equal(r.nextStart, 500);
  assert.equal(r.hasMore, true);
});
