// Structural safety guards for the one-time migration extraction.
// These encode the post-incident invariants: extraction is off by default, no
// request can bypass the budget guard, and nothing can auto-resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractionEnabled, maxPipedriveRequests } from './config.js';
import { pipedriveClient } from './sources/pipedrive.js';
import { RequestBudget } from './budget.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../..');
const read = (p) => readFileSync(path.join(SERVER, p), 'utf8');

test('extraction is DISABLED by default; only the exact string "true" enables it', () => {
  const prev = process.env.MIGRATION_EXTRACTION_ENABLED;
  try {
    delete process.env.MIGRATION_EXTRACTION_ENABLED;
    assert.equal(extractionEnabled(), false, 'unset ⇒ disabled');
    for (const v of ['', 'false', '0', 'yes', 'TRUE ', 'enabled']) {
      process.env.MIGRATION_EXTRACTION_ENABLED = v;
      assert.equal(extractionEnabled(), v.trim().toLowerCase() === 'true', `"${v}"`);
    }
    process.env.MIGRATION_EXTRACTION_ENABLED = 'true';
    assert.equal(extractionEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.MIGRATION_EXTRACTION_ENABLED;
    else process.env.MIGRATION_EXTRACTION_ENABLED = prev;
  }
});

test('a run ceiling must be a positive integer, else null (caller must refuse)', () => {
  const prev = process.env.MIGRATION_MAX_REQUESTS;
  try {
    for (const [v, want] of [[undefined, null], ['', null], ['0', null], ['-5', null], ['abc', null], ['1800', 1800]]) {
      if (v === undefined) delete process.env.MIGRATION_MAX_REQUESTS;
      else process.env.MIGRATION_MAX_REQUESTS = v;
      assert.equal(maxPipedriveRequests(), want, String(v));
    }
  } finally {
    if (prev === undefined) delete process.env.MIGRATION_MAX_REQUESTS;
    else process.env.MIGRATION_MAX_REQUESTS = prev;
  }
});

test('the Pipedrive client CANNOT be constructed without a budget guard', () => {
  process.env.PIPEDRIVE_API_TOKEN ||= 't';
  process.env.PIPEDRIVE_COMPANY_DOMAIN ||= 'co';
  assert.throws(() => pipedriveClient({}), /requires_budget/);
  assert.throws(() => pipedriveClient({ budget: {} }), /requires_budget/);
});

test('the budget is checked BEFORE every request — the ceiling stops fetch', async () => {
  process.env.PIPEDRIVE_API_TOKEN ||= 't';
  process.env.PIPEDRIVE_COMPANY_DOMAIN ||= 'co';
  let fetches = 0;
  const budget = new RequestBudget({ limit: 2 });
  const client = pipedriveClient({
    throttleMs: 0, budget,
    fetchImpl: async () => { fetches++; return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ data: [], additional_data: { pagination: { more_items_in_collection: false } } }) }; },
  });
  await client.page('/deals', {}, 0);
  await client.page('/deals', {}, 0);
  await assert.rejects(() => client.page('/deals', {}, 0), (e) => e.code === 'RUN_LIMIT_REACHED');
  assert.equal(fetches, 2, 'the third request never reached the network');
});

test('the retired per-deal deal-products path no longer exists', () => {
  const src = read('src/migration/sources/pipedrive.js');
  assert.ok(!/dealProducts\s*\(\s*dealId\s*\)/.test(src), 'no per-deal dealProducts(dealId) method');
  assert.ok(!/\/deals\/\$\{dealId\}\/products/.test(src), 'no per-deal /deals/{id}/products URL');
  assert.ok(/\/deals\/products/.test(src) && /deal_ids/.test(src), 'uses the v2 bulk endpoint');
  const run = read('src/migration/snapshotRun.js');
  assert.ok(!/pdPerDeal/.test(run), 'the pdPerDeal executor kind is gone');
  assert.ok(/pdBulkProducts/.test(run), 'bulk products executor present');
});

