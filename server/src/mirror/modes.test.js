import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MIRROR_APPLY_ENABLED = 'true';

import { MODE, MODES, assertAdapterContract, diffSets, modeOf } from './modes.js';
import { OUTCOME, ingestMirror, receive, processEvent } from './pipeline.js';
import { childKindForTable, parentRecIdOf, tourChildrenAdapter } from './sources/airtableTourChildren.js';

// ── mode declaration ─────────────────────────────────────────────────────────

test('an adapter that declares nothing defaults to entity_merge (existing behaviour)', () => {
  assert.equal(modeOf({}), MODE.ENTITY_MERGE);
  assert.equal(modeOf(undefined), MODE.ENTITY_MERGE);
});

test('an adapter declares its mode and the engine honours it', () => {
  assert.equal(modeOf({ mode: MODE.PARENT_RECOMPUTE }), MODE.PARENT_RECOMPUTE);
  assert.deepEqual([...MODES], ['entity_merge', 'parent_recompute']);
});

test('an unknown mode is refused loudly, never treated as the default', () => {
  assert.throws(() => modeOf({ mode: 'magic' }), (e) => e.code === 'UNKNOWN_SYNC_MODE');
});

// ── contract enforcement ─────────────────────────────────────────────────────

test('entity_merge requires normalize/loadGos/applyGos/sourceType', () => {
  assert.throws(() => assertAdapterContract({}, MODE.ENTITY_MERGE), (e) => {
    assert.equal(e.code, 'ADAPTER_CONTRACT_INCOMPLETE');
    assert.deepEqual(e.missing.sort(), ['applyGos', 'loadGos', 'normalize', 'sourceType']);
    return true;
  });
  assert.ok(assertAdapterContract({
    sourceType: 'deal', normalize: () => {}, loadGos: () => {}, applyGos: () => {},
  }, MODE.ENTITY_MERGE));
});

test('parent_recompute requires the parent contract, NOT normalize/applyGos', () => {
  assert.throws(() => assertAdapterContract({ mode: MODE.PARENT_RECOMPUTE }), (e) => {
    assert.deepEqual(e.missing.sort(), ['applyDiff', 'derive', 'loadCurrent', 'parentSourceType', 'resolveParent']);
    return true;
  });
  assert.ok(assertAdapterContract({
    mode: MODE.PARENT_RECOMPUTE, parentSourceType: 'tour',
    resolveParent: () => {}, derive: () => {}, loadCurrent: () => {}, applyDiff: () => {},
  }));
});

// ── the generic set diff ─────────────────────────────────────────────────────

const keyOf = (m) => m.id;
const sameOf = (a, b) => a.v === b.v;

test('diffSets computes add / update / remove', () => {
  const d = diffSets({
    current: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }],
    desired: [{ id: 'a', v: 9 }, { id: 'c', v: 3 }],
    keyOf, sameOf,
  });
  assert.deepEqual(d.add, [{ id: 'c', v: 3 }]);
  assert.deepEqual(d.update.map((u) => u.key), ['a']);
  assert.deepEqual(d.remove, [{ id: 'b', v: 2 }]);
  assert.equal(d.hasWork, true);
  assert.equal(d.changed, 3);
});

test('an identical set produces NO work', () => {
  const d = diffSets({ current: [{ id: 'a', v: 1 }], desired: [{ id: 'a', v: 1 }], keyOf, sameOf });
  assert.equal(d.hasWork, false);
  assert.equal(d.changed, 0);
});

test('protect can REPLACE the desired value; clamping to current means no write', () => {
  // Clamped up to the current value → the sets now agree, so there is nothing
  // to write. That is the point of clamping rather than conflicting.
  const clamped = diffSets({
    current: [{ id: 'a', v: 5 }], desired: [{ id: 'a', v: 1 }], keyOf, sameOf,
    protect: (cur, want) => ({ ...want, v: Math.max(cur.v, want.v) }),
  });
  assert.equal(clamped.update.length, 0);
  assert.equal(clamped.hasWork, false);

  // Replaced with a value that genuinely differs → the replacement is written,
  // not the original desired value.
  const replaced = diffSets({
    current: [{ id: 'a', v: 5 }], desired: [{ id: 'a', v: 1 }], keyOf, sameOf,
    protect: (_cur, want) => ({ ...want, v: 7 }),
  });
  assert.equal(replaced.update.length, 1);
  assert.equal(replaced.update[0].to.v, 7);
});

