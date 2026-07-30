import test from 'node:test';
import assert from 'node:assert/strict';

// This file exercises the APPLY path, so apply is on for it. The buffering
// behaviour (apply off) is tested explicitly with an { allowApply: false }
// override, which is the same switch the runtime flag feeds.
process.env.MIRROR_APPLY_ENABLED = 'true';

import { OUTCOME, buildIdempotencyKey, ingestMirror, mirroredEntities, processEvent, receive } from './pipeline.js';
import { CLAIM_TTL_MS, claimOneEvent, mirrorHealth, runPollTick, runRetryTick } from './worker.js';
import { resolveConflict } from './resolve.js';
import { pdDate, toMinor, dealAdapter, entityForPipedriveObject, isDeleteEvent } from './sources/pipedriveMirror.js';

// ── an in-memory stand-in for the tables the mirror touches ──────────────────
function mirrorDb({ crosswalk = [], deals = [], issues = [] } = {}) {
  // Deep-copy: the mirror MUTATES crosswalk rows (advanceBaseline), so sharing
  // object references between tests leaks one test's baseline into the next.
  const t = {
    mirrorEvent: [], mirrorCursor: [],
    legacyRecord: crosswalk.map((r) => ({ ...r })),
    deal: deals.map((d) => ({ ...d })),
    operationalIssue: issues.map((i) => ({ ...i })),
  };
  let seq = 0;
  const xkey = (w) => `${w.sourceSystem}|${w.sourceType}|${w.sourceId}`;
  const db = {
    _t: t,
    mirrorEvent: {
      findUnique: async ({ where, select }) => {
        const row = where.id
          ? t.mirrorEvent.find((e) => e.id === where.id)
          : t.mirrorEvent.find((e) => e.system === where.system_idempotencyKey.system
              && e.idempotencyKey === where.system_idempotencyKey.idempotencyKey);
        return row ? (select ? row : { ...row }) : null;
      },
      findFirst: async ({ where }) => t.mirrorEvent.find((e) =>
        (!where.gosEntityId || e.gosEntityId === where.gosEntityId)
        && (!where.outcome || e.outcome === where.outcome)) || null,
      findMany: async ({ where = {}, take = 100 }) => t.mirrorEvent
        .filter((e) => (!where.status || e.status === where.status)).slice(0, take),
      create: async ({ data }) => {
        if (t.mirrorEvent.some((e) => e.system === data.system && e.idempotencyKey === data.idempotencyKey)) {
          const err = new Error('unique'); err.code = 'P2002'; throw err;
        }
        const row = { id: `ev${++seq}`, attemptCount: 0, receivedAt: new Date(), ...data };
        t.mirrorEvent.push(row); return row;
      },
      update: async ({ where, data }) => {
        const row = t.mirrorEvent.find((e) => e.id === where.id);
        Object.assign(row, data); return row;
      },
      // Honours the claim predicate, so "already claimed" genuinely loses —
      // otherwise the concurrency test would pass without testing anything.
      updateMany: async ({ where, data }) => {
        const staleBefore = where.OR?.find((o) => o.claimedAt?.lt)?.claimedAt?.lt ?? null;
        const hits = t.mirrorEvent.filter((e) => {
          if (e.id !== where.id || e.status !== where.status) return false;
          if (!where.OR) return true;
          return e.claimedAt == null || (staleBefore && e.claimedAt < staleBefore);
        });
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      },
      count: async ({ where = {} } = {}) => t.mirrorEvent.filter((e) =>
        (!where.status || e.status === where.status) && (!where.outcome || e.outcome === where.outcome)).length,
    },
    mirrorCursor: {
      findUnique: async ({ where }) => t.mirrorCursor.find((c) => c.id === where.id) || null,
      findMany: async () => t.mirrorCursor,
      upsert: async ({ where, create }) => {
        let row = t.mirrorCursor.find((c) => c.id === where.id);
        if (!row) { row = { failureStreak: 0, ...create }; t.mirrorCursor.push(row); }
        return row;
      },
      updateMany: async ({ where, data }) => {
        const row = t.mirrorCursor.find((c) => c.id === where.id);
        if (!row) return { count: 0 };
        const free = row.claimedAt == null || row.claimedAt < where.OR?.[1]?.claimedAt?.lt;
        if (!free) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      update: async ({ where, data }) => {
        const row = t.mirrorCursor.find((c) => c.id === where.id);
        for (const [k, v] of Object.entries(data)) {
          row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] || 0) + v.increment : v;
        }
        return row;
      },
    },
    legacyRecord: {
      findUnique: async ({ where }) => t.legacyRecord.find((r) => xkey(r) === xkey(where.sourceSystem_sourceType_sourceId)) || null,
      update: async ({ where, data }) => {
        const row = t.legacyRecord.find((r) => xkey(r) === xkey(where.sourceSystem_sourceType_sourceId));
        Object.assign(row, data); return row;
      },
    },
    deal: {
      findUnique: async ({ where }) => t.deal.find((d) => d.id === where.id) || null,
      update: async ({ where, data }) => { const d = t.deal.find((x) => x.id === where.id); Object.assign(d, data); return d; },
    },
    quoteVersion: { count: async () => 0 },
    operationalIssue: {
      findFirst: async ({ where }) => t.operationalIssue.find((i) => i.dedupeKey === where.dedupeKey && ['open', 'acknowledged'].includes(i.status)) || null,
      create: async ({ data }) => { const row = { id: `i${t.operationalIssue.length + 1}`, status: 'open', ...data }; t.operationalIssue.push(row); return row; },
      update: async ({ where, data }) => { const i = t.operationalIssue.find((x) => x.id === where.id); Object.assign(i, data); return i; },
      updateMany: async ({ where, data }) => {
        const hits = t.operationalIssue.filter((i) => (where.id ? i.id === where.id : i.dedupeKey === where.dedupeKey) && ['open', 'acknowledged'].includes(i.status));
        hits.forEach((i) => Object.assign(i, data));
        return { count: hits.length };
      },
    },
  };
  return db;
}

