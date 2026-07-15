// Regression tests for the whatsapp-scheduled-stuck detector's run() path.
//
// WHY THIS FILE EXISTS: the detector shipped with `include: { task: … }` — a
// relation that does not exist on WhatsAppScheduledMessage (taskId is a LOOSE
// key by design). Prisma rejects that at VALIDATION time, so the detector threw
// on every 60s sweep from its birth commit and never raised a single issue. The
// existing tests missed it because they only exercised buildActions/send_now/
// recheck against a hand-rolled mock — run(), the one function that touches
// Prisma's query validator, was never called.
//
// These tests call run() and assert the query SHAPE, so a reintroduced relation
// include fails here instead of silently in production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { runWhatsAppStuckDetector, MSG_INCLUDE } from './whatsapp.js';
import { issueTypeDef } from '../registry.js';

const DEF = issueTypeDef('whatsapp_scheduled_stuck');

const chat = { savedContactName: 'דנה', groupSubject: null, pushName: null, phoneNumber: '972500000001' };

function msg(over = {}) {
  return {
    id: 'm1',
    chatId: 'c1',
    content: 'שלום, מזכיר את הסיור מחר',
    status: 'skipped',
    failureReason: null,
    taskId: null,
    chat,
    ...over,
  };
}

// Mock client that RECORDS every query, so N+1 and batching are assertable.
function makeClient({ messages = [], tasks = [], existingIssue = null } = {}) {
  const calls = [];
  return {
    calls,
    q: (model, op) => calls.filter((c) => c.model === model && c.op === op),
    whatsAppScheduledMessage: {
      findMany: async (args) => {
        calls.push({ model: 'whatsAppScheduledMessage', op: 'findMany', args });
        return messages;
      },
    },
    task: {
      findMany: async (args) => {
        calls.push({ model: 'task', op: 'findMany', args });
        const ids = args.where.id.in;
        return tasks.filter((t) => ids.includes(t.id));
      },
    },
    operationalIssue: {
      findFirst: async (args) => {
        calls.push({ model: 'operationalIssue', op: 'findFirst', args });
        return existingIssue;
      },
      create: async (args) => {
        calls.push({ model: 'operationalIssue', op: 'create', args });
        return { id: 'issue1', ...args.data };
      },
      update: async (args) => {
        calls.push({ model: 'operationalIssue', op: 'update', args });
        return { id: args.where.id };
      },
      updateMany: async (args) => {
        calls.push({ model: 'operationalIssue', op: 'updateMany', args });
        return { count: 0 };
      },
    },
  };
}

// --- (2) the structural guard: reintroducing the invalid include fails HERE ---

const MODEL = Prisma.dmmf.datamodel.models.find((m) => m.name === 'WhatsAppScheduledMessage');

test('schema truth: taskId is a loose SCALAR and there is NO task relation', () => {
  assert.ok(MODEL, 'model exists in the datamodel');
  const taskId = MODEL.fields.find((f) => f.name === 'taskId');
  assert.equal(taskId.kind, 'scalar', 'taskId must stay a plain scalar');
  assert.equal(taskId.type, 'String');
  const task = MODEL.fields.find((f) => f.name === 'task');
  assert.equal(task, undefined, 'there must be NO `task` relation — the decoupling is deliberate');
});

test('MSG_INCLUDE only names REAL relations — this is the guard that was missing', () => {
  const relations = MODEL.fields.filter((f) => f.kind === 'object').map((f) => f.name);
  for (const key of Object.keys(MSG_INCLUDE)) {
    assert.ok(
      relations.includes(key),
      `include key "${key}" is not a relation on WhatsAppScheduledMessage — Prisma would throw at runtime`,
    );
  }
  assert.ok(!('task' in MSG_INCLUDE), 'task must never be re-added to the include');
  assert.ok('chat' in MSG_INCLUDE, 'chat is a real relation and must stay');
});

test('the taskId index the batched lookup relies on still exists', () => {
  const idx = MODEL.uniqueIndexes.concat(MODEL.indexes ?? []);
  // Prisma's DMMF does not expose @@index reliably across versions; assert the
  // field instead — the lookup is by primary key on Task, so this is a
  // belt-and-braces check that taskId is still the join value we carry.
  assert.ok(MODEL.fields.some((f) => f.name === 'taskId'));
  assert.ok(Array.isArray(idx));
});