test('protect can REFUSE, producing a conflict instead of a write', () => {
  const d = diffSets({
    current: [{ id: 'a', v: 5 }], desired: [{ id: 'a', v: 1 }], keyOf, sameOf,
    protect: () => 'conflict',
  });
  assert.equal(d.update.length, 0);
  assert.equal(d.conflicts.length, 1);
  assert.deepEqual(d.conflicts[0].current, { id: 'a', v: 5 });
});

test('a protected conflict does not prevent unrelated members from changing', () => {
  const d = diffSets({
    current: [{ id: 'a', v: 5 }, { id: 'b', v: 1 }],
    desired: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }],
    keyOf, sameOf,
    protect: (cur) => (cur.id === 'a' ? 'conflict' : undefined),
  });
  assert.equal(d.conflicts.length, 1);
  assert.deepEqual(d.update.map((u) => u.key), ['b']);
});

// ── parent_recompute through the real pipeline ───────────────────────────────

function recomputeDb({ tourLink = null } = {}) {
  const t = { mirrorEvent: [], legacyRecord: tourLink ? [tourLink] : [], operationalIssue: [] };
  let seq = 0;
  return {
    _t: t,
    mirrorEvent: {
      findUnique: async ({ where }) => (where.id
        ? t.mirrorEvent.find((e) => e.id === where.id)
        : t.mirrorEvent.find((e) => e.idempotencyKey === where.system_idempotencyKey.idempotencyKey)) || null,
      create: async ({ data }) => { const r = { id: `ev${++seq}`, attemptCount: 0, receivedAt: new Date(), ...data }; t.mirrorEvent.push(r); return r; },
      update: async ({ where, data }) => { const r = t.mirrorEvent.find((e) => e.id === where.id); Object.assign(r, data); return r; },
    },
    legacyRecord: {
      findUnique: async ({ where }) => t.legacyRecord.find((r) => r.sourceId === where.sourceSystem_sourceType_sourceId.sourceId) || null,
      update: async ({ where, data }) => { const r = t.legacyRecord.find((x) => x.sourceId === where.sourceSystem_sourceType_sourceId.sourceId); Object.assign(r, data); return r; },
    },
    operationalIssue: {
      findFirst: async ({ where }) => t.operationalIssue.find((i) => i.dedupeKey === where.dedupeKey && i.status === 'open') || null,
      create: async ({ data }) => { const r = { id: `i${t.operationalIssue.length + 1}`, status: 'open', ...data }; t.operationalIssue.push(r); return r; },
      update: async ({ where, data }) => { const r = t.operationalIssue.find((x) => x.id === where.id); Object.assign(r, data); return r; },
      updateMany: async () => ({ count: 0 }),
    },
  };
}

const TOUR_LINK = { sourceSystem: 'airtable', sourceType: 'tour', sourceId: 'recTOUR', entityId: 't1', entityType: 'TourEvent', syncBaseline: null };
const childEvent = (fields) => ({
  system: 'airtable', entity: 'tourEvent', externalId: 'recCOORD1', changeKind: 'poll',
  transport: 'poll', version: 'v1', rawPayload: { id: 'recCOORD1', fields },
});

