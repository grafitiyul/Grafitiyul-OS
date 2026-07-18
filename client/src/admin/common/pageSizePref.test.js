import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  clampPageSize,
  loadPageSize,
  savePageSize,
} from './pageSizePref.js';

// Minimal in-memory stand-in for window.localStorage (only get/setItem used).
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

test('clampPageSize: allowed values pass through unchanged', () => {
  for (const s of PAGE_SIZES) assert.equal(clampPageSize(s), s);
});

test('clampPageSize: string numerics are coerced', () => {
  assert.equal(clampPageSize('50'), 50);
  assert.equal(clampPageSize('100'), 100);
});

test('clampPageSize: out-of-set values snap to nearest allowed', () => {
  assert.equal(clampPageSize(14), 20); // legacy Deals PAGE_SIZE → nearest
  assert.equal(clampPageSize(30), 20); // tie 20/50 → smaller
  assert.equal(clampPageSize(40), 50); // 40 nearer 50 than 20
  assert.equal(clampPageSize(1000), 200); // above max → cap
  assert.equal(clampPageSize(1), 20); // below min → floor
});

test('clampPageSize: junk falls back to the default (or given fallback)', () => {
  assert.equal(clampPageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize('abc'), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize('abc', 100), 100);
  assert.equal(clampPageSize('abc', 999), DEFAULT_PAGE_SIZE); // bad fallback → default
});

test('loadPageSize: reads and clamps a stored value', () => {
  const s = fakeStorage({ 'deals.pageSize.v1': '100' });
  assert.equal(loadPageSize(s, 'deals.pageSize.v1'), 100);
});

test('loadPageSize: missing key yields the default', () => {
  const s = fakeStorage();
  assert.equal(loadPageSize(s, 'nope'), DEFAULT_PAGE_SIZE);
  assert.equal(loadPageSize(s, 'nope', 20), 20);
});

test('loadPageSize: stale/unknown stored value is clamped, never trusted', () => {
  const s = fakeStorage({ k: '14' });
  assert.equal(loadPageSize(s, 'k'), 20);
});

test('loadPageSize: absent storage (null) is safe', () => {
  assert.equal(loadPageSize(null, 'k'), DEFAULT_PAGE_SIZE);
});

test('savePageSize: clamps before persisting and returns the stored value', () => {
  const s = fakeStorage();
  assert.equal(savePageSize(s, 'k', 100), 100);
  assert.equal(s._map.get('k'), '100');
  assert.equal(savePageSize(s, 'k', 60), 50); // clamped to nearest on the way in
  assert.equal(s._map.get('k'), '50');
});

test('savePageSize: absent storage still returns a clamped value', () => {
  assert.equal(savePageSize(null, 'k', 100), 100);
});
