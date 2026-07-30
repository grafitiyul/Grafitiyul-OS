import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateDeletability, deleteCommunicationEvent } from './deleteEvent.js';
import { requireAdminUser } from '../auth.js';

// The hard-delete contract for Communication Center events:
//   • deletable ONLY when nothing was sent and nothing was published
//   • the event row is the single cascade root — no manual child deletes, so
//     nothing can be orphaned or partially deleted
//   • every delete writes an audit row, in the SAME transaction
//   • an unidentified caller is refused, even in bootstrap mode

// ── fixtures ─────────────────────────────────────────────────────────────────

const msg = (over = {}) => ({
  id: 'm1', publicNumber: 24, internalName: 'וואטסאפ ללקוח', channel: 'whatsapp',
  status: 'draft', publishedVersionId: null,
  _count: { versions: 0, deliveries: 0, testSends: 0 },
  ...over,
});

const event = (over = {}) => ({
  id: 'e1', internalName: 'חוגגים סגירות', description: null, status: 'draft',
  triggerType: 'deal_won', createdAt: new Date('2026-07-25T07:31:26.941Z'),
  messages: [], _count: { deliveries: 0 },
  ...over,
});

// Fake prisma: records every mutation so a test can prove WHICH rows were
// touched (and that no child table was deleted by hand).
function fakeClient(row) {
  const calls = { deletes: [], timeline: [], loads: 0 };
  const client = {
    communicationEvent: {
      findUnique: async () => { calls.loads += 1; return row; },
      delete: async ({ where }) => { calls.deletes.push({ table: 'CommunicationEvent', where }); return row; },
    },
    communicationMessage: {
      delete: async ({ where }) => { calls.deletes.push({ table: 'CommunicationMessage', where }); },
      deleteMany: async ({ where }) => { calls.deletes.push({ table: 'CommunicationMessage', where }); },
    },
    communicationDelivery: {
      delete: async ({ where }) => { calls.deletes.push({ table: 'CommunicationDelivery', where }); },
      deleteMany: async ({ where }) => { calls.deletes.push({ table: 'CommunicationDelivery', where }); },
    },
    timelineEntry: {
      create: async ({ data }) => { calls.timeline.push({ data, inTransaction: calls.inTx }); return data; },
    },
    $transaction: async (fn) => {
      calls.inTx = true;
      try { return await fn(client); } finally { calls.inTx = false; }
    },
  };
  return { client, calls };
}

const ORIGIN = { actorType: 'user', actorLabel: null, createdBy: 'u1', createdByName: 'dor' };

// ── the verdict ──────────────────────────────────────────────────────────────

test('an empty event is deletable', () => {
  const v = evaluateDeletability(event());
  assert.equal(v.deletable, true);
  assert.deepEqual(v.blockers, []);
  assert.deepEqual(v.cascade, { messages: 0, messageNumbers: [], testSends: 0 });
});

test('draft messages and test sends do not block, but are always reported', () => {
  const v = evaluateDeletability(event({
    messages: [msg({ _count: { versions: 0, deliveries: 0, testSends: 3 } }), msg({ id: 'm2', publicNumber: 25 })],
  }));
  assert.equal(v.deletable, true);
  assert.equal(v.cascade.messages, 2);
  assert.deepEqual(v.cascade.messageNumbers, [24, 25]);
  // Nothing disappears silently — the confirmation can name the test-send rows.
  assert.equal(v.cascade.testSends, 3);
});

test('any delivery blocks — the send log is an audit record', () => {
  const v = evaluateDeletability(event({ _count: { deliveries: 4 }, messages: [msg({ _count: { versions: 1, deliveries: 4, testSends: 0 }, publishedVersionId: 'v1' })] }));
  assert.equal(v.deletable, false);
  const codes = v.blockers.map((b) => b.code);
  assert.ok(codes.includes('has_deliveries'));
  assert.equal(v.blockers.find((b) => b.code === 'has_deliveries').count, 4);
});

test('a cancelled-only delivery still blocks (any row counts)', () => {
  // The evaluator counts ROWS, never statuses: a cancelled delivery is still the
  // audit record of a scheduled-then-cancelled communication.
  const v = evaluateDeletability(event({ _count: { deliveries: 1 } }));
  assert.equal(v.deletable, false);
  assert.deepEqual(v.blockers.map((b) => b.code), ['has_deliveries']);
});

