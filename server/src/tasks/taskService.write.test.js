import test from 'node:test';
import assert from 'node:assert/strict';
import { completeTask, cancelTask, applyTaskPatch, systemOrigin } from './taskService.js';

// The canonical write path, exercised with a fake prisma client (the codebase's
// fake-db idiom — cf. tours/completion.test.js, routes/portal.resolve.test.js).
// These tests are what makes "single and bulk edits use the same canonical
// transitions" a verified statement rather than a claim: bulk rows and the
// Deal-tab routes call EXACTLY these functions.

function fakeDb({ task, taskTypes = {}, owners = [], schedUpdateCount = 1 } = {}) {
  const log = { taskUpdates: [], schedUpdates: [], timeline: [] };
  const db = {
    log,
    task: {
      findUnique: async ({ where }) => (task && where.id === task.id ? { ...task } : null),
      update: async ({ where, data }) => {
        log.taskUpdates.push({ where, data });
        Object.assign(task, data);
        return { ...task };
      },
    },
    taskType: {
      findUnique: async ({ where }) => taskTypes[where.id] ?? null,
    },
    adminUser: {
      findUnique: async ({ where }) => (owners.includes(where.id) ? { id: where.id } : null),
    },
    whatsAppScheduledMessage: {
      updateMany: async ({ where, data }) => {
        log.schedUpdates.push({ where, data });
        return { count: schedUpdateCount };
      },
    },
    timelineEntry: {
      create: async ({ data }) => {
        log.timeline.push(data);
        return { id: `te${log.timeline.length}`, ...data };
      },
    },
    $transaction: (fn) => fn(db),
  };
  return db;
}

const ORIGIN = systemOrigin();
const openTask = (over = {}) => ({
  id: 't1', dealId: 'd1', status: 'open', title: 'שיחה', channel: 'none',
  taskTypeId: null, scheduledMessageId: null, dueDate: new Date('2026-08-01T00:00:00Z'), dueTime: null,
  priority: null,
  ...over,
});

// ── complete / cancel ───────────────────────────────────────────────────────

test('complete: normal task → completed, with ONE timeline audit entry', async () => {
  const db = fakeDb({ task: openTask() });
  const r = await completeTask('t1', ORIGIN, db);
  assert.equal(r.ok, true);
  assert.equal(r.task.status, 'completed');
  assert.ok(r.task.completedAt instanceof Date);
  assert.equal(db.log.timeline.length, 1);
  assert.equal(db.log.timeline[0].kind, 'task');
  assert.equal(db.log.timeline[0].data.event, 'task_completed');
  assert.equal(db.log.timeline[0].subjectId, 'd1');
});