// A stub adapter in parent_recompute mode, exercising the ENGINE (not the real
// Airtable derivation, which is covered separately).
function stubChildAdapter({ desired, current, onApply = () => {}, protect = null }) {
  return {
    mode: MODE.PARENT_RECOMPUTE,
    parentSourceType: 'tour',
    async resolveParent(db, event) {
      const recId = event.rawPayload?.fields?.['שם סיור'];
      if (!recId) return null;
      const link = await db.legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'airtable', sourceType: 'tour', sourceId: recId } },
      });
      return link?.entityId ? { sourceId: recId, entityId: link.entityId, entityType: 'tourEvent' } : null;
    },
    derive: async () => desired,
    loadCurrent: async () => current,
    keyOf: (m) => `${m.kind}:${m.dealId ?? m.personRefId}`,
    sameOf: (a, b) => Number(a.seats ?? 0) === Number(b.seats ?? 0),
    protect,
    applyDiff: async (db, parent, diff) => onApply(parent, diff),
  };
}

test('a child change RECOMPUTES the parent and applies the diff', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  let applied = null;
  const adapter = stubChildAdapter({
    desired: [{ kind: 'booking', dealId: 'd1', seats: 25 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
    onApply: (_p, diff) => { applied = diff; },
  });
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recTOUR' }), adapter, { allowApply: true });

  assert.equal(res.outcome, OUTCOME.RECOMPUTED);
  assert.equal(res.entityId, 't1');
  assert.equal(applied.update.length, 1);
  assert.equal(applied.update[0].to.seats, 25);
});

test('the baseline is keyed on the PARENT, so a sibling child change converges', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  const same = [{ kind: 'booking', dealId: 'd1', seats: 20 }];
  const adapter = stubChildAdapter({ desired: same, current: same });
  await ingestMirror(db, childEvent({ 'שם סיור': 'recTOUR' }), adapter, { allowApply: true });

  assert.ok(db._t.legacyRecord[0].syncBaseline?.derivedSet, 'the derived set is the baseline');
  // A different child of the SAME tour, deriving the same set → no work.
  const second = await ingestMirror(db, {
    ...childEvent({ 'שם סיור': 'recTOUR' }), externalId: 'recCOORD2', version: 'v2',
  }, adapter, { allowApply: true });
  assert.equal(second.outcome, OUTCOME.NOOP);
});

test('a child naming an UNKNOWN parent is recorded, never created', async () => {
  const db = recomputeDb({ tourLink: null });
  const adapter = stubChildAdapter({ desired: [], current: [] });
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recGHOST' }), adapter, { allowApply: true });
  assert.equal(res.outcome, OUTCOME.NO_PARENT);
});

test('a child with no parent link at all is recorded, not guessed', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  const adapter = stubChildAdapter({ desired: [], current: [] });
  const res = await ingestMirror(db, childEvent({}), adapter, { allowApply: true });
  assert.equal(res.outcome, OUTCOME.NO_PARENT);
});

test('a protected recompute raises a CONFLICT and writes nothing for that member', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  let applied = null;
  const adapter = stubChildAdapter({
    desired: [{ kind: 'booking', dealId: 'd1', seats: 5 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
    protect: () => 'conflict',
    onApply: (_p, diff) => { applied = diff; },
  });
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recTOUR' }), adapter, { allowApply: true });

  assert.equal(res.outcome, OUTCOME.CONFLICT);
  assert.equal(applied, null, 'nothing applied');
  assert.equal(db._t.operationalIssue.length, 1);
  assert.equal(db._t.operationalIssue[0].type, 'legacy_sync_conflict');
});

test('with apply OFF a child event is buffered, exactly like an entity_merge event', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  let applied = false;
  const adapter = stubChildAdapter({
    desired: [{ kind: 'booking', dealId: 'd1', seats: 25 }],
    current: [{ kind: 'booking', dealId: 'd1', seats: 20 }],
    onApply: () => { applied = true; },
  });
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recTOUR' }), adapter, { allowApply: false });
  assert.equal(res.buffered, true);
  assert.equal(applied, false);
  assert.equal(db._t.mirrorEvent[0].status, 'pending');
});