test('a mis-parented delivery counted only on the message still blocks', () => {
  const v = evaluateDeletability(event({
    _count: { deliveries: 0 },
    messages: [msg({ _count: { versions: 0, deliveries: 2, testSends: 0 } })],
  }));
  assert.equal(v.deletable, false);
  assert.equal(v.blockers[0].count, 2);
});

test('a published version blocks even with zero deliveries', () => {
  const v = evaluateDeletability(event({
    messages: [msg({ publishedVersionId: 'v1', status: 'active', _count: { versions: 2, deliveries: 0, testSends: 0 } })],
  }));
  assert.equal(v.deletable, false);
  assert.deepEqual(v.blockers.map((b) => b.code), ['has_published_version']);
});

test('a message unpublished-but-versioned still blocks (snapshots are kept)', () => {
  const v = evaluateDeletability(event({
    messages: [msg({ publishedVersionId: null, _count: { versions: 3, deliveries: 0, testSends: 0 } })],
  }));
  assert.equal(v.deletable, false);
  assert.deepEqual(v.blockers.map((b) => b.code), ['has_published_version']);
});

test('every blocker carries a Hebrew explanation for the UI', () => {
  const v = evaluateDeletability(event({
    _count: { deliveries: 2 },
    messages: [msg({ publishedVersionId: 'v1', _count: { versions: 1, deliveries: 2, testSends: 0 } })],
  }));
  assert.equal(v.blockers.length, 2);
  for (const b of v.blockers) {
    assert.ok(b.he && b.he.length > 20, `${b.code} needs a real explanation`);
    assert.ok(/[֐-׿]/.test(b.he), `${b.code} explanation must be Hebrew`);
  }
});

// ── successful deletion ──────────────────────────────────────────────────────

test('successful deletion: deletes the event, returns 200, reports the cascade', async () => {
  const row = event({ messages: [msg({ _count: { versions: 0, deliveries: 0, testSends: 2 } })] });
  const { client, calls } = fakeClient(row);
  const res = await deleteCommunicationEvent(client, { id: 'e1', origin: ORIGIN });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted.id, 'e1');
  assert.equal(res.body.deleted.internalName, 'חוגגים סגירות');
  assert.equal(res.body.deleted.messages, 1);
  assert.equal(res.body.deleted.testSends, 2);
  assert.equal(calls.deletes.length, 1);
});

test('no orphaned related rows: the event is the SINGLE cascade root', async () => {
  const row = event({
    messages: [
      msg({ _count: { versions: 0, deliveries: 0, testSends: 1 } }),
      msg({ id: 'm2', publicNumber: 25, channel: 'email' }),
    ],
  });
  const { client, calls } = fakeClient(row);
  await deleteCommunicationEvent(client, { id: 'e1', origin: ORIGIN });

  // Exactly one delete, on the event, by id. Any hand-rolled child delete would
  // mean the code is not relying on the DB cascade — the way partial deletes and
  // orphans get introduced.
  assert.deepEqual(calls.deletes, [{ table: 'CommunicationEvent', where: { id: 'e1' } }]);
  assert.equal(calls.deletes.filter((d) => d.table !== 'CommunicationEvent').length, 0);
});

test('the DB enforces the cascade the delete relies on', () => {
  // The single-root delete above is only safe because every child edge cascades
  // at the database level. Pin that: if a future migration weakens one of these
  // FKs, deleting an event would fail or orphan rows instead.
  const sql = fs.readFileSync(
    path.join(import.meta.dirname, '../../prisma/migrations/20260827090000_communication_center/migration.sql'),
    'utf8',
  );
  const cascades = [
    ['CommunicationMessage', 'eventId'],
    ['CommunicationMessageVersion', 'messageId'],
    ['CommunicationDelivery', 'eventId'],
    ['CommunicationDelivery', 'messageId'],
    ['CommunicationTestSend', 'messageId'],
  ];
  for (const [table, column] of cascades) {
    const line = sql.split('\n').find((l) => l.includes(`"${table}_${column}_fkey"`));
    assert.ok(line, `missing FK ${table}.${column}`);
    assert.ok(line.includes('ON DELETE CASCADE'), `${table}.${column} must cascade`);
  }
  // The version pointer must NOT cascade — a delivery outlives its version.
  const versionFk = sql.split('\n').find((l) => l.includes('"CommunicationDelivery_versionId_fkey"'));
  assert.ok(versionFk.includes('ON DELETE SET NULL'));
});

