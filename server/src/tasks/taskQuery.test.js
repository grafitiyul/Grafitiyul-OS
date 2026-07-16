import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskQuery, parseSort, buildTaskWhere, buildTaskOrderBy, needsInMemorySort,
  SORTABLE, SORTABLE_KEYS, DISPLAY_ONLY_KEYS, DEFAULT_SORT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE,
} from './taskQuery.js';

const WED = '2026-07-15'; // Wednesday
const SAT = '2026-07-18';

const parse = (q, today = WED) => parseTaskQuery(q, { today });

// ── the sortable whitelist is BINDING (§4) ──────────────────────────────────

test('display-only columns are NOT sortable — they never pretend', () => {
  for (const key of DISPLAY_ONLY_KEYS) {
    assert.ok(!SORTABLE_KEYS.includes(key), `${key} must not be sortable`);
    assert.deepEqual(parseSort(`${key}:asc`), { ok: false, error: 'invalid_sort_key' });
  }
});

test('customer/phone/email/tour are display-only because they are to-many', () => {
  // Guards the §4.2 decision from being quietly "fixed" later: these reach
  // through DealContact[]/Booking[], which Prisma cannot order through.
  for (const key of ['customer', 'phone', 'email', 'upcomingTour']) {
    assert.ok(DISPLAY_ONLY_KEYS.includes(key));
  }
});

test('an unknown sort key is a 400, never a silent fallback', () => {
  assert.deepEqual(parseSort('nonsense:asc'), { ok: false, error: 'invalid_sort_key' });
  assert.deepEqual(parseSort('dueDate:sideways'), { ok: false, error: 'invalid_sort_dir' });
  assert.deepEqual(parse({ sort: 'nonsense' }), { ok: false, error: 'invalid_sort_key' });
});

test('sort defaults to dueDate asc', () => {
  assert.deepEqual(parseSort(''), { ok: true, sort: [...DEFAULT_SORT] });
  assert.deepEqual(parseSort(undefined).sort, [{ key: 'dueDate', dir: 'asc' }]);
});

test('multi-sort preserves order and dedupes repeats', () => {
  assert.deepEqual(parseSort('dealStage:asc,dueDate:desc').sort, [
    { key: 'dealStage', dir: 'asc' },
    { key: 'dueDate', dir: 'desc' },
  ]);
  assert.deepEqual(parseSort('dueDate:asc,dueDate:desc').sort, [{ key: 'dueDate', dir: 'asc' }], 'first wins');
});

test('every sortable key builds a real orderBy (or is explicitly in-memory)', () => {
  for (const key of SORTABLE_KEYS) {
    const spec = SORTABLE[key];
    if (spec.inMemory) {
      assert.equal(key, 'priority', 'priority is the only in-memory sort');
      continue;
    }
    const frag = spec.prismaOrderBy('asc');
    assert.ok(frag && typeof frag === 'object', `${key} must produce an orderBy`);
  }
});

test('orderBy always ends with a stable tiebreak, so pagination cannot skip rows', () => {
  const ob = buildTaskOrderBy([{ key: 'dealTitle', dir: 'asc' }]);
  assert.deepEqual(ob[ob.length - 1], { id: 'asc' }, 'id is the final tiebreak');
  assert.deepEqual(ob, [{ deal: { title: 'asc' } }, { dueDate: 'asc' }, { id: 'asc' }]);
});

test('orderBy does not duplicate dueDate when the user already sorted by it', () => {
  const ob = buildTaskOrderBy([{ key: 'dueDate', dir: 'desc' }]);
  assert.deepEqual(ob, [{ dueDate: 'desc' }, { id: 'asc' }]);
});

test('owner sort mirrors what the UI renders: displayName, then username', () => {
  assert.deepEqual(buildTaskOrderBy([{ key: 'owner', dir: 'asc' }]), [
    { owner: { displayName: 'asc' } },
    { owner: { username: 'asc' } },
    { dueDate: 'asc' },
    { id: 'asc' },
  ]);
});

test('stage sorts by pipeline position, not alphabetically', () => {
  assert.deepEqual(SORTABLE.dealStage.prismaOrderBy('asc'), { deal: { dealStage: { sortOrder: 'asc' } } });
});

test('variant sorts through product->location, since a variant has no name', () => {
  assert.deepEqual(SORTABLE.variant.prismaOrderBy('asc'), {
    deal: { productVariant: { location: { nameHe: 'asc' } } },
  });
});

test('planned Deal tour date is sortable and is NOT the operational tour date', () => {
  assert.deepEqual(SORTABLE.plannedTourDate.prismaOrderBy('asc'), { deal: { tourDate: 'asc' } });
  assert.ok(DISPLAY_ONLY_KEYS.includes('upcomingTour'), 'the operational date stays display-only');
});

test('priority needs the in-memory path; nothing else does', () => {
  assert.ok(needsInMemorySort([{ key: 'priority', dir: 'asc' }]));
  assert.equal(buildTaskOrderBy([{ key: 'priority', dir: 'asc' }]), null);
  assert.ok(!needsInMemorySort([{ key: 'dueDate', dir: 'asc' }]));
  // mixed sort still routes to the in-memory path
  assert.ok(needsInMemorySort([{ key: 'dueDate', dir: 'asc' }, { key: 'priority', dir: 'asc' }]));
});

// ── the canonical filter object ─────────────────────────────────────────────

test('defaults: window=today, status=open', () => {
  const r = parse({});
  assert.equal(r.ok, true);
  assert.equal(r.filters.window, 'today');
  assert.equal(r.filters.status, 'open');
  assert.equal(r.page, 1);
  assert.equal(r.pageSize, DEFAULT_PAGE_SIZE);
});

