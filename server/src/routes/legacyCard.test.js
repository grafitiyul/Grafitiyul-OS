// Legacy-info card route ("מידע ממערכת קודמת") — pure unit tests + structural
// guards, following the repo's no-DB route-test pattern (node:test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_ENTITY_TYPES, parseLegacyCardQuery, legacyRecordDto } from './legacyCard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(HERE, p), 'utf8');

// ── entityType validation (→ 400 in the route) ──────────────────────────────

test('the entityType vocabulary is exactly the LegacyRecord loose-link kinds', () => {
  assert.deepEqual(VALID_ENTITY_TYPES, ['Deal', 'Contact', 'Organization', 'TourEvent']);
});

test('valid queries parse to a trimmed { entityType, entityId }', () => {
  for (const entityType of VALID_ENTITY_TYPES) {
    const parsed = parseLegacyCardQuery({ entityType, entityId: ' abc123 ' });
    assert.deepEqual(parsed, { entityType, entityId: 'abc123' });
  }
});

test('unknown / missing / lowercase entityType is rejected', () => {
  for (const entityType of ['deal', 'Person', 'organization', '', undefined, 'LegacyRecord']) {
    assert.deepEqual(parseLegacyCardQuery({ entityType, entityId: 'x' }), {
      error: 'invalid_entity_type',
    });
  }
});

test('missing / blank entityId is rejected', () => {
  assert.deepEqual(parseLegacyCardQuery({ entityType: 'Deal' }), { error: 'invalid_entity_id' });
  assert.deepEqual(parseLegacyCardQuery({ entityType: 'Deal', entityId: '   ' }), {
    error: 'invalid_entity_id',
  });
});

// ── Response shape ──────────────────────────────────────────────────────────

test('the record DTO is the exact 4-field whitelist — the raw payload can never leak', () => {
  const row = {
    id: 'row1',
    sourceSystem: 'pipedrive',
    sourceType: 'deal',
    sourceId: '4711',
    cardData: [{ label: 'בעלים', value: 'דור' }],
    payload: { secret: 'raw archive — must never be returned' },
    entityType: 'Deal',
    entityId: 'd1',
  };
  const dto = legacyRecordDto(row);
  assert.deepEqual(dto, {
    sourceSystem: 'pipedrive',
    sourceType: 'deal',
    sourceId: '4711',
    cardData: [{ label: 'בעלים', value: 'דור' }],
  });
  assert.deepEqual(Object.keys(dto).sort(), ['cardData', 'sourceId', 'sourceSystem', 'sourceType']);
});

// ── Structural guards (same style as the migration boundary tests) ──────────

test('the route only READS the crosswalk and never selects the raw payload', () => {
  const src = read('./legacyCard.js');
  for (const m of src.matchAll(/legacyRecord\.(\w+)\s*\(/g)) {
    assert.ok(/^(findMany|findFirst|findUnique|count)$/.test(m[1]),
      `legacyRecord.${m[1]}() is forbidden — this surface is read-only`);
  }
  assert.ok(!/payload\s*:\s*true/.test(src), 'the raw payload column is never selected');
});

test('index.js mounts /api/legacy-card behind requireAdminAuth (sibling pattern)', () => {
  const index = read('../index.js');
  assert.match(index, /app\.use\('\/api\/legacy-card', requireAdminAuth, legacyCardRouter\)/);
});
