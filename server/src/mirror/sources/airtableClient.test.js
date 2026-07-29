import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AirtableRateLimit, airtableClientFromEnv, backoffMs, createAirtableClient,
  escapeFormulaValue, modifiedSinceFormula,
} from './airtableClient.js';

const res = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const mk = (fetchImpl, over = {}) => createAirtableClient({
  token: 't', baseId: 'app1', tableId: 'tbl1', fields: ['DATE'], fetchImpl, ...over,
});

// ── incremental filtering (the whole efficiency story) ───────────────────────

test('with a cursor the request filters SERVER-SIDE — no full rescan', async () => {
  let url;
  const c = mk(async (u) => { url = u; return res({ records: [] }); });
  await c.listModifiedSince('2026-07-29T10:00:00.000Z');
  // URLSearchParams encodes the space as '+', so normalise before matching.
  const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
  assert.match(decoded, /filterByFormula=IS_AFTER\(LAST_MODIFIED_TIME\(\), '2026-07-29T10:00:00\.000Z'\)/);
});

test('a quiet cycle costs exactly ONE request and returns nothing', async () => {
  let calls = 0;
  const c = mk(async () => { calls++; return res({ records: [] }); });
  const out = await c.listModifiedSince('2026-07-29T10:00:00.000Z');
  assert.equal(calls, 1);
  assert.deepEqual(out.records, []);
});

test('the first cycle (no cursor) has no filter — a one-time full read', async () => {
  let url;
  const c = mk(async (u) => { url = u; return res({ records: [] }); });
  await c.listModifiedSince(null);
  assert.ok(!url.includes('filterByFormula'));
});

test('only the mapped fields are requested — payloads stay small', async () => {
  let url;
  const c = mk(async (u) => { url = u; return res({ records: [] }); }, { fields: ['DATE', 'סטטוס'] });
  await c.listModifiedSince(null);
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.includes('fields[]=DATE'));
  assert.ok(decoded.includes('fields[]=סטטוס'));
});

test('the next cursor is the MAX observed lastModified, never the wall clock', async () => {
  const c = mk(async () => res({
    records: [
      { id: 'r1', fields: { __lastModified: '2026-07-29T10:00:00.000Z' } },
      { id: 'r2', fields: { __lastModified: '2026-07-29T12:00:00.000Z' } },
      { id: 'r3', fields: { __lastModified: '2026-07-29T11:00:00.000Z' } },
    ],
  }));
  const out = await c.listModifiedSince('2026-07-29T09:00:00.000Z');
  assert.equal(out.nextCursor, '2026-07-29T12:00:00.000Z',
    'using "now" here would skip a record written while the page was in flight');
});

test('the cursor is preserved when a cycle returns nothing', async () => {
  const c = mk(async () => res({ records: [] }));
  const out = await c.listModifiedSince('2026-07-29T09:00:00.000Z');
  assert.equal(out.nextCursor, '2026-07-29T09:00:00.000Z');
});

// ── pagination bounds ────────────────────────────────────────────────────────

test('pagination follows offsets but is BOUNDED, and says so', async () => {
  let calls = 0;
  const c = mk(async () => { calls++; return res({ records: [{ id: `r${calls}`, fields: {} }], offset: 'more' }); }, { maxPages: 3 });
  const out = await c.listModifiedSince(null);
  assert.equal(calls, 3, 'a bad cursor cannot walk the whole base');
  assert.equal(out.pages, 3);
  assert.equal(out.truncated, true, 'a capped cycle is visible, not mistaken for complete');
});

// ── rate limits and failures ─────────────────────────────────────────────────

test('429 is retried with the server’s Retry-After, then succeeds', async () => {
  let n = 0;
  const c = mk(async () => {
    n++;
    return n === 1 ? res({}, { status: 429, headers: { 'retry-after': '0' } }) : res({ records: [] });
  });
  const out = await c.listModifiedSince(null);
  assert.equal(n, 2);
  assert.deepEqual(out.records, []);
});

test('persistent 429 eventually surfaces rather than looping forever', async () => {
  const c = mk(async () => res({}, { status: 429, headers: { 'retry-after': '0' } }));
  await assert.rejects(() => c.listModifiedSince(null), (e) => e instanceof AirtableRateLimit);
});

test('5xx is retried; 4xx is PERMANENT and never retried', async () => {
  let n = 0;
  const ok = mk(async () => { n++; return n === 1 ? res({}, { status: 503 }) : res({ records: [] }); });
  await ok.listModifiedSince(null);
  assert.equal(n, 2);

  let m = 0;
  const bad = mk(async () => { m++; return res({ error: 'NOT_FOUND' }, { status: 404 }); });
  await assert.rejects(() => bad.listModifiedSince(null), (e) => e.permanent === true);
  assert.equal(m, 1, 'a permanent failure must not burn quota on retries');
});

test('backoff grows and is jittered so parallel pollers do not retry in lockstep', () => {
  const a = backoffMs(0), b = backoffMs(3);
  assert.ok(a >= 500 && a <= 1000);
  assert.ok(b > a);
  assert.ok(backoffMs(20) <= 30_000, 'capped');
  const samples = new Set(Array.from({ length: 20 }, () => backoffMs(3)));
  assert.ok(samples.size > 1, 'jittered');
});

// ── the safety ceiling ───────────────────────────────────────────────────────

test('the API ceiling stops a runaway BEFORE it exhausts quota', async () => {
  const budget = { used: 0, ceiling: 3 };
  const c = mk(async () => res({ records: [], offset: 'more' }), { budget, maxPages: 100 });
  await assert.rejects(() => c.listModifiedSince(null), (e) => e.code === 'API_CEILING');
  assert.equal(budget.used, 3, 'it stops AT the ceiling, not past it');
});

// ── formula safety ───────────────────────────────────────────────────────────

test('formula values are escaped', () => {
  assert.equal(escapeFormulaValue("it's"), "it\\'s");
  assert.equal(escapeFormulaValue('a\\b'), 'a\\\\b');
  assert.match(modifiedSinceFormula("2026'X"), /IS_AFTER\(LAST_MODIFIED_TIME\(\), '2026\\'X'\)/);
  assert.equal(modifiedSinceFormula(null), null);
});

// ── configuration ────────────────────────────────────────────────────────────

test('an unconfigured Airtable yields NO client, not a permanently failing one', () => {
  assert.equal(airtableClientFromEnv({}), null);
  assert.equal(airtableClientFromEnv({ AIRTABLE_PERSONAL_ACCESS_TOKEN: 't' }), null);
  const c = airtableClientFromEnv({ AIRTABLE_PERSONAL_ACCESS_TOKEN: 't', AIRTABLE_MAIN_BASE_ID: 'app1' });
  assert.ok(c);
  assert.equal(c.tableId, 'tblTI7iaGm6qsQA4a', 'defaults to the real tours table');
});

test('the tours table is overridable without a code change', () => {
  const c = airtableClientFromEnv({
    AIRTABLE_PERSONAL_ACCESS_TOKEN: 't', AIRTABLE_MAIN_BASE_ID: 'app1', MIRROR_AIRTABLE_TOURS_TABLE: 'tblOTHER',
  });
  assert.equal(c.tableId, 'tblOTHER');
});

test('the token never appears in a thrown message', async () => {
  const c = createAirtableClient({
    token: 'SUPER_SECRET_TOKEN', baseId: 'app1', tableId: 'tbl1',
    fetchImpl: async () => res({ error: 'bad' }, { status: 403 }),
  });
  await assert.rejects(() => c.listModifiedSince(null), (e) => !String(e.message).includes('SUPER_SECRET_TOKEN'));
});
