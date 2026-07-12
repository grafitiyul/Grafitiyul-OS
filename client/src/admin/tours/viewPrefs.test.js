import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTourDate, loadToursView, saveToursView } from './viewPrefs.js';

// Tours view persistence — the calendar ANCHOR must survive a refresh (the
// production regression), stored as a stable YYYY-MM-DD and validated on read.

// Minimal in-memory localStorage for node --test (no DOM here).
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

test('isValidTourDate: strict YYYY-MM-DD real dates only', () => {
  assert.equal(isValidTourDate('2026-10-14'), true);
  assert.equal(isValidTourDate('2026-01-01'), true);
  assert.equal(isValidTourDate('2026-13-40'), false, 'impossible month/day');
  assert.equal(isValidTourDate('2026-02-30'), false, 'JS date rollover rejected');
  assert.equal(isValidTourDate('2026-7-1'), false, 'must be zero-padded');
  assert.equal(isValidTourDate('14/10/2026'), false);
  assert.equal(isValidTourDate(''), false);
  assert.equal(isValidTourDate(null), false);
  assert.equal(isValidTourDate(undefined), false);
});

test('load: empty storage → table / month / null anchor (today fallback)', () => {
  const v = loadToursView();
  assert.deepEqual(v, { tab: 'table', calMode: 'month', calAnchor: null });
});

test('save → load round-trips the anchor exactly', () => {
  saveToursView({ tab: 'calendar', calMode: 'week', calAnchor: '2026-10-12' });
  assert.deepEqual(loadToursView(), {
    tab: 'calendar',
    calMode: 'week',
    calAnchor: '2026-10-12',
  });
});

test('load: an invalid stored anchor is dropped to null (never crashes the calendar)', () => {
  localStorage.setItem(
    'tours.view.v1',
    JSON.stringify({ tab: 'calendar', calMode: 'day', calAnchor: 'not-a-date' }),
  );
  const v = loadToursView();
  assert.equal(v.calAnchor, null);
  assert.equal(v.calMode, 'day', 'the valid mode still restores');
});

test('load: unknown tab/mode fall back safely', () => {
  localStorage.setItem(
    'tours.view.v1',
    JSON.stringify({ tab: 'nope', calMode: 'year', calAnchor: '2026-10-14' }),
  );
  const v = loadToursView();
  assert.equal(v.tab, 'table');
  assert.equal(v.calMode, 'month');
  assert.equal(v.calAnchor, '2026-10-14', 'a valid anchor survives even when mode is bad');
});

test('save: an invalid anchor is normalized to null, not persisted verbatim', () => {
  saveToursView({ tab: 'calendar', calMode: 'month', calAnchor: '2026-99-99' });
  assert.equal(loadToursView().calAnchor, null);
});

test('load: corrupt JSON → safe defaults', () => {
  localStorage.setItem('tours.view.v1', '{not json');
  assert.deepEqual(loadToursView(), { tab: 'table', calMode: 'month', calAnchor: null });
});