test('an incomplete parent_recompute adapter fails with the missing function named', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  const { eventId } = await receive(db, childEvent({ 'שם סיור': 'recTOUR' }));
  const res = await processEvent(db, eventId, { mode: MODE.PARENT_RECOMPUTE, parentSourceType: 'tour' }, { allowApply: true });
  assert.equal(res.status, 'pending');
  assert.equal(res.failureCode, 'ADAPTER_CONTRACT_INCOMPLETE');
});

// ── the real Airtable child adapter ──────────────────────────────────────────

test('the tour-children adapter declares parent_recompute and satisfies the contract', () => {
  const a = tourChildrenAdapter({ childKind: 'coordination', deps: {} });
  assert.equal(modeOf(a), MODE.PARENT_RECOMPUTE);
  assert.ok(assertAdapterContract(a));
  assert.equal(a.parentSourceType, 'tour');
});

test('the parent link is read from the table-specific field', () => {
  assert.equal(parentRecIdOf({ fields: { 'שם סיור': ['recTOUR'] } }, 'coordination'), 'recTOUR');
  assert.equal(parentRecIdOf({ fields: { 'שם סיור': 'recTOUR' } }, 'participants'), 'recTOUR');
  assert.equal(parentRecIdOf({ fields: {} }, 'coordination'), null);
  assert.equal(parentRecIdOf({}, 'coordination'), null);
});

test('child tables map to their kinds', () => {
  assert.equal(childKindForTable('tbl1JaGS5oKRIkJ9z'), 'coordination');
  assert.equal(childKindForTable('tbll83BjS4kLMRNuh'), 'participants');
  assert.equal(childKindForTable('tbli0eBDJ6CgCj4iJ'), 'payroll');
  assert.equal(childKindForTable('tblUNKNOWN'), null);
});

test('THE seat guard: a recompute never drops below what GOS already registered', () => {
  const a = tourChildrenAdapter({ childKind: 'coordination', deps: {} });
  // Airtable says 20; GOS has 22 across two real registrations → refuse.
  assert.equal(
    a.protect({ kind: 'booking', dealId: 'd1', seats: 22, registrations: [12, 10] }, { kind: 'booking', dealId: 'd1', seats: 20 }),
    'conflict',
  );
  // Airtable says 25, which is above what is registered → accept.
  assert.deepEqual(
    a.protect({ kind: 'booking', dealId: 'd1', seats: 22, registrations: [12, 10] }, { kind: 'booking', dealId: 'd1', seats: 25 }),
    { kind: 'booking', dealId: 'd1', seats: 25 },
  );
  // Non-booking members are unaffected by the seat rule.
  const asg = { kind: 'assignment', personRefId: 'p1', role: 'guide' };
  assert.deepEqual(a.protect({ ...asg }, asg), asg);
});

test('identity and equality are per-kind, so kinds never collide', () => {
  const a = tourChildrenAdapter({ childKind: 'coordination', deps: {} });
  assert.equal(a.keyOf({ kind: 'booking', dealId: 'd1' }), 'booking:d1');
  assert.equal(a.keyOf({ kind: 'assignment', personRefId: 'p1' }), 'assignment:p1');
  assert.equal(a.keyOf({ kind: 'payroll', externalPersonId: 'e1' }), 'payroll:e1');
  assert.equal(a.sameOf({ kind: 'booking', seats: 5 }, { kind: 'assignment', seats: 5 }), false);
  assert.equal(a.sameOf({ kind: 'assignment', role: 'lead' }, { kind: 'assignment', role: 'guide' }), false);
});

test('the derivation is DELEGATED — this module defines no booking/seat logic of its own', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'sources/airtableTourChildren.js'), 'utf8');
  assert.ok(src.includes("from '../../migration/import/tourImport.js'"), 'must call the shared planner');
  // No second implementation of the aggregation rules.
  assert.ok(!/reduce\([^)]*seats/.test(src.replace(/registrations \|\| \[\]\)\.reduce/g, '')), 'no re-implemented seat summing');
  assert.ok(!/byDeal|mergedRows/.test(src), 'no re-implemented merge-by-deal');
});

