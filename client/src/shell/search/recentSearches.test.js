import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENTS_LIMIT,
  recentsKey,
  loadRecents,
  recordRecent,
  removeRecent,
  clearRecents,
} from './recentSearches.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('records most-recent-first and persists via storage', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', 'דנה כהן', 'name_he');
  recordRecent(s, 'dor', '0501234567', 'phone');
  const items = loadRecents(s, 'dor');
  assert.deepEqual(items.map((i) => i.q), ['0501234567', 'דנה כהן']);
  assert.equal(items[0].kind, 'phone');
});

test('empty and one-character searches are ignored', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', '', 'invalid');
  recordRecent(s, 'dor', '  ', 'invalid');
  recordRecent(s, 'dor', 'א', 'invalid');
  assert.deepEqual(loadRecents(s, 'dor'), []);
});

test('duplicates collapse; re-using an older search moves it back to the top', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', 'דנה', 'name_he');
  recordRecent(s, 'dor', 'יוסי', 'name_he');
  recordRecent(s, 'dor', 'דנה', 'name_he'); // reuse → top, no duplicate
  const items = loadRecents(s, 'dor');
  assert.deepEqual(items.map((i) => i.q), ['דנה', 'יוסי']);
});

test('dedupe is case-insensitive on the folded text', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', 'Dana Cohen', 'name_en');
  recordRecent(s, 'dor', 'dana cohen', 'name_en');
  const items = loadRecents(s, 'dor');
  assert.equal(items.length, 1);
  assert.equal(items[0].q, 'dana cohen');
});

test('the list is capped at RECENTS_LIMIT, dropping the oldest', () => {
  const s = fakeStorage();
  for (let i = 1; i <= RECENTS_LIMIT + 3; i += 1) {
    recordRecent(s, 'dor', `חיפוש ${i}`, 'name_he');
  }
  const items = loadRecents(s, 'dor');
  assert.equal(items.length, RECENTS_LIMIT);
  assert.equal(items[0].q, `חיפוש ${RECENTS_LIMIT + 3}`);
  assert.equal(items.at(-1).q, 'חיפוש 4');
});

test('removeRecent removes exactly one; clearRecents removes everything', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', 'דנה', 'name_he');
  recordRecent(s, 'dor', 'יוסי', 'name_he');
  removeRecent(s, 'dor', 'דנה');
  assert.deepEqual(loadRecents(s, 'dor').map((i) => i.q), ['יוסי']);
  clearRecents(s, 'dor');
  assert.deepEqual(loadRecents(s, 'dor'), []);
});

test('history is namespaced per operator — one user never sees another user\'s', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', 'דנה', 'name_he');
  assert.deepEqual(loadRecents(s, 'other'), []);
  assert.notEqual(recentsKey('dor'), recentsKey('other'));
});

test('stores only text + kind + timestamp — no result contents', () => {
  const s = fakeStorage();
  recordRecent(s, 'dor', '0501234567', 'phone');
  const raw = JSON.parse(s.getItem(recentsKey('dor')));
  assert.deepEqual(Object.keys(raw.items[0]).sort(), ['at', 'kind', 'q']);
});

test('corrupted or version-mismatched payloads degrade to an empty list', () => {
  const s = fakeStorage();
  s.setItem(recentsKey('dor'), 'not-json{');
  assert.deepEqual(loadRecents(s, 'dor'), []);
  s.setItem(recentsKey('dor'), JSON.stringify({ v: 99, items: [{ q: 'דנה' }] }));
  assert.deepEqual(loadRecents(s, 'dor'), []);
});

test('a throwing storage degrades gracefully instead of crashing', () => {
  const s = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(loadRecents(s, 'dor'), []);
  assert.deepEqual(recordRecent(s, 'dor', 'דנה', 'name_he').map((i) => i.q), ['דנה']);
  assert.deepEqual(clearRecents(s, 'dor'), []);
});