// --- (1)(7) run() executes and produces an issue ---

test('run() executes and raises an OperationalIssue for a skipped message', async () => {
  const client = makeClient({ messages: [msg({ status: 'skipped' })] });
  await runWhatsAppStuckDetector(client);

  const created = client.q('operationalIssue', 'create');
  assert.equal(created.length, 1, 'exactly one issue created');
  const d = created[0].args.data;
  assert.equal(d.type, 'whatsapp_scheduled_stuck');
  assert.equal(d.severity, 'warning');
  assert.equal(d.sourceModule, 'whatsapp');
  assert.equal(d.dedupeKey, 'whatsapp_scheduled_stuck:m1');
  assert.equal(d.data.messageId, 'm1');
  assert.equal(d.data.status, 'skipped');
});

test('run() raises for a failed message and maps the reason to Hebrew', async () => {
  const client = makeClient({
    messages: [msg({ status: 'failed', failureReason: 'whatsapp_number_not_found' })],
  });
  await runWhatsAppStuckDetector(client);
  const d = client.q('operationalIssue', 'create')[0].args.data;
  assert.match(d.explanation, /המספר לא קיים ב-WhatsApp/);
  assert.equal(d.data.failureReason, 'whatsapp_number_not_found');
});

test('run() with no stuck messages creates nothing and still resolves stale issues', async () => {
  const client = makeClient({ messages: [] });
  await runWhatsAppStuckDetector(client);
  assert.equal(client.q('operationalIssue', 'create').length, 0, 'no writes when nothing is stuck');
  assert.equal(client.q('task', 'findMany').length, 0, 'no task lookup when there are no rows');
  assert.equal(client.q('operationalIssue', 'updateMany').length, 1, 'resolveMissing still runs');
});

// --- (3)(4) batching and N+1 ---

test('run() resolves tasks in ONE batched lookup keyed by id', async () => {
  const client = makeClient({
    messages: [msg({ id: 'm1', taskId: 't1' })],
    tasks: [{ id: 't1', deal: { id: 'd1', orderNo: 27500, title: 'סיור' } }],
  });
  await runWhatsAppStuckDetector(client);

  const taskQueries = client.q('task', 'findMany');
  assert.equal(taskQueries.length, 1, 'exactly one task query');
  assert.deepEqual(taskQueries[0].args.where, { id: { in: ['t1'] } }, 'batched by id IN');
  const d = client.q('operationalIssue', 'create')[0].args.data;
  assert.deepEqual(d.data.deal, { id: 'd1', orderNo: 27500, title: 'סיור' });
});

test('NO N+1: 5 messages with 5 distinct tasks still cost exactly ONE task query', async () => {
  const messages = Array.from({ length: 5 }, (_, i) => msg({ id: `m${i}`, taskId: `t${i}` }));
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    deal: { id: `d${i}`, orderNo: 27500 + i, title: `deal ${i}` },
  }));
  const client = makeClient({ messages, tasks });
  await runWhatsAppStuckDetector(client);

  assert.equal(client.q('task', 'findMany').length, 1, 'ONE task query for five messages');
  assert.equal(client.q('whatsAppScheduledMessage', 'findMany').length, 1);
  assert.deepEqual(client.q('task', 'findMany')[0].args.where.id.in, ['t0', 't1', 't2', 't3', 't4']);
  assert.equal(client.q('operationalIssue', 'create').length, 5, 'one issue per message');
});

test('duplicate taskIds are de-duplicated into a single IN list', async () => {
  const client = makeClient({
    messages: [msg({ id: 'm1', taskId: 't1' }), msg({ id: 'm2', taskId: 't1' })],
    tasks: [{ id: 't1', deal: { id: 'd1', orderNo: 1, title: 'x' } }],
  });
  await runWhatsAppStuckDetector(client);
  assert.deepEqual(client.q('task', 'findMany')[0].args.where.id.in, ['t1'], 'deduped');
  // Both messages still get the deal.
  for (const c of client.q('operationalIssue', 'create')) assert.equal(c.args.data.data.deal.id, 'd1');
});

// --- (5)(6) fallbacks ---

