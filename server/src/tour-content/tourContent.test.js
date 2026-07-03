import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAssetSource,
  computeReorder,
  reqStr,
  optStr,
  optBool,
  STATION_KINDS,
  ASSET_TYPES,
} from './tourContent.js';

// These cover the pure business rules that don't need a database: the asset
// url/mediaId invariant, reorder id-set validation, and payload coercion.

test('normalizeAssetSource: url only → keeps url, nulls mediaId', () => {
  assert.deepEqual(normalizeAssetSource({ url: 'https://vimeo.com/1' }), {
    url: 'https://vimeo.com/1',
    mediaId: null,
  });
});

test('normalizeAssetSource: mediaId only → keeps mediaId, nulls url', () => {
  assert.deepEqual(normalizeAssetSource({ mediaId: 'mf_123' }), {
    url: null,
    mediaId: 'mf_123',
  });
});

test('normalizeAssetSource: both present → conflict', () => {
  assert.throws(() => normalizeAssetSource({ url: 'https://x', mediaId: 'mf_1' }), /asset_source_conflict/);
});

test('normalizeAssetSource: neither present → required', () => {
  assert.throws(() => normalizeAssetSource({}), /asset_source_required/);
  assert.throws(() => normalizeAssetSource({ url: '  ', mediaId: '' }), /asset_source_required/);
});

test('normalizeAssetSource: trims whitespace', () => {
  assert.deepEqual(normalizeAssetSource({ url: '  https://x  ' }), { url: 'https://x', mediaId: null });
});

test('computeReorder: reindexes to 0..n by given order', () => {
  const out = computeReorder(['b', 'a', 'c'], ['a', 'b', 'c']);
  assert.deepEqual(out, [
    { id: 'b', sortOrder: 0 },
    { id: 'a', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ]);
});

test('computeReorder: length mismatch → order_mismatch', () => {
  assert.throws(() => computeReorder(['a', 'b'], ['a', 'b', 'c']), /order_mismatch/);
});

test('computeReorder: unknown id → order_mismatch', () => {
  assert.throws(() => computeReorder(['a', 'x', 'c'], ['a', 'b', 'c']), /order_mismatch/);
});

test('computeReorder: duplicate id → order_duplicate', () => {
  assert.throws(() => computeReorder(['a', 'a', 'c'], ['a', 'b', 'c']), /order_duplicate/);
});

test('computeReorder: non-array → invalid_order', () => {
  assert.throws(() => computeReorder('nope', ['a']), /invalid_order/);
});

test('reqStr: empty/blank/non-string throws the given code', () => {
  assert.throws(() => reqStr('', 'title_required'), /title_required/);
  assert.throws(() => reqStr('   ', 'title_required'), /title_required/);
  assert.throws(() => reqStr(undefined, 'title_required'), /title_required/);
  assert.equal(reqStr('  hi ', 'title_required'), 'hi');
});

test('optStr: undefined stays undefined; null→null; value→string', () => {
  assert.equal(optStr(undefined), undefined);
  assert.equal(optStr(null), null);
  assert.equal(optStr('x'), 'x');
});

test('optBool: undefined stays undefined; else coerced', () => {
  assert.equal(optBool(undefined), undefined);
  assert.equal(optBool('true'), true);
  assert.equal(optBool(0), false);
});

test('domain constant sets are the V1 vocab', () => {
  assert.deepEqual([...STATION_KINDS], ['location', 'artwork', 'printed_material', 'content_stop']);
  assert.deepEqual([...ASSET_TYPES], ['video', 'image', 'file', 'link']);
});