// ── no_parent must be INVESTIGABLE, not just terminal ────────────────────────

test('no_parent records WHICH resolution step failed, not just that it did', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  const adapter = {
    ...stubChildAdapter({ desired: [], current: [] }),
    parentSourceType: 'tour',
    childKind: 'coordination',
    resolveParent: async () => ({
      entityId: null, sourceId: 'recGHOST',
      reason: 'parent_not_crosswalked', detail: 'tour recGHOST has no LegacyRecord',
    }),
  };
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recGHOST' }), adapter, { allowApply: true });

  assert.equal(res.outcome, OUTCOME.NO_PARENT);
  assert.equal(res.reason, 'parent_not_crosswalked');

  const row = db._t.mirrorEvent[0];
  assert.equal(row.failureCode, 'parent_not_crosswalked');
  assert.match(row.failureMessage, /no LegacyRecord/);
  // The parent the child POINTED AT is preserved, so "which tour was this row
  // talking about?" is answerable later.
  assert.equal(row.fieldsWritten.attemptedParentSourceId, 'recGHOST');
  assert.equal(row.fieldsWritten.attemptedParentSourceType, 'tour');
  assert.equal(row.fieldsWritten.childKind, 'coordination');
  // And the raw source row is still there to inspect alongside it.
  assert.ok(row.rawPayload);
});

test('a THROWN resolveParent is recorded, not silently turned into a bare no_parent', async () => {
  const db = recomputeDb({ tourLink: { ...TOUR_LINK } });
  const adapter = {
    ...stubChildAdapter({ desired: [], current: [] }),
    resolveParent: async () => { throw new Error('crosswalk lookup exploded'); },
  };
  const res = await ingestMirror(db, childEvent({ 'שם סיור': 'recTOUR' }), adapter, { allowApply: true });
  assert.equal(res.outcome, OUTCOME.NO_PARENT);
  assert.equal(db._t.mirrorEvent[0].failureCode, 'resolve_parent_threw');
  assert.match(db._t.mirrorEvent[0].failureMessage, /crosswalk lookup exploded/);
});

test('the real adapter names all three distinct failure causes', async () => {
  const noLink = { legacyRecord: { findUnique: async () => null } };
  const a = tourChildrenAdapter({ childKind: 'coordination', deps: {} });

  const r1 = await a.resolveParent(noLink, { rawPayload: { fields: {} }, externalId: 'recC1' });
  assert.equal(r1.reason, 'child_has_no_parent_link');
  assert.match(r1.detail, /שם סיור/);

  const r2 = await a.resolveParent(noLink, { rawPayload: { fields: { 'שם סיור': 'recX' } }, externalId: 'recC1' });
  assert.equal(r2.reason, 'parent_not_crosswalked');
  assert.equal(r2.sourceId, 'recX');
  assert.match(r2.detail, /Law 2/, 'names the usual cause so an investigation starts in the right place');

  const orphanXwalk = { legacyRecord: { findUnique: async () => ({ entityId: null, payload: null }) } };
  const r3 = await a.resolveParent(orphanXwalk, { rawPayload: { fields: { 'שם סיור': 'recY' } }, externalId: 'recC1' });
  assert.equal(r3.reason, 'parent_crosswalk_without_entity');
  assert.equal(r3.sourceId, 'recY');
});

test('a resolved parent carries the source-deleted marker for context', async () => {
  const db = { legacyRecord: { findUnique: async () => ({ entityId: 't1', payload: { a: 1 }, sourceDeletedAt: new Date('2026-07-01') }) } };
  const a = tourChildrenAdapter({ childKind: 'payroll', deps: {} });
  const p = await a.resolveParent(db, { rawPayload: { fields: { 'שם סיור': 'recT' } }, externalId: 'x' });
  assert.equal(p.entityId, 't1');
  assert.ok(p.parentSourceDeletedAt, 'a child arriving for a tour that vanished upstream is visible');
});
