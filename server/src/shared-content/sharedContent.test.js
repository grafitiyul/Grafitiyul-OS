// Shared Content Library — Slice 1 tests. Pure: no DB. Exercises the resolution
// precedence, the "where used" shaping, and the Type vocabulary. Run with
// `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveForVariant, buildWhereUsed } from './sharedContent.js';
import {
  isValidSharedContentType,
  isSingleType,
  SHARED_CONTENT_TYPE_KEYS,
} from './sharedContentTypes.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
const block = (over = {}) => ({
  id: 'sc_1',
  type: 'meeting_point',
  internalName: 'מפגש פלורנטין',
  active: true,
  isLocationDefault: false,
  ...over,
});

// ── resolveForVariant: precedence ────────────────────────────────────────────

test('variant link wins over location default', () => {
  const linked = block({ id: 'sc_variant' });
  const def = block({ id: 'sc_loc', isLocationDefault: true });
  const r = resolveForVariant({ linkedRows: [linked], locationDefaults: [def] }, 'meeting_point');
  assert.equal(r.block.id, 'sc_variant');
  assert.equal(r.via, 'variant');
});

test('falls back to the location default when the variant has no link', () => {
  const def = block({ id: 'sc_loc', isLocationDefault: true });
  const r = resolveForVariant({ linkedRows: [], locationDefaults: [def] }, 'meeting_point');
  assert.equal(r.block.id, 'sc_loc');
  assert.equal(r.via, 'location_default');
});

test('a location row that is NOT the default is ignored', () => {
  const def = block({ id: 'sc_loc', isLocationDefault: false });
  const r = resolveForVariant({ linkedRows: [], locationDefaults: [def] }, 'meeting_point');
  assert.equal(r.block, null);
  assert.equal(r.via, null);
});

test('returns null when nothing matches (caller warns)', () => {
  const r = resolveForVariant({ linkedRows: [], locationDefaults: [] }, 'ending_point');
  assert.deepEqual(r, { block: null, via: null });
});

test('matches strictly by type', () => {
  const ending = block({ id: 'sc_end', type: 'ending_point' });
  const r = resolveForVariant({ linkedRows: [ending], locationDefaults: [] }, 'meeting_point');
  assert.equal(r.block, null);
});

test('an archived (inactive) linked row is skipped', () => {
  const inactive = block({ id: 'sc_off', active: false });
  const def = block({ id: 'sc_loc', isLocationDefault: true });
  const r = resolveForVariant({ linkedRows: [inactive], locationDefaults: [def] }, 'meeting_point');
  assert.equal(r.block.id, 'sc_loc');
  assert.equal(r.via, 'location_default');
});

// ── buildWhereUsed: safety report ────────────────────────────────────────────

const linkRow = (over = {}) => ({
  productVariant: {
    id: 'pv_1',
    productId: 'p_1',
    locationId: 'l_1',
    active: true,
    product: { nameHe: 'סיור', nameEn: 'Tour' },
    location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
    ...over,
  },
});

test('where-used counts and shapes consumers', () => {
  const out = buildWhereUsed([linkRow(), linkRow({ id: 'pv_2', product: { nameHe: 'אחר', nameEn: 'Other' }, location: { nameHe: 'חיפה' } })], 'he');
  assert.equal(out.count, 2);
  assert.equal(out.consumers[0].kind, 'product_variant');
  assert.equal(out.consumers[0].items.length, 2);
  assert.equal(out.consumers[0].items[0].productName, 'אחר'); // sorted by name
});

test('where-used honours language for names', () => {
  const out = buildWhereUsed([linkRow()], 'en');
  assert.equal(out.consumers[0].items[0].productName, 'Tour');
  assert.equal(out.consumers[0].items[0].locationName, 'Tel Aviv');
});

test('where-used drops rows with no variant (defensive)', () => {
  const out = buildWhereUsed([{ productVariant: null }], 'he');
  assert.equal(out.count, 0);
});

test('empty where-used is a valid zero report', () => {
  const out = buildWhereUsed([], 'he');
  assert.equal(out.count, 0);
  assert.equal(out.consumers[0].items.length, 0);
});

// ── Type vocabulary ──────────────────────────────────────────────────────────

test('type vocabulary validates known keys and rejects unknown', () => {
  assert.equal(isValidSharedContentType('meeting_point'), true);
  assert.equal(isValidSharedContentType('ending_point'), true);
  assert.equal(isValidSharedContentType('nope'), false);
});

test('cardinality: meeting/ending are single, safety is a list', () => {
  assert.equal(isSingleType('meeting_point'), true);
  assert.equal(isSingleType('ending_point'), true);
  assert.equal(isSingleType('safety'), false);
});

test('the V1 first-consumer types exist in the vocabulary', () => {
  assert.ok(SHARED_CONTENT_TYPE_KEYS.includes('meeting_point'));
  assert.ok(SHARED_CONTENT_TYPE_KEYS.includes('ending_point'));
});