const XWALK = [{ sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: '501', entityType: 'deal', entityId: 'd1', syncBaseline: null }];
const DEAL = { id: 'd1', orderNo: 12345, title: 'A', status: 'open', valueMinor: 100n, currency: 'ILS', wonAt: null, lostAt: null, lostReason: null, expectedCloseDate: null, dealStageId: 's1', wonQuoteRef: null };
const pdPayload = (over = {}) => ({ meta: { action: 'updated', object: 'deal' }, current: { id: 501, title: 'A', status: 'open', value: 1, currency: 'ILS', ...over } });
const ADAPTER = dealAdapter({});

// ── receipt + idempotency ────────────────────────────────────────────────────

test('the raw payload is persisted BEFORE processing', async () => {
  const db = mirrorDb();
  const { eventId, duplicate } = await receive(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', rawPayload: pdPayload(),
  });
  assert.equal(duplicate, false);
  const row = db._t.mirrorEvent.find((e) => e.id === eventId);
  assert.equal(row.status, 'pending');
  assert.deepEqual(row.rawPayload, pdPayload());
});

test('a webhook redelivery is recognised and never processed twice', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = { system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: 'v1', rawPayload: pdPayload({ title: 'B' }) };
  const a = await ingestMirror(db, args, ADAPTER);
  const b = await ingestMirror(db, args, ADAPTER);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(db._t.mirrorEvent.length, 1);
});

test('the same record at a NEW version is a new event', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const base = { system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', rawPayload: pdPayload() };
  await ingestMirror(db, { ...base, version: 'v1' }, ADAPTER);
  await ingestMirror(db, { ...base, version: 'v2' }, ADAPTER);
  assert.equal(db._t.mirrorEvent.length, 2);
});

test('the idempotency key covers system, entity, id, kind and version', () => {
  const k = (o) => buildIdempotencyKey({ system: 'pipedrive', entity: 'deal', externalId: '1', changeKind: 'updated', version: 'v1', ...o });
  const base = k({});
  for (const o of [{ system: 'airtable' }, { entity: 'contact' }, { externalId: '2' }, { changeKind: 'deleted' }, { version: 'v2' }]) {
    assert.notEqual(k(o), base);
  }
});

