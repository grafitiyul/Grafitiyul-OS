// The lineage contract: what "retired" means, how history is resolved through
// a merge, and how a retired deal's URL and writes behave.
//
// Matrix cases 20, 21 (old order number resolves to the survivor; the retired
// URL is safe) plus the exclusion invariant every active surface depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_DEAL_FILTER,
  activeDealWhere,
  lineageIdsFor,
  lineageIdsForMany,
  resolveSurvivor,
  isRetired,
  retiredDealRefusal,
  READ_METHODS,
} from './mergeLineage.js';

// A minimal store: only the two deal reads this module makes.
function makeDb(deals) {
  const rows = Object.values(deals);
  const match = (row, where) => {
    if (where.mergedIntoDealId !== undefined) {
      const cond = where.mergedIntoDealId;
      if (cond === null) return row.mergedIntoDealId == null;
      if (cond?.in) return cond.in.includes(row.mergedIntoDealId);
      if (cond?.not === null) return row.mergedIntoDealId != null;
    }
    return true;
  };
  return {
    queries: [],
    deal: {
      findMany: async ({ where }) => rows.filter((r) => match(r, where)),
      findUnique: async ({ where }) => {
        if (where.id) return deals[where.id] || null;
        if (where.orderNo != null) return rows.find((r) => r.orderNo === where.orderNo) || null;
        return null;
      },
    },
  };
}

const deal = (id, over = {}) => ({ id, orderNo: over.orderNo ?? 27000, title: `deal ${id}`, status: 'open', mergedIntoDealId: null, ...over });

// ── the filter ──────────────────────────────────────────────────────────────

test('the active filter is exactly "not retired"', () => {
  assert.deepEqual(ACTIVE_DEAL_FILTER, { mergedIntoDealId: null });
});

test('activeDealWhere composes with any existing clause, including an OR', () => {
  const where = activeDealWhere({ status: 'open', OR: [{ title: { contains: 'x' } }] });
  assert.equal(where.mergedIntoDealId, null);
  assert.equal(where.status, 'open');
  assert.equal(where.OR.length, 1, 'the caller\'s OR is untouched — top-level keys AND in Prisma');
});

test('isRetired is the ONE predicate', () => {
  assert.equal(isRetired({ mergedIntoDealId: 'a' }), true);
  assert.equal(isRetired({ mergedIntoDealId: null }), false);
  assert.equal(isRetired(null), false);
});

// ── the lineage walk ────────────────────────────────────────────────────────

test('an unmerged deal is its own whole lineage', async () => {
  const db = makeDb({ a: deal('a') });
  assert.deepEqual(await lineageIdsFor(db, 'a'), ['a']);
});

test('lineage includes everything retired into the deal', async () => {
  const db = makeDb({
    a: deal('a'),
    b: deal('b', { mergedIntoDealId: 'a' }),
    c: deal('c', { mergedIntoDealId: 'a' }),
    z: deal('z'),
  });
  const ids = await lineageIdsFor(db, 'a');
  assert.deepEqual(ids.sort(), ['a', 'b', 'c']);
});

test('the walk is TRANSITIVE across chained merges', async () => {
  // b→a, then a→c. c's history must contain both a and b: b was never merged
  // into c, and re-pointing it would be a lie the audit record contradicts.
  const db = makeDb({
    c: deal('c'),
    a: deal('a', { mergedIntoDealId: 'c' }),
    b: deal('b', { mergedIntoDealId: 'a' }),
  });
  const ids = await lineageIdsFor(db, 'c');
  assert.deepEqual(ids.sort(), ['a', 'b', 'c']);
});

test('a cycle in corrupted data terminates instead of hanging', async () => {
  const db = makeDb({
    a: deal('a', { mergedIntoDealId: 'b' }),
    b: deal('b', { mergedIntoDealId: 'a' }),
  });
  const ids = await lineageIdsFor(db, 'a');
  assert.ok(ids.length <= 2, 'bounded, and never repeats an id');
  assert.equal(new Set(ids).size, ids.length);
});