test('pageSize is clamped at the one-continuous-list cap, never unbounded', () => {
  assert.equal(MAX_PAGE_SIZE, 2000, 'the workspace fetch ceiling (not a page — pagination is gone)');
  assert.equal(parse({ pageSize: '999999' }).pageSize, MAX_PAGE_SIZE);
  assert.equal(parse({ pageSize: '0' }).pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(parse({ pageSize: '-5' }).pageSize, 1);
  assert.equal(parse({ pageSize: 'abc' }).pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(parse({ page: '0' }).page, 1);
  assert.equal(parse({ page: '-3' }).page, 1);
});

test('invalid enums are rejected, not coerced', () => {
  assert.deepEqual(parse({ window: 'yesterday' }), { ok: false, error: 'invalid_window' });
  assert.deepEqual(parse({ status: 'maybe' }), { ok: false, error: 'invalid_status' });
  assert.deepEqual(parse({ priorities: 'urgent' }), { ok: false, error: 'invalid_priority' });
});

test('overdue + completed is contradictory and is rejected', () => {
  // Overdue only means anything for open tasks (§3.2). Asking for completed
  // overdue tasks is a contradiction -> 400, not a silently empty grid.
  assert.deepEqual(parse({ window: 'overdue', status: 'completed' }), { ok: false, error: 'overdue_requires_open' });
  // but overdue + open, and overdue + all, are fine
  assert.equal(parse({ window: 'overdue', status: 'open' }).ok, true);
  assert.equal(parse({ window: 'overdue', status: 'all' }).ok, true);
});

test('csv filters parse, trim, and drop blanks', () => {
  const r = parse({ typeKeys: 'call, whatsapp ,,email', ownerIds: 'u1,u2', stageIds: ' s1 ' });
  assert.deepEqual(r.filters.typeKeys, ['call', 'whatsapp', 'email']);
  assert.deepEqual(r.filters.ownerIds, ['u1', 'u2']);
  assert.deepEqual(r.filters.stageIds, ['s1']);
});

test('range requires valid bounds', () => {
  assert.deepEqual(parse({ window: 'range' }), { ok: false, error: 'invalid_range' });
  assert.deepEqual(parse({ window: 'range', rangeFrom: '2026-02-30', rangeTo: '2026-03-01' }), { ok: false, error: 'invalid_range' });
  const ok = parse({ window: 'range', rangeFrom: '2026-01-01', rangeTo: '2026-01-31' });
  assert.equal(ok.ok, true);
  assert.equal(ok.filters.rangeFrom, '2026-01-01');
});

// ── where building ──────────────────────────────────────────────────────────

const whereFor = (q, today = WED) => {
  const r = parse(q, today);
  assert.equal(r.ok, true, `parse failed: ${r.error}`);
  return buildTaskWhere(r.filters, r.resolved);
};

test('today window is a half-open UTC day range', () => {
  const w = whereFor({ window: 'today' });
  assert.equal(w.dueDate.gte.toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(w.dueDate.lt.toISOString(), '2026-07-16T00:00:00.000Z');
  assert.equal(w.status, 'open');
});

test('overdue is unbounded backwards and forces status=open', () => {
  const w = whereFor({ window: 'overdue', status: 'all' });
  assert.equal(w.dueDate.gte, undefined, 'no lower bound');
  assert.equal(w.dueDate.lt.toISOString(), '2026-07-15T00:00:00.000Z', 'everything before today');
  assert.equal(w.status, 'open', 'overdue pins open even when status=all was asked');
});

test('status=all adds no status constraint (the only way to see cancelled/sent)', () => {
  const w = whereFor({ window: 'today', status: 'all' });
  assert.ok(!('status' in w));
});

test('absent filters omit their key entirely — no undefined, no no-op clause', () => {
  const w = whereFor({ window: 'today' });
  assert.deepEqual(Object.keys(w).sort(), ['dueDate', 'status']);
  for (const k of Object.keys(w)) assert.notEqual(w[k], undefined);
});

test('type / owner / stage filters', () => {
  const w = whereFor({ window: 'today', typeKeys: 'call,email', ownerIds: 'u1', stageIds: 's1,s2' });
  assert.deepEqual(w.taskType, { key: { in: ['call', 'email'] } });
  assert.deepEqual(w.ownerUserId, { in: ['u1'] });
  assert.deepEqual(w.deal, { dealStageId: { in: ['s1', 's2'] } });
});

test('priority "none" means IS NULL and cannot ride in an `in` list', () => {
  assert.deepEqual(whereFor({ window: 'today', priorities: 'high,medium' }).priority, { in: ['high', 'medium'] });
  assert.deepEqual(whereFor({ window: 'today', priorities: 'none' }).priority, null);
  // mixed -> OR, because `in: [..., null]` does not match NULL in SQL
  assert.deepEqual(whereFor({ window: 'today', priorities: 'high,none' }).OR, [
    { priority: { in: ['high'] } },
    { priority: null },
  ]);
});

test('this_week on Saturday is empty — the caller must not query', () => {
  const r = parse({ window: 'this_week' }, SAT);
  assert.equal(r.ok, true);
  assert.equal(r.resolved.empty, true);
});

test('all filters AND together with the window', () => {
  const w = whereFor({ window: 'tomorrow', typeKeys: 'call', ownerIds: 'u1', priorities: 'high' });
  assert.equal(w.dueDate.gte.toISOString(), '2026-07-16T00:00:00.000Z');
  assert.deepEqual(w.taskType, { key: { in: ['call'] } });
  assert.deepEqual(w.ownerUserId, { in: ['u1'] });
  assert.deepEqual(w.priority, { in: ['high'] });
  assert.equal(w.status, 'open');
});