// ── the merge outcomes, end to end ───────────────────────────────────────────

test('first contact BOOTSTRAPS: nothing is written to GOS', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'v1', rawPayload: pdPayload({ title: 'CHANGED' }),
  }, ADAPTER);
  assert.equal(res.outcome, OUTCOME.BOOTSTRAPPED);
  assert.equal(db._t.deal[0].title, 'A', 'GOS untouched on first contact');
  assert.ok(db._t.legacyRecord[0].syncBaseline, 'but a baseline is adopted');
});

test('after bootstrap, a source change MERGES', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = (v, title) => ({ system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: v, rawPayload: pdPayload({ title }) });
  await ingestMirror(db, args('v1', 'A'), ADAPTER);
  const res = await ingestMirror(db, args('v2', 'B'), ADAPTER);
  assert.equal(res.outcome, OUTCOME.MERGED);
  assert.equal(db._t.deal[0].title, 'B');
});

test('a human edit is NOT overwritten — it raises a conflict', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = (v, title) => ({ system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: v, rawPayload: pdPayload({ title }) });
  await ingestMirror(db, args('v1', 'A'), ADAPTER);
  db._t.deal[0].title = 'EDITED IN GOS';
  const res = await ingestMirror(db, args('v2', 'CHANGED IN PIPEDRIVE'), ADAPTER);

  assert.equal(res.outcome, OUTCOME.CONFLICT);
  assert.equal(db._t.deal[0].title, 'EDITED IN GOS', 'GOS is untouched');
  assert.equal(db._t.operationalIssue.length, 1);
  assert.equal(db._t.operationalIssue[0].type, 'legacy_sync_conflict');
});

test('an unresolved conflict does NOT advance the baseline, so it re-raises', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = (v, title) => ({ system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: v, rawPayload: pdPayload({ title }) });
  await ingestMirror(db, args('v1', 'A'), ADAPTER);
  db._t.deal[0].title = 'EDITED';
  await ingestMirror(db, args('v2', 'X'), ADAPTER);
  const baselineAfter = db._t.legacyRecord[0].syncBaseline.title;
  assert.equal(baselineAfter, 'A', 'baseline must NOT move past the conflict');

  const again = await ingestMirror(db, args('v3', 'X'), ADAPTER);
  assert.equal(again.outcome, OUTCOME.CONFLICT, 'it re-raises until a human decides');
});

test('a record with no crosswalk is recorded, never created', async () => {
  const db = mirrorDb({ crosswalk: [], deals: [] });
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '999', changeKind: 'updated',
    transport: 'webhook', version: 'v1', rawPayload: pdPayload({ id: 999 }),
  }, ADAPTER);
  assert.equal(res.outcome, OUTCOME.NOT_CROSSWALKED);
  assert.equal(db._t.deal.length, 0, 'the mirror NEVER creates records');
});

test('a source deletion is recorded, never applied', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'deleted',
    transport: 'webhook', version: 'v1',
    rawPayload: { meta: { action: 'deleted', object: 'deal' }, current: null },
  }, ADAPTER);
  assert.equal(res.outcome, OUTCOME.SOURCE_DELETED);
  assert.equal(db._t.deal.length, 1, 'the GOS record survives');
  assert.ok(db._t.legacyRecord[0].sourceDeletedAt, 'the disappearance is recorded');
});

test('a cut-over source is IGNORED by the mirror (no two active writers)', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  process.env.SOURCE_WRITER_META = 'direct';
  try {
    const res = await ingestMirror(db, {
      system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
      transport: 'webhook', version: 'vx',
      rawPayload: { meta: { action: 'updated' }, current: { id: 501, title: 'X', '35a2565c8f374bbb994cd97accedaff2db273aba': 'פייסבוק' } },
    }, ADAPTER);
    assert.equal(res.outcome, OUTCOME.IGNORED_SOURCE_CUT_OVER);
    assert.equal(db._t.deal[0].title, 'A');
  } finally { delete process.env.SOURCE_WRITER_META; }
});