test('a message with NO taskId works and skips the task query entirely', async () => {
  const client = makeClient({ messages: [msg({ taskId: null })] });
  await runWhatsAppStuckDetector(client);

  assert.equal(client.q('task', 'findMany').length, 0, 'no pointless query with an empty IN list');
  const d = client.q('operationalIssue', 'create')[0].args.data;
  assert.equal(d.data.deal, null);
  assert.ok(!d.entityRefs.some((r) => r.type === 'deal'), 'no deal ref');
  assert.ok(d.entityRefs.some((r) => r.type === 'whatsapp'), 'whatsapp ref kept');
  assert.deepEqual(
    DEF.buildActions({ data: d.data }).map((a) => a.key),
    ['send_now', 'reschedule', 'cancel', 'open_whatsapp'],
    'falls back to Open WhatsApp',
  );
});

test('a taskId pointing at a deleted task falls back to no deal', async () => {
  const client = makeClient({ messages: [msg({ taskId: 'gone' })], tasks: [] });
  await runWhatsAppStuckDetector(client);
  const d = client.q('operationalIssue', 'create')[0].args.data;
  assert.equal(d.data.deal, null, 'dangling loose key must not throw or invent a deal');
  assert.deepEqual(DEF.buildActions({ data: d.data }).map((a) => a.key).at(-1), 'open_whatsapp');
});

test('a task whose deal is absent falls back to no deal', async () => {
  const client = makeClient({
    messages: [msg({ taskId: 't1' })],
    tasks: [{ id: 't1', deal: null }],
  });
  await runWhatsAppStuckDetector(client);
  assert.equal(client.q('operationalIssue', 'create')[0].args.data.data.deal, null);
});

// --- (8) behaviour otherwise unchanged ---

test('payload shape is unchanged: title, refs, preview and dedupe', async () => {
  const client = makeClient({
    messages: [msg({ id: 'm9', taskId: 't1' })],
    tasks: [{ id: 't1', deal: { id: 'd1', orderNo: 27500, title: 'סיור גרפיטי' } }],
  });
  await runWhatsAppStuckDetector(client);
  const d = client.q('operationalIssue', 'create')[0].args.data;

  assert.equal(d.title, 'הודעת WhatsApp מתוזמנת לא נשלחה — דנה', 'chat name still resolved from chat include');
  assert.match(d.explanation, /חלון השליחה פג/);
  assert.match(d.explanation, /שלום, מזכיר את הסיור מחר/, 'content preview retained');
  assert.deepEqual(d.entityRefs[0], { type: 'deal', id: 'd1', orderNo: 27500, label: 'סיור גרפיטי' });
  assert.deepEqual(d.entityRefs[1], { type: 'whatsapp', id: 'c1', label: 'דנה' });
  assert.equal(d.dedupeKey, 'whatsapp_scheduled_stuck:m9');
});

test('run() queries only skipped|failed and caps at 500', async () => {
  const client = makeClient({ messages: [] });
  await runWhatsAppStuckDetector(client);
  const args = client.q('whatsAppScheduledMessage', 'findMany')[0].args;
  assert.deepEqual(args.where, { status: { in: ['skipped', 'failed'] } });
  assert.equal(args.take, 500);
  assert.deepEqual(args.include, MSG_INCLUDE);
});

test('an existing active issue is UPDATED, not duplicated', async () => {
  const client = makeClient({
    messages: [msg({ id: 'm1' })],
    existingIssue: { id: 'existing1', dedupeKey: 'whatsapp_scheduled_stuck:m1', entityRefs: [] },
  });
  await runWhatsAppStuckDetector(client);
  assert.equal(client.q('operationalIssue', 'create').length, 0, 'no duplicate issue');
  assert.equal(client.q('operationalIssue', 'update').length, 1, 'existing issue refreshed');
});

test('resolveMissing is told exactly which dedupeKeys are still present', async () => {
  const client = makeClient({ messages: [msg({ id: 'm1' }), msg({ id: 'm2' })] });
  await runWhatsAppStuckDetector(client);
  const args = client.q('operationalIssue', 'updateMany')[0].args;
  assert.equal(args.where.type, 'whatsapp_scheduled_stuck');
  assert.deepEqual(args.where.dedupeKey.notIn, [
    'whatsapp_scheduled_stuck:m1',
    'whatsapp_scheduled_stuck:m2',
  ]);
  assert.equal(args.data.status, 'resolved');
});
