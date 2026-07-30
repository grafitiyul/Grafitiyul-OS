import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MIRROR_APPLY_ENABLED = 'true';

import { createBudget, groupByParent, processCoalesced } from './coalesce.js';
import { MODE } from './modes.js';

// An in-memory event store + a parent_recompute adapter whose recomputes are
// COUNTED, so the N+1 claim is measured rather than asserted.
function setup({ events, parents = { recTOUR: 't1' } , desired = [], current = [], protect = null }) {
  const rows = events.map((e, i) => ({
    id: e.id || `ev${i}`, status: 'pending', system: 'airtable', entity: 'tourEvent',
    changeKind: 'poll', transport: 'poll', attemptCount: 0,
    rawPayload: { fields: { 'שם סיור': e.parent } },
    receivedAt: e.receivedAt, externalId: e.externalId || `child${i}`,
  }));
  const legacy = Object.entries(parents).map(([sourceId, entityId]) => ({
    sourceSystem: 'airtable', sourceType: 'tour', sourceId, entityId, entityType: 'TourEvent', syncBaseline: null,
  }));
  const counters = { derive: 0, loadCurrent: 0, applyDiff: 0, resolveParent: 0 };

  const db = {
    rows, legacy, counters,
    mirrorEvent: {
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
      update: async ({ where, data }) => { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    },
    legacyRecord: {
      findUnique: async ({ where }) => legacy.find((l) => l.sourceId === where.sourceSystem_sourceType_sourceId.sourceId) || null,
      update: async ({ where, data }) => { const l = legacy.find((x) => x.sourceId === where.sourceSystem_sourceType_sourceId.sourceId); Object.assign(l, data); return l; },
    },
    operationalIssue: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: 'i1', status: 'open', ...data }),
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
  };

  const adapter = {
    mode: MODE.PARENT_RECOMPUTE,
    parentSourceType: 'tour',
    async resolveParent(d, ev) {
      counters.resolveParent += 1;
      const recId = ev.rawPayload?.fields?.['שם סיור'];
      if (!recId) return null;
      const l = await d.legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: recId } },
      });
      return l?.entityId ? { sourceId: recId, entityId: l.entityId, entityType: 'tourEvent' } : null;
    },
    derive: async () => { counters.derive += 1; return desired; },
    loadCurrent: async () => { counters.loadCurrent += 1; return current; },
    keyOf: (m) => `${m.kind}:${m.dealId}`,
    sameOf: (a, b) => Number(a.seats ?? 0) === Number(b.seats ?? 0),
    protect,
    applyDiff: async () => { counters.applyDiff += 1; },
  };
  return { db, adapter, factory: () => adapter, counters };
}

const at = (s) => new Date(`2026-07-30T10:0${s}:00Z`);

// ── grouping ─────────────────────────────────────────────────────────────────

test('events are grouped by the parent the ADAPTER resolves, not by payload shape', async () => {
  const { db, factory } = setup({
    events: [
      { parent: 'recTOUR', receivedAt: at(1) },
      { parent: 'recTOUR', receivedAt: at(2) },
      { parent: 'recOTHER', receivedAt: at(3) },
    ],
    parents: { recTOUR: 't1', recOTHER: 't2' },
  });
  const { groups, unresolved } = await groupByParent(db, db.rows, factory);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.events.length).sort(), [1, 2]);
  assert.equal(unresolved.length, 0);
});

test('an unresolvable parent is separated, never grouped with a real one', async () => {
  const { db, factory } = setup({
    events: [{ parent: 'recTOUR', receivedAt: at(1) }, { parent: 'recGHOST', receivedAt: at(2) }],
  });
  const { groups, unresolved } = await groupByParent(db, db.rows, factory);
  assert.equal(groups.length, 1);
  assert.equal(unresolved.length, 1);
});

test('an entity_merge adapter is never coalesced', async () => {
  const { db } = setup({ events: [{ parent: 'recTOUR', receivedAt: at(1) }] });
  const entityMergeFactory = () => ({ sourceType: 'tour', normalize: () => {}, loadGos: () => {}, applyGos: () => {} });
  const { groups, unresolved } = await groupByParent(db, db.rows, entityMergeFactory);
  assert.equal(groups.length, 0, 'entity_merge events carry their own intermediate values');
  assert.equal(unresolved.length, 1);
});

// ── the N+1 claim, measured ──────────────────────────────────────────────────