test('GOS-owned fields are never written even when the source sends them', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL, wonQuoteRef: { offerId: 'o1' } }] });
  const args = (v, value) => ({ system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: v, rawPayload: pdPayload({ value }) });
  await ingestMirror(db, args('v1', 1), ADAPTER);
  await ingestMirror(db, args('v2', 999), ADAPTER);
  assert.equal(db._t.deal[0].valueMinor, 100n, 'a signed quote is never overwritten by a stale value');
});

// ── pipedrive translation ────────────────────────────────────────────────────

test('money converts to minor units by ROUNDING, never truncation', () => {
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor('0.1'), 10);
  assert.equal(toMinor(null), null);
  assert.equal(toMinor('nonsense'), null);
});

test("Pipedrive's space-separated timestamp is parsed as UTC", () => {
  assert.equal(pdDate('2026-07-29 10:00:00').toISOString(), '2026-07-29T10:00:00.000Z');
  assert.equal(pdDate('rubbish'), null);
  assert.equal(pdDate(null), null);
});

test('delete events are detected from either the action or a null current', () => {
  assert.equal(isDeleteEvent({ meta: { action: 'deleted' } }), true);
  assert.equal(isDeleteEvent({ meta: { action: 'updated' }, current: null }), true);
  assert.equal(isDeleteEvent({ meta: { action: 'updated' }, current: { id: 1 } }), false);
});

test('webhook object names map to entity keys', () => {
  assert.equal(entityForPipedriveObject('deal'), 'deal');
  assert.equal(entityForPipedriveObject('person'), 'contact');
  assert.equal(entityForPipedriveObject('organization'), 'organization');
  assert.equal(entityForPipedriveObject('nonsense'), null);
});

test('an unmapped stage is omitted, never nulled into the first column', async () => {
  const a = dealAdapter({ stageKeyForPipedriveStage: () => null, stageIdForKey: () => 'x' });
  const n = await a.normalize(pdPayload({ stage_id: 77 }));
  assert.equal('dealStageId' in n.fields, false);
});

test('mirroredEntities splits by owning system', () => {
  assert.ok(mirroredEntities('pipedrive').includes('deal'));
  assert.ok(mirroredEntities('airtable').includes('tourEvent'));
  assert.ok(!mirroredEntities('airtable').includes('deal'));
});

// ── workers ──────────────────────────────────────────────────────────────────

test('a claimed event cannot be claimed twice', async () => {
  const db = mirrorDb();
  db._t.mirrorEvent.push({ id: 'e1', status: 'pending', receivedAt: new Date(), claimedAt: null });
  assert.equal(await claimOneEvent(db), 'e1');
  assert.equal(await claimOneEvent(db), null, 'the second worker gets nothing');
});

test('a stale claim is reclaimed rather than wedging the event forever', async () => {
  const db = mirrorDb();
  db._t.mirrorEvent.push({
    id: 'e1', status: 'pending', receivedAt: new Date(),
    claimedAt: new Date(Date.now() - CLAIM_TTL_MS - 1000),
  });
  assert.equal(await claimOneEvent(db), 'e1');
});

test('the retry worker processes what it claims', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  await receive(db, { system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: 'v1', rawPayload: pdPayload() });
  const stats = await runRetryTick(db, () => ADAPTER);
  assert.equal(stats.claimed, 1);
  assert.equal(stats.processed, 1);
});

test('an event with no adapter is KEPT, not discarded', async () => {
  // This test used to assert `skipped`, and that assertion was the bug: a missing
  // adapter is a configuration gap, not a decision about the data. Marking it
  // terminal destroyed a real change nothing would ever replay — which is exactly
  // what happened to two Airtable coordination events on 2026-07-30.
  const db = mirrorDb();
  await receive(db, { system: 'pipedrive', entity: 'deal', externalId: '1', changeKind: 'updated', transport: 'webhook', version: 'v', rawPayload: {} });
  await runRetryTick(db, () => null);
  assert.equal(db._t.mirrorEvent[0].status, 'pending', 'the event must survive so it can be applied once the adapter exists');
  assert.equal(db._t.mirrorEvent[0].failureCode, 'no_adapter', 'and the reason must be visible in health');
});