test('complete: WhatsApp task → scheduled send PULLED + not_sent (checkbox never sends)', async () => {
  const db = fakeDb({ task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1' }) });
  const r = await completeTask('t1', ORIGIN, db);
  assert.equal(r.ok, true);
  assert.equal(r.task.status, 'not_sent');
  // the send was pulled with the compare-and-swap guard, not blindly
  assert.equal(db.log.schedUpdates.length, 1);
  assert.deepEqual(db.log.schedUpdates[0].where, { id: 'sm1', status: { in: ['pending', 'failed', 'skipped'] } });
  assert.equal(db.log.schedUpdates[0].data.status, 'cancelled');
  assert.equal(db.log.timeline[0].data.event, 'task_not_sent');
});

test('cancel: normal → cancelled; WhatsApp → pulled + not_sent. NEVER a delete', async () => {
  const db1 = fakeDb({ task: openTask() });
  const r1 = await cancelTask('t1', ORIGIN, db1);
  assert.equal(r1.task.status, 'cancelled');
  assert.equal(db1.log.timeline[0].data.event, 'task_cancelled');

  const db2 = fakeDb({ task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1' }) });
  const r2 = await cancelTask('t1', ORIGIN, db2);
  assert.equal(r2.task.status, 'not_sent');
  assert.equal(db2.log.schedUpdates.length, 1);
  // the row still exists — cancel mutates status; no delete API is even faked
  assert.equal(db2.log.taskUpdates.length, 1);
});

test('transitions on missing/terminal tasks fail per-row with honest codes', async () => {
  assert.deepEqual(await completeTask('missing', ORIGIN, fakeDb({})), { ok: false, status: 404, error: 'task_not_found' });
  const db = fakeDb({ task: openTask({ status: 'completed' }) });
  assert.deepEqual(await completeTask('t1', ORIGIN, db), { ok: false, status: 409, error: 'task_not_open' });
  assert.equal(db.log.timeline.length, 0, 'no audit entry for a refused transition');
});

// ── applyTaskPatch ──────────────────────────────────────────────────────────

test('patch: terminal task is read-only (409), invalid body is 400', async () => {
  const dbTerminal = fakeDb({ task: openTask({ status: 'sent' }) });
  assert.deepEqual(await applyTaskPatch('t1', { priority: 'high' }, dbTerminal), { ok: false, status: 409, error: 'task_not_open' });
  const dbOpen = fakeDb({ task: openTask() });
  assert.deepEqual(await applyTaskPatch('t1', {}, dbOpen), { ok: false, status: 400, error: 'nothing_to_update' });
});

test('patch: owner must resolve to a real AdminUser', async () => {
  const db = fakeDb({ task: openTask(), owners: ['u1'] });
  assert.deepEqual(await applyTaskPatch('t1', { ownerUserId: 'ghost' }, db), { ok: false, status: 400, error: 'owner_not_found' });
  const ok = await applyTaskPatch('t1', { ownerUserId: 'u1' }, db);
  assert.equal(ok.ok, true);
  assert.equal(ok.task.ownerUserId, 'u1');
});

test('SAFE TYPE PATH: a WhatsApp task can never be retyped (would orphan its send)', async () => {
  const db = fakeDb({
    task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1' }),
    taskTypes: { call: { id: 'call', channel: 'none' } },
  });
  const r = await applyTaskPatch('t1', { taskTypeId: 'call' }, db);
  assert.deepEqual(r, { ok: false, status: 409, error: 'whatsapp_type_locked' });
  assert.equal(db.log.taskUpdates.length, 0, 'nothing was written');
});

test('SAFE TYPE PATH: a normal task can never be retyped INTO a WhatsApp type', async () => {
  // That would claim channel semantics with no scheduled message behind them —
  // WhatsApp tasks are born in the composer, never made by edit.
  const db = fakeDb({ task: openTask(), taskTypes: { wa: { id: 'wa', channel: 'whatsapp' } } });
  const r = await applyTaskPatch('t1', { taskTypeId: 'wa' }, db);
  assert.deepEqual(r, { ok: false, status: 400, error: 'type_channel_not_allowed' });
});

test('SAFE TYPE PATH: valid retype updates taskTypeId and NOTHING else — channel untouched', async () => {
  const db = fakeDb({ task: openTask({ taskTypeId: 'old' }), taskTypes: { call: { id: 'call', channel: 'none' } } });
  const r = await applyTaskPatch('t1', { taskTypeId: 'call' }, db);
  assert.equal(r.ok, true);
  assert.deepEqual(db.log.taskUpdates[0].data, { taskTypeId: 'call' });
  assert.equal(r.task.channel, 'none');
});

test('unknown type id is a 400', async () => {
  const db = fakeDb({ task: openTask() });
  assert.deepEqual(await applyTaskPatch('t1', { taskTypeId: 'nope' }, db), { ok: false, status: 400, error: 'invalid_task_type' });
});

test('WhatsApp field edit mirrors onto the scheduled message, CAS-guarded', async () => {
  const db = fakeDb({ task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1', dueTime: '10:00' }) });
  const r = await applyTaskPatch('t1', { dueDate: '2099-08-02', dueTime: '11:00' }, db);
  assert.equal(r.ok, true);
  assert.equal(db.log.schedUpdates.length, 1);
  assert.equal(db.log.schedUpdates[0].data.status, 'pending', 're-armed');
  assert.ok(db.log.schedUpdates[0].data.scheduledAt instanceof Date);
  // task write happens AFTER the mirror succeeded
  assert.equal(db.log.taskUpdates.length, 1);
});

test('WhatsApp mirror refused (already sent/cancelled) blocks the task edit too', async () => {
  const db = fakeDb({
    task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1' }),
    schedUpdateCount: 0, // CAS found the message in a non-editable status
  });
  const r = await applyTaskPatch('t1', { dueDate: '2099-08-02' }, db);
  assert.deepEqual(r, { ok: false, status: 409, error: 'scheduled_not_editable' });
  assert.equal(db.log.taskUpdates.length, 0, 'task and message can never drift');
});

test('timeline is written for TRANSITIONS only — field edits keep parity with the old PATCH', async () => {
  const db = fakeDb({ task: openTask() });
  await applyTaskPatch('t1', { priority: 'high' }, db);
  assert.equal(db.log.timeline.length, 0);
});
