// The cutover, exercised END TO END through the real pipeline.
//
// legacyPolicy.test.js pins the DECLARATION. This file pins the CONSEQUENCE: that
// a retired source reaching the pipeline by any route is settled terminally with
// a named reason, that Pipedrive can still deliver a new lead and nothing else,
// and that no legacy path can dispose of GOS state.
//
// Deliberately NOT setting LEGACY_MIRROR_MODE: this file runs in the mode
// production runs in.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MIRROR_APPLY_ENABLED = 'true';
delete process.env.LEGACY_MIRROR_MODE;

import { OUTCOME, ingestMirror, processEvent, receive } from './pipeline.js';
import { removalGuardFor } from './legacyPolicy.js';
import { diffSets } from './modes.js';
import { buildPollTargets } from './adapters.js';

// ── a minimal stand-in for the tables the pipeline touches ───────────────────
function db({ crosswalk = [] } = {}) {
  const t = { mirrorEvent: [], legacyRecord: crosswalk.map((r) => ({ ...r })), timelineEntry: [{ id: 'tl1' }] };
  let seq = 0;
  const xkey = (w) => `${w.sourceSystem}|${w.sourceType}|${w.sourceId}`;
  return {
    _t: t,
    mirrorEvent: {
      findUnique: async ({ where }) => (where.id
        ? t.mirrorEvent.find((e) => e.id === where.id) || null
        : t.mirrorEvent.find((e) => e.system === where.system_idempotencyKey.system
            && e.idempotencyKey === where.system_idempotencyKey.idempotencyKey) || null),
      create: async ({ data }) => {
        const row = { id: `ev${++seq}`, attemptCount: 0, receivedAt: new Date(), ...data };
        t.mirrorEvent.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = t.mirrorEvent.find((e) => e.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    legacyRecord: {
      findUnique: async ({ where }) => t.legacyRecord.find((r) => xkey(r) === xkey(where.sourceSystem_sourceType_sourceId)) || null,
      update: async ({ where, data }) => {
        const row = t.legacyRecord.find((r) => xkey(r) === xkey(where.sourceSystem_sourceType_sourceId));
        Object.assign(row, data);
        return row;
      },
    },
    timelineEntry: {
      deleteMany: async ({ where }) => {
        const before = t.timelineEntry.length;
        t.timelineEntry = t.timelineEntry.filter((r) => r.id !== where.id);
        return { count: before - t.timelineEntry.length };
      },
    },
  };
}

const evt = (over = {}) => ({
  system: 'pipedrive', entity: 'deal', externalId: '501', changeKind: 'updated',
  transport: 'webhook', version: 'v1', rawPayload: { current: { id: 501, title: 'X' } }, ...over,
});

// An adapter that RECORDS whether the engine ever asked it to do anything. A
// retired source must never reach any of these.
function spyAdapter(over = {}) {
  const calls = { normalize: 0, loadGos: 0, applyGos: 0, createGos: 0, applySourceDeleted: 0, applyChannels: 0 };
  return {
    calls,
    sourceType: 'deal',
    async normalize(payload) {
      calls.normalize += 1;
      const deleted = payload?.meta?.action === 'deleted';
      return { fields: { title: 'FROM LEGACY' }, sourceDeleted: deleted, channels: { phones: ['0501234567'] } };
    },
    async loadGos() { calls.loadGos += 1; return { id: 'd1', title: 'GOS VALUE' }; },
    async applyGos() { calls.applyGos += 1; },
    async applyChannels() { calls.applyChannels += 1; return { phones: 1, emails: 0 }; },
    async applySourceDeleted(_db, id) { calls.applySourceDeleted += 1; await _db.timelineEntry.deleteMany({ where: { id } }); return { deleted: 1 }; },
    async createGos() { calls.createGos += 1; return { entityType: 'Deal', entityId: 'newdeal' }; },
    describe: () => ({ label: 'x' }),
    ...over,
  };
}

const XWALK_DEAL = [{ sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: '501', entityType: 'deal', entityId: 'd1', syncBaseline: { title: 'base' } }];

// ── AIRTABLE IS GONE ─────────────────────────────────────────────────────────

test('an Airtable event is settled TERMINALLY and never touches an adapter', async () => {
  const d = db();
  const a = spyAdapter();
  const res = await ingestMirror(d, evt({ system: 'airtable', entity: 'tourEvent', externalId: 'recX' }), a);
  assert.equal(res.status, 'skipped');
  assert.equal(res.outcome, OUTCOME.LEGACY_RETIRED);
  assert.equal(d._t.mirrorEvent[0].failureCode, 'airtable_retired');
  assert.deepEqual(a.calls, { normalize: 0, loadGos: 0, applyGos: 0, createGos: 0, applySourceDeleted: 0, applyChannels: 0 });
});

test('retirement beats the APPLY GATE — a retired event is settled, never buffered', async () => {
  // The apply gate deliberately leaves events pending so a paused mirror loses
  // nothing. Doing that for a retired source would build a queue of work that
  // will never be done, while the mirror reports itself healthy.
  const d = db();
  const { eventId } = await receive(d, evt({ system: 'airtable', entity: 'tourEvent', externalId: 'recY' }));
  const res = await processEvent(d, eventId, spyAdapter(), { allowApply: false });
  assert.equal(res.status, 'skipped');
  assert.equal(res.outcome, OUTCOME.LEGACY_RETIRED);
  assert.notEqual(d._t.mirrorEvent[0].status, 'pending');
});

test('no Airtable poll target is built at all', () => {
  const targets = buildPollTargets({ ingest: () => {}, airtableClient: { __stub: true }, prisma: null });
  assert.equal(targets.filter((t) => t.system === 'airtable').length, 0);
});

test('the Pipedrive files poll is retired too', () => {
  const targets = buildPollTargets({
    ingest: () => {},
    airtableClient: null,
    prisma: null,
    env: { PIPEDRIVE_API_TOKEN: 'x', PIPEDRIVE_COMPANY_DOMAIN: 'y', MIRROR_FILES_POLL_ENABLED: 'true' },
  });
  assert.equal(targets.filter((t) => t.entity === 'file').length, 0);
});

// ── PIPEDRIVE IS A LEAD INGRESS AND NOTHING ELSE ─────────────────────────────

test('a NEW lead still arrives — this is the whole remaining point of Pipedrive', async () => {
  const d = db();                       // no crosswalk => a record GOS has never seen
  const a = spyAdapter();
  const res = await ingestMirror(d, evt(), a);
  assert.equal(res.outcome, OUTCOME.CREATED);
  assert.equal(a.calls.createGos, 1);
});

test('a change to a deal GOS already holds is REFUSED, and GOS is untouched', async () => {
  const d = db({ crosswalk: XWALK_DEAL });
  const a = spyAdapter();
  const res = await ingestMirror(d, evt(), a);
  assert.equal(res.status, 'skipped');
  assert.equal(res.outcome, OUTCOME.LEGACY_RETIRED);
  assert.equal(d._t.mirrorEvent[0].failureCode, 'pipedrive_update_retired');
  assert.equal(a.calls.applyGos, 0, 'no field may be written');
  assert.equal(a.calls.loadGos, 0, 'the merge must not even run');
});

test('no contacts sync — not even the append-only phone reconciliation', async () => {
  const d = db({ crosswalk: [{ ...XWALK_DEAL[0], sourceType: 'person', sourceId: '77', entityType: 'contact', entityId: 'c1' }] });
  const a = spyAdapter({ sourceType: 'person' });
  await ingestMirror(d, evt({ entity: 'contact', externalId: '77' }), a);
  assert.equal(a.calls.applyChannels, 0);
});

test('notes, activities and files are refused with their own named reason', async () => {
  for (const [entity, code] of [['note', 'pipedrive_note_sync_retired'], ['task', 'pipedrive_task_sync_retired']]) {
    const d = db();
    const res = await ingestMirror(d, evt({ entity, externalId: '9' }), spyAdapter());
    assert.equal(res.outcome, OUTCOME.LEGACY_RETIRED, entity);
    assert.equal(d._t.mirrorEvent[0].failureCode, code);
  }
});

// ── PROPOSE, NEVER DISPOSE ───────────────────────────────────────────────────

test('a deletion in Pipedrive is RECORDED but destroys nothing in GOS', async () => {
  const d = db({ crosswalk: XWALK_DEAL });
  const a = spyAdapter();
  const res = await ingestMirror(d, evt({
    changeKind: 'deleted',
    rawPayload: { meta: { action: 'deleted', object: 'deal' }, current: { id: 501 } },
  }), a);
  assert.equal(res.outcome, OUTCOME.SOURCE_DELETED);
  assert.equal(a.calls.applySourceDeleted, 0, 'the disposal path must not run');
  assert.equal(d._t.timelineEntry.length, 1, 'the GOS row survives');
  assert.ok(d._t.legacyRecord[0].sourceDeletedAt, 'but the fact IS recorded on the crosswalk');
});

test('THE INCIDENT SHAPE: a member vanishing from the source becomes a decision, not a deletion', () => {
  // 2026-07-31: bookings created by the migration import have no legacy row at
  // all, so a recompute classified them as removals and cancelled three of them
  // on the next morning's tour. Absence of a legacy row is not evidence that
  // live GOS state should die.
  const guard = removalGuardFor('airtable', 'tourEvent', () => undefined); // adapter would ALLOW it
  const diff = diffSets({
    current: [{ id: 'booking_from_migration', seats: 8 }],
    desired: [],
    keyOf: (m) => m.id,
    sameOf: (a, b) => a.seats === b.seats,
    protectRemoval: guard,
  });
  assert.equal(diff.remove.length, 0, 'nothing may be removed');
  assert.equal(diff.conflicts.length, 1);
  assert.equal(diff.conflicts[0].kind, 'removal');
});

test('the engine overrules a permissive adapter — architecture is not the adapter’s call', () => {
  const permissive = () => undefined;
  assert.equal(removalGuardFor('airtable', 'tourEvent', permissive)({}), 'conflict');
  assert.equal(removalGuardFor('pipedrive', 'deal', permissive)({}), 'conflict');
  // …and the break-glass does NOT hand it back. Disposal is permanently
  // un-grantable (owner ruling 2026-07-31), so there is no mode in which an
  // adapter's own removal policy is consulted again.
  assert.equal(
    removalGuardFor('airtable', 'tourEvent', permissive, { LEGACY_MIRROR_MODE: 'full_mirror' })({}),
    'conflict',
  );
});