test('the poller feeds the SAME pipeline and advances its cursor', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const source = {
    fetchChanges: async () => ({
      records: [{ externalId: '501', version: 'p1', payload: pdPayload({ title: 'FROM POLL' }) }],
      nextCursor: '2026-07-29T00:00:00Z',
    }),
  };
  const stats = await runPollTick(db, { system: 'pipedrive', entity: 'deal', source, adapter: ADAPTER, ingest: ingestMirror });
  assert.equal(stats.fetched, 1);
  assert.equal(stats.processed, 1);
  assert.equal(db._t.mirrorCursor[0].cursor, '2026-07-29T00:00:00Z');
  assert.equal(db._t.mirrorCursor[0].failureStreak, 0);
});

test('a poll that re-sees the same version is a duplicate, not reprocessing', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const source = { fetchChanges: async () => ({ records: [{ externalId: '501', version: 'same', payload: pdPayload() }], nextCursor: 'c' }) };
  const target = { system: 'pipedrive', entity: 'deal', source, adapter: ADAPTER, ingest: ingestMirror };
  await runPollTick(db, target);
  db._t.mirrorCursor[0].claimedAt = null;
  const second = await runPollTick(db, target);
  assert.equal(second.duplicates, 1);
  assert.equal(db._t.mirrorEvent.length, 1);
});

test('a failing poll records the error and increments the streak', async () => {
  const db = mirrorDb();
  const source = { fetchChanges: async () => { throw new Error('pipedrive is down'); } };
  await assert.rejects(() => runPollTick(db, { system: 'pipedrive', entity: 'deal', source, adapter: ADAPTER, ingest: ingestMirror }));
  assert.equal(db._t.mirrorCursor[0].failureStreak, 1);
  assert.match(db._t.mirrorCursor[0].lastError, /pipedrive is down/);
});

test('health surfaces a SILENTLY dead poller — the worst failure mode', async () => {
  const db = mirrorDb();
  db._t.mirrorCursor.push({ id: 'airtable:tourEvent', failureStreak: 0, lastRunAt: new Date(), lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000) });
  const h = await mirrorHealth(db);
  assert.equal(h.ok, false);
  assert.equal(h.problems[0].problem, 'stale');
});

test('health surfaces dead events needing a human', async () => {
  const db = mirrorDb();
  db._t.mirrorEvent.push({ id: 'e', status: 'dead' });
  const h = await mirrorHealth(db);
  assert.ok(h.problems.some((p) => p.problem === 'dead_events'));
});

// ── conflict resolution ──────────────────────────────────────────────────────

async function conflictFixture() {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = (v, title) => ({ system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: v, rawPayload: pdPayload({ title }) });
  await ingestMirror(db, args('v1', 'A'), ADAPTER);
  db._t.deal[0].title = 'GOS WINS';
  await ingestMirror(db, args('v2', 'LEGACY WINS'), ADAPTER);
  return { db, issue: db._t.operationalIssue[0] };
}

test('accept_legacy writes the source value AND advances the baseline', async () => {
  const { db, issue } = await conflictFixture();
  const res = await resolveConflict(db, {
    issue, choice: 'accept_legacy', sourceType: 'deal',
    apply: (d, id, set) => d.deal.update({ where: { id }, data: set }),
  });
  assert.deepEqual(res.fieldsWritten, ['title']);
  assert.equal(db._t.deal[0].title, 'LEGACY WINS');
  assert.equal(db._t.legacyRecord[0].syncBaseline.title, 'LEGACY WINS');
  assert.equal(db._t.operationalIssue[0].status, 'resolved');
});

