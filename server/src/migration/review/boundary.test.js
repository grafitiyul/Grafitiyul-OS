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

test('the Review Center never writes production entities or LegacyRecords', () => {
  const forbidden = /prisma\.(deal|contact|organization|tourEvent|booking|task|timelineEntry|person|legacyRecord)\b|client\.(deal|contact|organization|tourEvent|booking|task|timelineEntry|person|legacyRecord)\b/i;
  for (const f of reviewFiles) {
    const src = read(path.join('src/migration/review', f));
    assert.ok(!forbidden.test(src), `${f} must not touch production models or LegacyRecord`);
  }
  const router = read('src/routes/migrationReview.js');
  assert.ok(!forbidden.test(router.replace(/prisma\.adminUser[^;]*/g, '')), 'router only reads adminUser for the audit name');
  // The only mutations anywhere are on the decision ledger.
  const service = read('src/migration/review/service.js');
  const mutations = service.match(/\.(create|update|upsert|delete|deleteMany|createMany|updateMany)\(/g) || [];
  assert.ok(mutations.length > 0, 'the ledger is written');
  assert.ok(/migrationDecision\.upsert|migrationDecision\.update/.test(service));
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
    'GET /queues/:queue', 'GET /snapshot', 'GET /summary',
    'POST /decisions/:id/decide', 'POST /seed',
  ]);
  // Every write route is a decision-ledger route — nothing else mutates.
  const writes = routes.filter((r) => r.startsWith('POST'));
  assert.deepEqual(writes.sort(), ['POST /decisions/:id/decide', 'POST /seed']);
});

test('the deletion boundary is a single mount line', () => {
  const mount = read('src/routes/migration.js');
  assert.ok(/router\.use\('\/review', migrationReviewRouter\)/.test(mount), 'one mount line');
  assert.ok(/DELETION BOUNDARY/.test(mount), 'boundary documented at the seam');
  // Nothing outside the migration surface may import the Review Center.
  const index = read('src/index.js');
  assert.ok(!/migrationReview|migration\/review/.test(index), 'server entrypoint does not know about the Center');
});
