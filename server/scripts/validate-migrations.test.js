// Tests for the migration SQL validator (validateSqlText). Real PG grammar +
// the catalog-free column/value count check. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSqlText } from './validate-migrations.mjs';

test('balanced INSERT ... SELECT passes', async () => {
  const p = await validateSqlText('INSERT INTO "t" (a, b) SELECT 1, 2;');
  assert.deepEqual(p, []);
});

test('column/value mismatch in INSERT ... SELECT is caught (the 42601 class)', async () => {
  const p = await validateSqlText('INSERT INTO "t" (a, b, c) SELECT 1, 2;');
  assert.equal(p.length, 1);
  assert.match(p[0], /3 target columns but 2 values/);
});

test('the exact original bug is caught: active column with no value', async () => {
  // 12 columns, 11 values — the shape that failed on production.
  const sql = `INSERT INTO "SharedContent"
    (id, type, "internalName", "bodyHe", "bodyEn", "imageId", "locationId", "isLocationDefault", active, "sortOrder", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, 'meeting_point', 'n', 'h', 'e', null, 'loc', true, 0, now(), now() FROM "Location";`;
  const p = await validateSqlText(sql);
  assert.equal(p.length, 1);
  assert.match(p[0], /12 target columns but 11 values/);
});

test('balanced VALUES passes; mismatched VALUES is caught', async () => {
  assert.deepEqual(await validateSqlText('INSERT INTO "t" (a, b) VALUES (1, 2);'), []);
  const bad = await validateSqlText('INSERT INTO "t" (a, b, c) VALUES (1, 2);');
  assert.equal(bad.length, 1);
  assert.match(bad[0], /3 target columns but 2 values/);
});

test('obvious SQL syntax errors are reported', async () => {
  const p = await validateSqlText('INSERT INTO (;');
  assert.equal(p.length, 1);
  assert.match(p[0], /syntax error/i);
});

test('data-modifying CTE (parent+child insert) — balanced passes', async () => {
  const sql = `WITH src AS MATERIALIZED (
      SELECT v.id AS vid, gen_random_uuid()::text AS sc FROM "ProductVariant" v
    ),
    ins AS (
      INSERT INTO "SharedContent" (id, type, "internalName") SELECT sc, 'meeting_point', 'n' FROM src RETURNING id
    )
    INSERT INTO "ProductVariantSharedContent" (id, "productVariantId", "sharedContentId")
    SELECT gen_random_uuid()::text, vid, sc FROM src;`;
  assert.deepEqual(await validateSqlText(sql), []);
});

test('data-modifying CTE with an inner mismatch is caught', async () => {
  const sql = `WITH ins AS (
      INSERT INTO "SharedContent" (id, type, "internalName") SELECT gen_random_uuid()::text, 'x' FROM "Location" RETURNING id
    )
    SELECT 1;`;
  const p = await validateSqlText(sql);
  assert.equal(p.length, 1);
  assert.match(p[0], /3 target columns but 2 values/);
});

test('INSERT without an explicit column list is skipped (cannot compare)', async () => {
  assert.deepEqual(await validateSqlText('INSERT INTO "t" SELECT 1, 2, 3;'), []);
});

test('pure DDL (CREATE TABLE) passes', async () => {
  assert.deepEqual(await validateSqlText('CREATE TABLE "t" ("id" TEXT NOT NULL, CONSTRAINT "t_pkey" PRIMARY KEY ("id"));'), []);
});