test('the batch walk serves many roots in one bounded sweep', async () => {
  const db = makeDb({
    a: deal('a'), b: deal('b', { mergedIntoDealId: 'a' }),
    x: deal('x'), y: deal('y', { mergedIntoDealId: 'x' }),
    z: deal('z', { mergedIntoDealId: 'y' }),
  });
  const map = await lineageIdsForMany(db, ['a', 'x']);
  assert.deepEqual(map.get('a').sort(), ['a', 'b']);
  assert.deepEqual(map.get('x').sort(), ['x', 'y', 'z'], 'transitive per root');
});

// ── the tombstone (matrix 20, 21) ───────────────────────────────────────────

test('a retired deal resolves to its survivor', async () => {
  const db = makeDb({
    a: deal('a', { orderNo: 27042 }),
    b: deal('b', { orderNo: 27100, mergedIntoDealId: 'a' }),
  });
  const res = await resolveSurvivor(db, db.deal.findUnique ? await db.deal.findUnique({ where: { id: 'b' } }) : null);
  assert.equal(res.survivor.id, 'a');
  assert.equal(res.survivor.orderNo, 27042);
  assert.deepEqual(res.hops.map((h) => h.orderNo), [27042]);
});

test('a chained merge resolves to the deal that is actually active today', async () => {
  const db = makeDb({
    c: deal('c', { orderNo: 27500 }),
    a: deal('a', { orderNo: 27042, mergedIntoDealId: 'c' }),
    b: deal('b', { orderNo: 27100, mergedIntoDealId: 'a' }),
  });
  const res = await resolveSurvivor(db, await db.deal.findUnique({ where: { id: 'b' } }));
  assert.equal(res.survivor.orderNo, 27500, 'the END of the chain, not the first hop');
  assert.deepEqual(res.hops.map((h) => h.orderNo), [27042, 27500], 'the whole path is shown, never skipped silently');
});

test('an active deal has no survivor to resolve', async () => {
  const db = makeDb({ a: deal('a') });
  assert.equal(await resolveSurvivor(db, await db.deal.findUnique({ where: { id: 'a' } })), null);
});

// ── the write guard ─────────────────────────────────────────────────────────

test('writes to a retired deal are refused, with the survivor named', async () => {
  const db = makeDb({
    a: deal('a', { orderNo: 27042 }),
    b: deal('b', { orderNo: 27100, mergedIntoDealId: 'a' }),
  });
  const refusal = await retiredDealRefusal(db, 'b');
  assert.equal(refusal.error, 'deal_retired_by_merge');
  assert.equal(refusal.survivorOrderNo, 27042);
  assert.match(refusal.messageHe, /27100/);
  assert.match(refusal.messageHe, /27042/);
});

test('the guard accepts the ORDER NUMBER form of the URL param too', async () => {
  // Otherwise the guard silently stops guarding whenever it runs before the
  // deal-param resolver has swapped the number for the cuid.
  const db = makeDb({
    a: deal('a', { orderNo: 27042 }),
    b: deal('b', { orderNo: 27100, mergedIntoDealId: 'a' }),
  });
  const refusal = await retiredDealRefusal(db, '27100');
  assert.equal(refusal.error, 'deal_retired_by_merge');
  assert.equal(refusal.survivorOrderNo, 27042);
});

test('an active deal is never refused', async () => {
  const db = makeDb({ a: deal('a') });
  assert.equal(await retiredDealRefusal(db, 'a'), null);
});

test('READS of a retired deal always pass — that is the point of retiring', () => {
  // The verb set is shared with routes/dealParam.js, where the refusal is
  // actually enforced. A retired deal opens, renders and reports normally;
  // only mutations are refused.
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(READ_METHODS.has(method), true, `${method} is a read`);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(READ_METHODS.has(method), false, `${method} is guarded`);
  }
});