test('keep_gos writes NOTHING but still advances the baseline', async () => {
  const { db, issue } = await conflictFixture();
  const res = await resolveConflict(db, {
    issue, choice: 'keep_gos', sourceType: 'deal',
    apply: () => { throw new Error('must not write'); },
  });
  assert.deepEqual(res.fieldsWritten, []);
  assert.equal(db._t.deal[0].title, 'GOS WINS');
  assert.equal(db._t.legacyRecord[0].syncBaseline.title, 'LEGACY WINS',
    'baseline moves to the source: we have SEEN it and chosen GOS');
});

test('after keep_gos the SAME source value no longer conflicts', async () => {
  const { db, issue } = await conflictFixture();
  await resolveConflict(db, { issue, choice: 'keep_gos', sourceType: 'deal', apply: () => {} });
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'v3', rawPayload: pdPayload({ title: 'LEGACY WINS' }),
  }, ADAPTER);
  assert.equal(res.outcome, OUTCOME.NOOP, 'resolved for good');
});

test('after keep_gos a NEW source change conflicts again — that is new information', async () => {
  const { db, issue } = await conflictFixture();
  await resolveConflict(db, { issue, choice: 'keep_gos', sourceType: 'deal', apply: () => {} });
  db._t.operationalIssue.length = 0;
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'v4', rawPayload: pdPayload({ title: 'SOMETHING ELSE' }),
  }, ADAPTER);
  assert.equal(res.outcome, OUTCOME.CONFLICT);
});

test('resolution refuses an unknown choice and a malformed issue', async () => {
  const { db, issue } = await conflictFixture();
  await assert.rejects(() => resolveConflict(db, { issue, choice: 'push_to_pipedrive', sourceType: 'deal', apply: () => {} }),
    (e) => e.code === 'UNKNOWN_CHOICE');
  await assert.rejects(() => resolveConflict(db, { issue: { id: 'x', data: {} }, choice: 'keep_gos', sourceType: 'deal', apply: () => {} }),
    (e) => e.code === 'MALFORMED_ISSUE');
});

test('resolution never writes a field the ownership map protects', async () => {
  const { db, issue } = await conflictFixture();
  // Forge a conflict on a GOS-owned field; it must be skipped, not written.
  db._t.mirrorEvent.find((e) => e.outcome === 'conflict').conflicts.push({ field: 'orderNo', base: 1, source: 999, gos: 12345 });
  const res = await resolveConflict(db, {
    issue, choice: 'accept_legacy', sourceType: 'deal',
    apply: (d, id, set) => d.deal.update({ where: { id }, data: set }),
  });
  assert.ok(!res.fieldsWritten.includes('orderNo'));
  assert.deepEqual(res.skipped, ['orderNo']);
  assert.equal(db._t.deal[0].orderNo, 12345);
});

// ── the law ──────────────────────────────────────────────────────────────────

test('LAW: no mirror module exports anything that writes to a legacy system', async () => {
  for (const mod of ['./pipeline.js', './worker.js', './resolve.js', './baseline.js', './sources/pipedriveMirror.js']) {
    const m = await import(mod);
    for (const name of Object.keys(m)) {
      assert.ok(!/^(push|send|write|update|delete)(To)?(Pipedrive|Airtable|Legacy|Source)/i.test(name),
        `${mod} exports ${name}, which looks like a write back to legacy`);
    }
  }
});

// ── the apply gate (Phase A: capture on, apply off) ──────────────────────────

test('with apply OFF an event is buffered, not applied, and stays pending', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'v1', rawPayload: pdPayload({ title: 'CHANGED' }),
  }, ADAPTER, { allowApply: false });

  assert.equal(res.buffered, true);
  assert.equal(res.status, 'pending', 'stays pending so apply can pick it up later');
  assert.equal(db._t.deal[0].title, 'A', 'GOS untouched');
  assert.equal(db._t.mirrorEvent[0].outcome, null, 'never marked with an outcome');
  assert.equal(db._t.legacyRecord[0].syncBaseline, null, 'and the baseline is NOT advanced');
});