test('deletion is audited inside the same transaction as the delete', async () => {
  const row = event({ messages: [msg()] });
  const { client, calls } = fakeClient(row);
  await deleteCommunicationEvent(client, { id: 'e1', origin: ORIGIN });

  assert.equal(calls.timeline.length, 1);
  const entry = calls.timeline[0];
  assert.equal(entry.inTransaction, true, 'audit must commit atomically with the delete');
  assert.equal(entry.data.subjectType, 'communication_event');
  assert.equal(entry.data.subjectId, 'e1');
  assert.equal(entry.data.data.event, 'communication_event_deleted');
  // The audit must be self-contained: the event it describes no longer exists.
  assert.equal(entry.data.data.snapshot.internalName, 'חוגגים סגירות');
  assert.equal(entry.data.data.snapshot.triggerType, 'deal_won');
  assert.deepEqual(entry.data.data.cascade.messages, [{
    publicNumber: 24, channel: 'whatsapp', internalName: 'וואטסאפ ללקוח', status: 'draft',
  }]);
  // Non-anonymous actor.
  assert.equal(entry.data.createdBy, 'u1');
  assert.equal(entry.data.actorType, 'user');
});

// ── blocked deletion ─────────────────────────────────────────────────────────

test('blocked deletion: 422 with blockers, and NOTHING is deleted or audited', async () => {
  const row = event({
    status: 'active',
    _count: { deliveries: 7 },
    messages: [msg({ publishedVersionId: 'v1', status: 'active', _count: { versions: 2, deliveries: 7, testSends: 0 } })],
  });
  const { client, calls } = fakeClient(row);
  const res = await deleteCommunicationEvent(client, { id: 'e1', origin: ORIGIN });

  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'event_has_history');
  assert.deepEqual(res.body.blockers.map((b) => b.code).sort(), ['has_deliveries', 'has_published_version']);
  assert.equal(res.body.deletion.deletable, false);
  assert.equal(calls.deletes.length, 0, 'a refused delete must not touch any row');
  assert.equal(calls.timeline.length, 0, 'a refused delete must not write an audit row');
});

test('history appearing between the check and the commit still refuses', async () => {
  // First load (the guard) sees a clean event; the in-transaction re-load sees a
  // delivery. The delete must not happen. Cannot occur today — the engine only
  // schedules from published messages — but the invariant is enforced anyway.
  let load = 0;
  const calls = { deletes: [], timeline: [] };
  const client = {
    communicationEvent: {
      findUnique: async () => (++load === 1 ? event() : event({ _count: { deliveries: 1 } })),
      delete: async ({ where }) => { calls.deletes.push(where); },
    },
    timelineEntry: { create: async ({ data }) => { calls.timeline.push(data); return data; } },
    $transaction: async (fn) => fn(client),
  };
  const res = await deleteCommunicationEvent(client, { id: 'e1', origin: ORIGIN });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'event_has_history');
  assert.equal(calls.deletes.length, 0);
});

test('a missing event is a 404, not a silent success', async () => {
  const { client, calls } = fakeClient(null);
  const res = await deleteCommunicationEvent(client, { id: 'nope', origin: ORIGIN });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
  assert.equal(calls.deletes.length, 0);
});

// ── unauthorized deletion ────────────────────────────────────────────────────

test('unauthorized deletion: no session → 401, handler never runs', () => {
  let nexted = false;
  const codes = [];
  const res = { status(c) { codes.push(c); return this; }, json(b) { this.body = b; return this; } };
  requireAdminUser({ adminAuth: null }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.deepEqual(codes, [401]);
  assert.deepEqual(res.body, { error: 'unauthorized' });
});

test('unauthorized deletion: bootstrap mode is NOT a way in', () => {
  // requireAdminAuth lets requests through while zero admins exist so a fresh
  // install can be set up. A hard delete must not accept that: no userId, no
  // delete — an install with no admins is not anonymously destroyable.
  let nexted = false;
  const res = { status() { return this; }, json(b) { this.body = b; return this; } };
  requireAdminUser({ adminAuth: {} }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.deepEqual(res.body, { error: 'unauthorized' });
});

test('an identified admin passes the gate', () => {
  let nexted = false;
  requireAdminUser({ adminAuth: { userId: 'u1' } }, { status() { return this; }, json() { return this; } }, () => { nexted = true; });
  assert.equal(nexted, true);
});