test('TEN child edits on ONE parent cause ONE recompute, not ten', async () => {
  const { db, factory, counters } = setup({
    events: Array.from({ length: 10 }, (_, i) => ({ parent: 'recTOUR', receivedAt: at(i) })),
    desired: [{ kind: 'booking', dealId: 'd1', seats: 25 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
  });
  const stats = await processCoalesced(db, db.rows, factory);

  assert.equal(stats.parents, 1);
  assert.equal(stats.recomputes, 1);
  assert.equal(stats.coalesced, 9);
  assert.equal(stats.savedRecomputes, 9);
  assert.equal(counters.derive, 1, 'the expensive child read happened ONCE');
  assert.equal(counters.loadCurrent, 1);
  assert.equal(counters.applyDiff, 1);
});

test('every coalesced event still reaches a terminal state with an audit pointer', async () => {
  const { db, factory } = setup({
    events: Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, parent: 'recTOUR', receivedAt: at(i) })),
    desired: [{ kind: 'booking', dealId: 'd1', seats: 25 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
  });
  await processCoalesced(db, db.rows, factory);

  assert.ok(db.rows.every((r) => r.status === 'processed'), 'no event left pending');
  const followers = db.rows.filter((r) => r.fieldsWritten?.coalescedInto);
  assert.equal(followers.length, 3);
  // The pointer names the NEWEST event, which is the one actually evaluated.
  assert.ok(followers.every((f) => f.fieldsWritten.coalescedInto === 'e3'));
  assert.ok(followers.every((f) => f.outcome === 'recomputed'));
  assert.ok(followers.every((f) => f.gosEntityId === 't1'));
});

test('the NEWEST event is the one evaluated — a recompute reads current state', async () => {
  const { db, factory } = setup({
    events: [
      { id: 'old', parent: 'recTOUR', receivedAt: at(1) },
      { id: 'new', parent: 'recTOUR', receivedAt: at(9) },
    ],
    desired: [{ kind: 'booking', dealId: 'd1', seats: 30 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
  });
  await processCoalesced(db, db.rows, factory);
  assert.equal(db.rows.find((r) => r.id === 'old').fieldsWritten.coalescedInto, 'new');
  assert.equal(db.rows.find((r) => r.id === 'new').outcome, 'recomputed');
});

test('separate parents each get their own recompute', async () => {
  const { db, factory, counters } = setup({
    events: [
      { parent: 'recA', receivedAt: at(1) }, { parent: 'recA', receivedAt: at(2) },
      { parent: 'recB', receivedAt: at(3) }, { parent: 'recB', receivedAt: at(4) },
    ],
    parents: { recA: 't1', recB: 't2' },
    desired: [{ kind: 'booking', dealId: 'd1', seats: 5 }],
    current: [],
  });
  const stats = await processCoalesced(db, db.rows, factory);
  assert.equal(stats.parents, 2);
  assert.equal(stats.recomputes, 2);
  assert.equal(counters.derive, 2, 'coalescing never merges DIFFERENT parents');
  assert.equal(stats.savedRecomputes, 2);
});

// ── buffering interaction ────────────────────────────────────────────────────

test('with apply OFF nothing is applied and NO sibling is marked processed', async () => {
  const { db, factory, counters } = setup({
    events: Array.from({ length: 5 }, (_, i) => ({ parent: 'recTOUR', receivedAt: at(i) })),
    desired: [{ kind: 'booking', dealId: 'd1', seats: 25 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
  });
  const stats = await processCoalesced(db, db.rows, factory, { allowApply: false });

  assert.equal(counters.applyDiff, 0, 'nothing applied');
  assert.equal(stats.coalesced, 0, 'a buffered recompute must not drag siblings terminal');
  assert.ok(db.rows.every((r) => r.status === 'pending'), 'the whole window stays replayable');
});

// ── unresolved still terminates ──────────────────────────────────────────────

test('an unresolvable event reaches no_parent rather than sitting pending forever', async () => {
  const { db, factory } = setup({ events: [{ parent: 'recGHOST', receivedAt: at(1) }] });
  const stats = await processCoalesced(db, db.rows, factory);
  assert.equal(stats.unresolved, 1);
  assert.equal(db.rows[0].status, 'processed');
  assert.equal(db.rows[0].outcome, 'no_parent');
});

test('an event with no adapter is KEPT, not discarded', async () => {
  // Same rule as the retry worker: a config gap must never consume a real change.
  const { db } = setup({ events: [{ parent: 'recTOUR', receivedAt: at(1) }] });
  const stats = await processCoalesced(db, db.rows, () => null);
  assert.equal(stats.unresolved, 1);
  assert.equal(db.rows[0].status, 'pending');
  assert.equal(db.rows[0].failureCode, 'no_adapter');
});

// ── conflicts survive coalescing ─────────────────────────────────────────────

test('a protected conflict is reported once and siblings inherit the outcome', async () => {
  const { db, factory, counters } = setup({
    events: Array.from({ length: 3 }, (_, i) => ({ parent: 'recTOUR', receivedAt: at(i) })),
    desired: [{ kind: 'booking', dealId: 'd1', seats: 5 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
    protect: () => 'conflict',
  });
  const stats = await processCoalesced(db, db.rows, factory);
  assert.equal(stats.conflicts, 1, 'reported once, not three times');
  assert.equal(counters.applyDiff, 0, 'a conflict writes nothing');
  assert.ok(db.rows.every((r) => r.outcome === 'conflict'));
});

// ── the shared budget ────────────────────────────────────────────────────────

test('a shared budget stops AT the ceiling, not past it', () => {
  const b = createBudget(3);
  b.spend(); b.spend(); b.spend();
  assert.equal(b.used, 3);
  assert.equal(b.remaining, 0);
  assert.throws(() => b.spend(), (e) => e.code === 'API_CEILING');
  assert.equal(b.used, 3, 'a refused spend does not increment');
});

test('the budget refuses a batch that would overshoot, rather than partially spending', () => {
  const b = createBudget(5);
  b.spend(3);
  assert.throws(() => b.spend(3), (e) => e.code === 'API_CEILING');
  assert.equal(b.used, 3);
  assert.equal(b.remaining, 2);
});

// ── cursor isolation across tables mirroring the same entity ─────────────────

test('four Airtable tables mirroring tourEvent get FOUR cursors, not one', async () => {
  const { cursorIdFor } = await import('./worker.js');
  const ids = new Set([
    cursorIdFor({ system: 'airtable', entity: 'tourEvent' }),
    cursorIdFor({ system: 'airtable', entity: 'tourEvent', cursorKey: 'airtable:child:coordination' }),
    cursorIdFor({ system: 'airtable', entity: 'tourEvent', cursorKey: 'airtable:child:participants' }),
    cursorIdFor({ system: 'airtable', entity: 'tourEvent', cursorKey: 'airtable:child:payroll' }),
  ]);
  assert.equal(ids.size, 4, 'sharing one cursor would silently lose changes');
  assert.ok(ids.has('airtable:tourEvent'), 'the entity-based id is still the default');
});

test('each poll target claims and releases its OWN cursor position', async () => {
  const { claimCursor, releaseCursor } = await import('./worker.js');
  const cursors = [];
  const db = {
    mirrorCursor: {
      upsert: async ({ where, create }) => {
        let r = cursors.find((c) => c.id === where.id);
        if (!r) { r = { failureStreak: 0, ...create }; cursors.push(r); }
        return r;
      },
      updateMany: async ({ where, data }) => {
        const r = cursors.find((c) => c.id === where.id);
        if (!r || r.claimedAt) return { count: 0 };
        Object.assign(r, data); return { count: 1 };
      },
      update: async ({ where, data }) => {
        const r = cursors.find((c) => c.id === where.id);
        for (const [k, v] of Object.entries(data)) r[k] = v?.increment ? (r[k] || 0) + v.increment : v;
        return r;
      },
      findUnique: async ({ where }) => cursors.find((c) => c.id === where.id) || null,
    },
  };

  const coord = { system: 'airtable', entity: 'tourEvent', cursorKey: 'airtable:child:coordination' };
  const payroll = { system: 'airtable', entity: 'tourEvent', cursorKey: 'airtable:child:payroll' };

  assert.ok(await claimCursor(db, coord));
  assert.ok(await claimCursor(db, payroll), 'a different table is NOT blocked by another table claim');

  await releaseCursor(db, coord, { cursor: 'C1' });
  await releaseCursor(db, payroll, { cursor: 'P1' });

  assert.equal(cursors.find((c) => c.id === 'airtable:child:coordination').cursor, 'C1');
  assert.equal(cursors.find((c) => c.id === 'airtable:child:payroll').cursor, 'P1');
});