test('a buffered event applies correctly once apply is permitted', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  const args = { system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: 'v1', rawPayload: pdPayload({ title: 'CHANGED' }) };
  await ingestMirror(db, args, ADAPTER, { allowApply: false });
  const id = db._t.mirrorEvent[0].id;

  // Seed the baseline as the cutover import would, then replay with apply on.
  db._t.legacyRecord[0].syncBaseline = { title: 'A' };
  const { processEvent } = await import('./pipeline.js');
  const res = await processEvent(db, id, ADAPTER, { allowApply: true });

  assert.equal(res.outcome, 'merged');
  assert.equal(db._t.deal[0].title, 'CHANGED', 'the buffered change IS applied');
});

test('THE regression this design exists to prevent: a seeded baseline stops bootstrap swallowing a change', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  // Cutover import seeded the baseline from the snapshot ('A').
  db._t.legacyRecord[0].syncBaseline = { title: 'A' };
  // A change that happened AFTER the snapshot now arrives.
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'v9', rawPayload: pdPayload({ title: 'POST-SNAPSHOT CHANGE' }),
  }, ADAPTER, { allowApply: true });

  assert.equal(res.outcome, 'merged', 'NOT bootstrapped');
  assert.equal(db._t.deal[0].title, 'POST-SNAPSHOT CHANGE', 'the change is applied, not swallowed');
});

test('a pre-snapshot event WRITES NOTHING — no timestamp filtering needed', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  db._t.legacyRecord[0].syncBaseline = { title: 'A' };
  const before = { ...db._t.deal[0] };
  const res = await ingestMirror(db, {
    system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
    transport: 'webhook', version: 'old', rawPayload: pdPayload({ title: 'A' }),
  }, ADAPTER, { allowApply: true });

  // Fields present in the baseline no-op; fields the seed did not cover and on
  // which both sides already agree CONVERGE (baseline catches up, nothing is
  // written). Either way the GOS record is untouched, which is the property
  // that makes replaying a pre-boundary event safe.
  assert.ok(['noop', 'converged'].includes(res.outcome), `unexpected outcome ${res.outcome}`);
  assert.deepEqual(res.written, [], 'nothing written');
  assert.deepEqual({ ...db._t.deal[0] }, before, 'the GOS record is byte-identical');
});

test('replaying the SAME pre-snapshot event twice is indistinguishable from once', async () => {
  const db = mirrorDb({ crosswalk: XWALK, deals: [{ ...DEAL }] });
  db._t.legacyRecord[0].syncBaseline = { title: 'A' };
  const args = { system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated', transport: 'webhook', version: 'old', rawPayload: pdPayload({ title: 'A' }) };
  await ingestMirror(db, args, ADAPTER, { allowApply: true });
  const after1 = { ...db._t.deal[0] };
  await ingestMirror(db, args, ADAPTER, { allowApply: true });
  assert.deepEqual({ ...db._t.deal[0] }, after1);
});

test('a buffered event releases its claim — buffering is not work in progress', async () => {
  // The apply gate left claimedAt/claimedBy set, so every buffered event looked
  // mid-flight in a worker that was not touching it. On production that read as
  // "63 events claimed" during the Phase A gate.
  const db = mirrorDb();
  const r = await receive(db, { system: 'pipedrive', entity: 'deal', externalId: '77', changeKind: 'updated', transport: 'webhook', version: 'v', rawPayload: pdPayload({ title: 'x' }) });
  await db.mirrorEvent.update({ where: { id: r.eventId }, data: { claimedAt: new Date(), claimedBy: 'worker-1' } });

  const res = await processEvent(db, r.eventId, ADAPTER, { allowApply: false });
  assert.equal(res.buffered, true);
  const row = db._t.mirrorEvent.find((e) => e.id === r.eventId);
  assert.equal(row.status, 'pending', 'still buffered');
  assert.equal(row.claimedAt, null, 'the claim must be released');
  assert.equal(row.claimedBy, null);
  assert.equal(row.processedAt ?? null, null, 'and nothing may be marked processed');
});
