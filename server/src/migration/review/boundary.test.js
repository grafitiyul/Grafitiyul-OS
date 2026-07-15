// Structural guards for the TEMPORARY Review Center:
//  * it can never call Pipedrive/Airtable,
//  * it never imports or mutates production entities,
//  * it stays inside one clearly deletable boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../../..');
const read = (p) => readFileSync(path.join(SERVER, p), 'utf8');
const reviewFiles = readdirSync(HERE).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

test('the Review Center can make NO Pipedrive or Airtable API calls', () => {
  const sources = [...reviewFiles.map((f) => read(path.join('src/migration/review', f))), read('src/routes/migrationReview.js')];
  for (const src of sources) {
    assert.ok(!/sources\/pipedrive|sources\/airtable/.test(src), 'never imports a legacy API source');
    assert.ok(!/pipedriveClient|airtableClient|dealProductsBulk/.test(src), 'never constructs a legacy API client');
    assert.ok(!/api\.pipedrive\.com|pipedrive\.com\/api|api\.airtable\.com/.test(src), 'no legacy API URLs');
    assert.ok(!/runSnapshot|run-snapshot/.test(src), 'cannot trigger an extraction run');
  }
});

// Enumerate EVERY prisma write and assert the model is the decision ledger.
// Deliberately not a `\b` deny-list: that silently misses `organizationUnit` /
// `organizationType` (no word boundary after "organization").
const WRITE = /\b(?:prisma|client|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
const ALLOWED_WRITE_MODELS = new Set(['migrationDecision']);

test('the ONLY prisma writes anywhere in the Review Center are on the decision ledger', () => {
  const files = [
    ...reviewFiles.map((f) => ['src/migration/review/' + f, read(path.join('src/migration/review', f))]),
    ['src/routes/migrationReview.js', read('src/routes/migrationReview.js')],
    // The one-off proposal pass writes proposals — it is held to the same rule.
    ['scripts/migration/build-org-proposals.mjs', read('scripts/migration/build-org-proposals.mjs')],
    ['scripts/migration/build-snapshot-index.mjs', read('scripts/migration/build-snapshot-index.mjs')],
  ];
  let seenLedgerWrite = false;
  for (const [name, src] of files) {
    for (const m of src.matchAll(WRITE)) {
      const [, model] = m;
      assert.ok(ALLOWED_WRITE_MODELS.has(model), `${name} writes prisma.${model}.${m[2]}() — only the decision ledger may be written`);
      seenLedgerWrite = true;
    }
  }
  assert.ok(seenLedgerWrite, 'the ledger IS written (the guard is actually matching writes)');
});

test('no LegacyRecord is ever created, and production reads stay read-only', () => {
  const files = [
    ...reviewFiles.map((f) => ['review/' + f, read(path.join('src/migration/review', f))]),
    ['routes/migrationReview.js', read('src/routes/migrationReview.js')],
    ['scripts/build-org-proposals.mjs', read('scripts/migration/build-org-proposals.mjs')],
  ];
  for (const [name, src] of files) {
    // LegacyRecord may only ever be COUNTED (an invariant check), never written.
    for (const m of src.matchAll(/legacyRecord\.(\w+)\s*\(/g)) {
      assert.equal(m[1], 'count', `${name}: legacyRecord.${m[1]}() is forbidden — Slice 4 creates no LegacyRecords`);
    }
    // Production models may only be READ (findMany/findFirst/findUnique/count).
    for (const m of src.matchAll(/\b(?:prisma|client)\.(organization|organizationUnit|organizationType|deal|contact|tourEvent|booking|task|timelineEntry|person)\.(\w+)\s*\(/g)) {
      assert.ok(/^(findMany|findFirst|findUnique|count)$/.test(m[2]), `${name}: prisma.${m[1]}.${m[2]}() must be a read`);
    }
  }
});

test('no "finalize import" action exists yet — readiness is only REPORTED', () => {
  // Strip comments first: the guard must judge CODE, not prose about the guard.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sources = [...reviewFiles.map((f) => read(path.join('src/migration/review', f))), read('src/routes/migrationReview.js')];
  for (const raw of sources) {
    // `readyToFinalize` is a read-only boolean the UI renders; it is not an action.
    const code = stripComments(raw).replace(/readyToFinalize/g, '');
    assert.ok(!/finalize|commitImport|runImport|startImport/i.test(code), 'no finalize/import action in code');
  }
  // And no route exposes one. The full surface is locked: adding an endpoint must
  // be a deliberate act, not an accident.
  const router = stripComments(read('src/routes/migrationReview.js'));
  const routes = [...router.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  assert.deepEqual(routes.sort(), [
    'GET /browser/entities', 'GET /browser/filter', 'GET /browser/record', 'GET /browser/records',
    'GET /org-targets', 'GET /queues/:queue', 'GET /snapshot', 'GET /summary',
    'POST /decisions/:id/decide', 'POST /queues/:queue/batch-approve-safe', 'POST /seed',
  ]);
  // Every write route is a decision-ledger route — nothing else mutates.
  const writes = routes.filter((r) => r.startsWith('POST'));
  assert.deepEqual(writes.sort(), [
    'POST /decisions/:id/decide', 'POST /queues/:queue/batch-approve-safe', 'POST /seed',
  ]);
});

test('the deletion boundary is a single mount line', () => {
  const mount = read('src/routes/migration.js');
  assert.ok(/router\.use\('\/review', migrationReviewRouter\)/.test(mount), 'one mount line');
  assert.ok(/DELETION BOUNDARY/.test(mount), 'boundary documented at the seam');
  // Nothing outside the migration surface may import the Review Center.
  const index = read('src/index.js');
  assert.ok(!/migrationReview|migration\/review/.test(index), 'server entrypoint does not know about the Center');
});
