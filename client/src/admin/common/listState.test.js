import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyListParams,
  clampPage,
  decodeListState,
  hasUrlState,
  listStateEquals,
  nextListState,
  pageCountOf,
  parseSort,
  formatSort,
  readSticky,
  writeSticky,
  stickyStorageKey,
} from './listState.js';
import {
  LIST_RETURN_KEY,
  findScrollParent,
  makeListReturn,
  readScrollTop,
  resolveListReturn,
  saveScrollTop,
  scrollKey,
} from './listNav.js';

// The rules behind "return to exactly where I was". These are the pure
// contracts every migrated list screen depends on.

const FIELDS = {
  q: { default: '', sticky: true },
  status: { default: 'all', sticky: true },
  sort: { type: 'sort', default: { key: 'updatedAt', dir: 'desc' }, sticky: true },
  page: { type: 'int', default: 1 },
  advanced: { type: 'json', default: null, sticky: true, url: false },
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// ── decode ──────────────────────────────────────────────────────────────────

test('URL wins over sticky, sticky wins over the declared default', () => {
  const params = new URLSearchParams('page=4&q=bank');
  const state = decodeListState(FIELDS, params, { q: 'ignored', status: 'won' });
  assert.equal(state.page, 4);
  assert.equal(state.q, 'bank');
  assert.equal(state.status, 'won'); // absent from the URL → sticky
  assert.deepEqual(state.sort, { key: 'updatedAt', dir: 'desc' }); // neither → default
});

test('an explicitly empty param is honoured, not re-filled from sticky', () => {
  const state = decodeListState(FIELDS, new URLSearchParams('q='), { q: 'old search' });
  assert.equal(state.q, '');
});

test('a garbage page never renders an impossible list', () => {
  for (const raw of ['0', '-3', 'abc', '']) {
    assert.equal(decodeListState(FIELDS, new URLSearchParams(`page=${raw}`)).page, 1);
  }
});

test('sort round-trips through the URL', () => {
  assert.deepEqual(parseSort('amount:asc'), { key: 'amount', dir: 'asc' });
  assert.deepEqual(parseSort('amount'), { key: 'amount', dir: 'desc' }); // dir defaults
  assert.equal(parseSort(''), null);
  assert.equal(formatSort({ key: 'amount', dir: 'asc' }), 'amount:asc');
  const state = decodeListState(FIELDS, new URLSearchParams('sort=amount:asc'));
  assert.deepEqual(state.sort, { key: 'amount', dir: 'asc' });
});

test('url:false fields never read from the URL — only from sticky', () => {
  const params = new URLSearchParams('advanced=%7B%22hacked%22%3Atrue%7D');
  const state = decodeListState(FIELDS, params, { advanced: { op: 'and' } });
  assert.deepEqual(state.advanced, { op: 'and' });
});

// ── hasUrlState: deep links are never contaminated by local preferences ──────

test('hasUrlState detects this list own params and ignores foreign ones', () => {
  assert.equal(hasUrlState(FIELDS, new URLSearchParams('page=2')), true);
  assert.equal(hasUrlState(FIELDS, new URLSearchParams('q=')), true);
  assert.equal(hasUrlState(FIELDS, new URLSearchParams('somethingElse=1')), false);
  assert.equal(hasUrlState(FIELDS, new URLSearchParams('')), false);
  // url:false fields are not URL state
  assert.equal(hasUrlState(FIELDS, new URLSearchParams('advanced=x')), false);
});

// ── encode ──────────────────────────────────────────────────────────────────

test('defaults are omitted so links stay short, non-defaults are written', () => {
  const state = { q: '', status: 'all', sort: { key: 'updatedAt', dir: 'desc' }, page: 1, advanced: null };
  assert.equal(applyListParams(FIELDS, '', state).toString(), '');
  const busy = applyListParams(FIELDS, '', { ...state, page: 4, q: 'bank', status: 'won' });
  assert.equal(busy.get('page'), '4');
  assert.equal(busy.get('q'), 'bank');
  assert.equal(busy.get('status'), 'won');
});

test('foreign query params survive a list state change', () => {
  const next = applyListParams(FIELDS, 'tab=details&page=2', { ...emptyState(), page: 5 });
  assert.equal(next.get('tab'), 'details');
  assert.equal(next.get('page'), '5');
});

test('a full round-trip reproduces the state exactly (refresh / paste-a-link)', () => {
  const state = { q: 'בנק לאומי', status: 'won', sort: { key: 'amount', dir: 'asc' }, page: 7, advanced: null };
  const url = applyListParams(FIELDS, '', state).toString();
  const back = decodeListState(FIELDS, new URLSearchParams(url), { q: 'STALE', status: 'lost' });
  assert.deepEqual(back, state);
});

// ── page reset ──────────────────────────────────────────────────────────────

test('changing a filter returns to page 1; changing the page does not', () => {
  const state = { ...emptyState(), page: 4, q: '' };
  assert.equal(nextListState(FIELDS, state, { q: 'x' }).page, 1);
  assert.equal(nextListState(FIELDS, state, { status: 'won' }).page, 1);
  assert.equal(nextListState(FIELDS, state, { page: 9 }).page, 9);
  // An explicit page in the patch is respected even alongside a filter change.
  assert.equal(nextListState(FIELDS, state, { q: 'x', page: 3 }).page, 3);
});

test('listStateEquals compares by field type, not object identity', () => {
  const a = { ...emptyState(), sort: { key: 'amount', dir: 'asc' } };
  const b = { ...emptyState(), sort: { key: 'amount', dir: 'asc' } };
  assert.equal(listStateEquals(FIELDS, a, b), true);
  assert.equal(listStateEquals(FIELDS, a, { ...b, page: 2 }), false);
});

// ── sticky ──────────────────────────────────────────────────────────────────

test('sticky stores every sticky field (including cleared ones) and no others', () => {
  const storage = memoryStorage();
  writeSticky('deals', FIELDS, { ...emptyState(), q: '', status: 'won', page: 4 }, storage);
  const back = readSticky('deals', storage);
  assert.deepEqual(Object.keys(back).sort(), ['advanced', 'q', 'sort', 'status']);
  assert.equal(back.q, ''); // "I cleared the search" is itself a preference
  assert.equal(back.status, 'won');
  assert.equal('page' in back, false); // page is never sticky
});

test('one module state never leaks into another', () => {
  const storage = memoryStorage();
  writeSticky('deals', FIELDS, { ...emptyState(), status: 'won' }, storage);
  writeSticky('contacts', FIELDS, { ...emptyState(), status: 'lost' }, storage);
  assert.notEqual(stickyStorageKey('deals'), stickyStorageKey('contacts'));
  assert.equal(readSticky('deals', storage).status, 'won');
  assert.equal(readSticky('contacts', storage).status, 'lost');
  assert.equal(readSticky('tours', storage), null);
});

test('a corrupted sticky store degrades to defaults instead of crashing', () => {
  const storage = memoryStorage();
  storage.setItem(stickyStorageKey('deals'), '{not json');
  assert.equal(readSticky('deals', storage), null);
  const state = decodeListState(FIELDS, new URLSearchParams(''), { page: 'nonsense', sort: 42 });
  assert.equal(state.page, 1);
  assert.deepEqual(state.sort, { key: 'updatedAt', dir: 'desc' });
});

// ── pagination ──────────────────────────────────────────────────────────────

test('the last page is computed in one hop, never by walking pages', () => {
  assert.equal(pageCountOf(240, 25), 10);
  assert.equal(pageCountOf(0, 25), 1);
  assert.equal(pageCountOf(25, 25), 1);
  assert.equal(pageCountOf(26, 25), 2);
  assert.equal(clampPage(999, 240, 25), 10);
  assert.equal(clampPage(0, 240, 25), 1);
});

// ── scroll store ────────────────────────────────────────────────────────────

test('scroll is remembered per exact list URL, so a filter change starts at the top', () => {
  const storage = memoryStorage();
  const a = scrollKey('/admin/crm/deals', '?page=4');
  const b = scrollKey('/admin/crm/deals', '?page=5');
  saveScrollTop(a, 1240, storage);
  assert.equal(readScrollTop(a, storage), 1240);
  assert.equal(readScrollTop(b, storage), 0);
});

test('scroll keys of different modules are independent', () => {
  const storage = memoryStorage();
  saveScrollTop(scrollKey('/admin/crm/deals', ''), 800, storage);
  saveScrollTop(scrollKey('/admin/crm/contacts', ''), 120, storage);
  assert.equal(readScrollTop(scrollKey('/admin/crm/deals', ''), storage), 800);
  assert.equal(readScrollTop(scrollKey('/admin/crm/contacts', ''), storage), 120);
});

test('the scroll store is bounded and never throws on junk', () => {
  const storage = memoryStorage();
  for (let i = 0; i < 60; i += 1) saveScrollTop(`/list/${i}`, i + 1, storage);
  const stored = JSON.parse(storage.getItem('gos.listScroll.v1'));
  assert.ok(Object.keys(stored).length <= 40);
  assert.equal(readScrollTop('/list/59', storage), 60); // newest survives
  saveScrollTop('/list/x', NaN, storage);
  saveScrollTop('/list/x', -5, storage);
  assert.equal(readScrollTop('/list/x', storage), 0);
});

test('findScrollParent picks the nearest scrolling ancestor, not the window', () => {
  // Minimal DOM shape: leaf → static wrapper → overflow-y:auto container.
  const container = { parentElement: null, tag: 'container' };
  const wrapper = { parentElement: container, tag: 'wrapper' };
  const leaf = { parentElement: wrapper, tag: 'leaf' };
  const styles = new Map([
    [wrapper, { overflowY: 'visible' }],
    [container, { overflowY: 'auto' }],
  ]);
  assert.equal(findScrollParent(leaf, (n) => styles.get(n) || {}), container);
});

// ── navigation origin ───────────────────────────────────────────────────────

test('a record opened from a list returns to that exact list state', () => {
  const origin = makeListReturn({ pathname: '/admin/crm/deals', search: '?page=4&status=won' });
  assert.deepEqual(origin[LIST_RETURN_KEY], { pathname: '/admin/crm/deals', search: '?page=4&status=won' });
  const r = resolveListReturn(origin, '/admin/crm/deals');
  assert.equal(r.mode, 'back');
  assert.equal(r.to, '/admin/crm/deals?page=4&status=won');
});

test('a direct record URL with no origin falls back to the canonical list root', () => {
  for (const state of [null, undefined, {}, { other: 1 }]) {
    const r = resolveListReturn(state, '/admin/crm/deals');
    assert.equal(r.mode, 'fallback');
    assert.equal(r.to, '/admin/crm/deals');
  }
});

test('a non-admin or protocol-relative origin is refused', () => {
  for (const pathname of ['https://evil.example/x', '//evil.example', '/public/thing', 42]) {
    const r = resolveListReturn({ [LIST_RETURN_KEY]: { pathname } }, '/admin/crm/deals');
    assert.equal(r.mode, 'fallback');
  }
});

function emptyState() {
  return { q: '', status: 'all', sort: { key: 'updatedAt', dir: 'desc' }, page: 1, advanced: null };
}
