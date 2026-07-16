import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFilters, filtersFromParams, filtersToParams, filtersToQuery,
  selectWindow, statusLockedBy, toggleIn, hasActiveFilters, rangeIncomplete,
  TIME_CHIPS, WINDOWS,
} from './taskFilters.js';

const ME = 'admin-1';
const params = (s) => new URLSearchParams(s);

test('first visit: owner=me, window=today, status=open', () => {
  const d = defaultFilters(ME);
  assert.equal(d.window, 'today');
  assert.equal(d.status, 'open');
  assert.deepEqual(d.ownerIds, [ME]);
});

test('with no known user, default to all owners rather than an empty grid', () => {
  assert.deepEqual(defaultFilters(null).ownerIds, []);
});

test('the chips are in the owner-specified order, and היום is primary', () => {
  assert.deepEqual(TIME_CHIPS.map((c) => c.key), ['overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'range']);
  assert.deepEqual(TIME_CHIPS.map((c) => c.label), ['באיחור', 'היום', 'מחר', 'השבוע', 'השבוע הבא', 'טווח תאריכים']);
  const today = TIME_CHIPS.find((c) => c.key === 'today');
  assert.equal(today.tone, 'primary', 'היום is the primary/green state');
  // every chip is a real window
  for (const c of TIME_CHIPS) assert.ok(WINDOWS.includes(c.key));
});

// ── באיחור implies open ─────────────────────────────────────────────────────

test('selecting באיחור forces status back to open', () => {
  // Overdue is meaningless for a completed task; the server rejects the
  // combination outright, so the UI must never be able to ask for it.
  const f = { ...defaultFilters(ME), status: 'completed', window: 'today' };
  assert.equal(selectWindow(f, 'overdue').status, 'open');
});

test('באיחור locks the status control; other windows do not', () => {
  assert.equal(statusLockedBy({ window: 'overdue' }), 'overdue');
  for (const w of ['today', 'tomorrow', 'this_week', 'next_week', 'range']) {
    assert.equal(statusLockedBy({ window: w }), null);
  }
});

test('selecting באיחור leaves a non-completed status alone', () => {
  assert.equal(selectWindow({ ...defaultFilters(ME), status: 'all' }, 'overdue').status, 'all');
});

test('leaving range clears its bounds', () => {
  const f = { ...defaultFilters(ME), window: 'range', rangeFrom: '2026-01-01', rangeTo: '2026-01-31' };
  const next = selectWindow(f, 'today');
  assert.equal(next.rangeFrom, null);
  assert.equal(next.rangeTo, null);
});

test('an unknown window is ignored, not applied', () => {
  const f = defaultFilters(ME);
  assert.equal(selectWindow(f, 'yesterday'), f);
});

test('chips are mutually exclusive — selecting one replaces the window', () => {
  let f = defaultFilters(ME);
  for (const w of ['overdue', 'tomorrow', 'this_week', 'next_week']) {
    f = selectWindow(f, w);
    assert.equal(f.window, w, 'exactly one window at a time');
  }
});

// ── URL round-trip ──────────────────────────────────────────────────────────

test('a default workspace produces a near-empty URL', () => {
  const p = filtersToParams(defaultFilters(ME), [{ key: 'dueDate', dir: 'asc' }], 1);
  // ownerIds is always written: "me" and "everyone" are both meaningful.
  assert.deepEqual([...p.keys()], ['ownerIds']);
});

test('URL round-trips every filter', () => {
  const f = {
    window: 'next_week', rangeFrom: null, rangeTo: null,
    typeKeys: ['call', 'whatsapp'], ownerIds: ['u1'], priorities: ['high', 'none'],
    stageIds: ['s1'], status: 'all',
  };
  const p = filtersToParams(f, [{ key: 'dueDate', dir: 'asc' }], 1);
  assert.deepEqual(filtersFromParams(params(p.toString()), ME), f);
});

test('range round-trips its bounds', () => {
  const f = { ...defaultFilters(ME), window: 'range', rangeFrom: '2026-01-01', rangeTo: '2026-01-31' };
  const p = filtersToParams(f, [], 1);
  const back = filtersFromParams(params(p.toString()), ME);
  assert.equal(back.window, 'range');
  assert.equal(back.rangeFrom, '2026-01-01');
  assert.equal(back.rangeTo, '2026-01-31');
});

test('an empty URL yields the first-visit defaults', () => {
  assert.deepEqual(filtersFromParams(params(''), ME), defaultFilters(ME));
});

test('an explicitly empty ownerIds means ALL owners, not "fall back to me"', () => {
  // The difference between "I cleared the owner filter" and "I have not chosen"
  // must survive a reload.
  assert.deepEqual(filtersFromParams(params('ownerIds='), ME).ownerIds, []);
});

test('garbage in the URL falls back instead of exploding', () => {
  const f = filtersFromParams(params('window=banana&status=perhaps&priorities=urgent,high'), ME);
  assert.equal(f.window, 'today');
  assert.equal(f.status, 'open');
  assert.deepEqual(f.priorities, ['high'], 'unknown priorities dropped');
});

test('rangeFrom/rangeTo are ignored unless the window is range', () => {
  const f = filtersFromParams(params('window=today&rangeFrom=2026-01-01&rangeTo=2026-01-31'), ME);
  assert.equal(f.rangeFrom, null);
  assert.equal(f.rangeTo, null);
});

// ── API query ───────────────────────────────────────────────────────────────

test('the API query always carries window and status', () => {
  const q = new URLSearchParams(filtersToQuery(defaultFilters(ME), [{ key: 'dueDate', dir: 'asc' }], 1, 50));
  assert.equal(q.get('window'), 'today');
  assert.equal(q.get('status'), 'open');
  assert.equal(q.get('ownerIds'), ME);
  assert.equal(q.get('sort'), 'dueDate:asc');
  assert.equal(q.get('pageSize'), '50');
  assert.equal(q.get('page'), null, 'page 1 is implicit');
});

test('multi-sort reaches the API in order', () => {
  const q = new URLSearchParams(filtersToQuery(defaultFilters(ME), [{ key: 'priority', dir: 'desc' }, { key: 'dueDate', dir: 'asc' }], 2, 50));
  assert.equal(q.get('sort'), 'priority:desc,dueDate:asc');
  assert.equal(q.get('page'), '2');
});

// ── helpers ─────────────────────────────────────────────────────────────────

test('toggleIn adds and removes without mutating', () => {
  const l = ['a'];
  assert.deepEqual(toggleIn(l, 'b'), ['a', 'b']);
  assert.deepEqual(toggleIn(l, 'a'), []);
  assert.deepEqual(l, ['a']);
});

test('hasActiveFilters ignores the window (a chip is navigation, not a filter)', () => {
  assert.equal(hasActiveFilters({ ...defaultFilters(null), window: 'next_week' }), false);
  assert.equal(hasActiveFilters({ ...defaultFilters(null), typeKeys: ['call'] }), true);
  assert.equal(hasActiveFilters({ ...defaultFilters(null), status: 'all' }), true);
});

test('rangeIncomplete guards a half-filled date range', () => {
  assert.ok(rangeIncomplete({ window: 'range', rangeFrom: '2026-01-01', rangeTo: null }));
  assert.ok(rangeIncomplete({ window: 'range', rangeFrom: null, rangeTo: null }));
  assert.ok(!rangeIncomplete({ window: 'range', rangeFrom: '2026-01-01', rangeTo: '2026-01-31' }));
  assert.ok(!rangeIncomplete({ window: 'today' }));
});