test('NO automatic resume: the server never invokes the extractor and nothing schedules it', () => {
  const index = read('src/index.js');
  assert.ok(!/runSnapshot|run-snapshot|snapshotRun/.test(index), 'server does not import/run the extractor');
  for (const f of ['src/migration/snapshotRun.js', 'src/migration/r2.js', 'src/migration/status.js', 'src/migration/budget.js']) {
    const src = read(f);
    assert.ok(!/setInterval\(/.test(src), `${f} has no interval timer`);
    assert.ok(!/node-cron|cron\.schedule|scheduleJob/.test(src), `${f} has no scheduler`);
  }
  const routes = read('src/routes/migration.js');
  assert.ok(!/runSnapshot|pipedriveClient/.test(routes), 'the admin route cannot trigger extraction');
});

test('CLI refuses to run — and makes ZERO calls — when extraction is disabled', () => {
  const env = {
    ...process.env,
    MIGRATION_R2_ACCOUNT_ID: 'x', MIGRATION_R2_ACCESS_KEY_ID: 'x', MIGRATION_R2_SECRET_ACCESS_KEY: 'x', MIGRATION_R2_BUCKET: 'x',
    PIPEDRIVE_API_TOKEN: 'x', PIPEDRIVE_COMPANY_DOMAIN: 'x',
    AIRTABLE_PERSONAL_ACCESS_TOKEN: 'x', AIRTABLE_MAIN_BASE_ID: 'x', AIRTABLE_LEGACY_BASE_ID: 'x',
    MIGRATION_MAX_REQUESTS: '1800',
  };
  delete env.MIGRATION_EXTRACTION_ENABLED;
  const r = spawnSync(process.execPath, ['scripts/migration/run-snapshot.mjs', '--snapshot', 'snap-test'], { cwd: SERVER, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2, 'exit code 2 = refused');
  assert.match(r.stderr, /extraction is disabled/i);
  assert.match(r.stderr, /Zero Pipedrive calls made/i);
});

test('CLI refuses without a declared request ceiling', () => {
  const env = {
    ...process.env,
    MIGRATION_R2_ACCOUNT_ID: 'x', MIGRATION_R2_ACCESS_KEY_ID: 'x', MIGRATION_R2_SECRET_ACCESS_KEY: 'x', MIGRATION_R2_BUCKET: 'x',
    PIPEDRIVE_API_TOKEN: 'x', PIPEDRIVE_COMPANY_DOMAIN: 'x',
    AIRTABLE_PERSONAL_ACCESS_TOKEN: 'x', AIRTABLE_MAIN_BASE_ID: 'x', AIRTABLE_LEGACY_BASE_ID: 'x',
    MIGRATION_EXTRACTION_ENABLED: 'true',
  };
  delete env.MIGRATION_MAX_REQUESTS;
  const r = spawnSync(process.execPath, ['scripts/migration/run-snapshot.mjs', '--snapshot', 'snap-test'], { cwd: SERVER, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /MIGRATION_MAX_REQUESTS/);
});

test('CLI refuses to mint a second snapshot by accident (--snapshot required)', () => {
  const env = {
    ...process.env,
    MIGRATION_R2_ACCOUNT_ID: 'x', MIGRATION_R2_ACCESS_KEY_ID: 'x', MIGRATION_R2_SECRET_ACCESS_KEY: 'x', MIGRATION_R2_BUCKET: 'x',
    PIPEDRIVE_API_TOKEN: 'x', PIPEDRIVE_COMPANY_DOMAIN: 'x',
    AIRTABLE_PERSONAL_ACCESS_TOKEN: 'x', AIRTABLE_MAIN_BASE_ID: 'x', AIRTABLE_LEGACY_BASE_ID: 'x',
    MIGRATION_EXTRACTION_ENABLED: 'true', MIGRATION_MAX_REQUESTS: '1800',
  };
  const r = spawnSync(process.execPath, ['scripts/migration/run-snapshot.mjs'], { cwd: SERVER, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--snapshot/);
});
