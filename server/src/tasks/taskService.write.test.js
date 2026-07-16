import test from 'node:test';
import assert from 'node:assert/strict';
import { completeTask, cancelTask, reopenTask, applyTaskPatch, systemOrigin } from './taskService.js';

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

test('patch: invalid body is 400, missing task is 404', async () => {
  const dbOpen = fakeDb({ task: openTask() });
  assert.deepEqual(await applyTaskPatch('t1', {}, { db: dbOpen }), { ok: false, status: 400, error: 'nothing_to_update' });
  assert.deepEqual(await applyTaskPatch('missing', { priority: 'high' }, { db: fakeDb({}) }), { ok: false, status: 404, error: 'task_not_found' });
});

// ── terminal-task RECORD CORRECTIONS (owner decision 2026-07-16) ────────────
// A completed task stays editable for internal corrections. The invariants the
// bulk due-date bug report demanded: status/completedAt untouched, audit entry
// written, nothing reopened, nothing resent, WhatsApp message never touched.

test('CORRECTION: completed task dueDate change succeeds — completed stays completed', async () => {
  const done = new Date('2026-07-10T09:00:00Z');
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: done }) });
  const r = await applyTaskPatch('t1', { dueDate: '2026-07-20' }, { db });
  assert.equal(r.ok, true);
  assert.equal(r.task.status, 'completed', 'never reopened');
  assert.equal(r.task.completedAt, done, 'completedAt unchanged');
  assert.equal(r.task.dueDate.toISOString().slice(0, 10), '2026-07-20');
  // the update wrote ONLY the corrected field — status untouched by construction
  assert.deepEqual(Object.keys(db.log.taskUpdates[0].data), ['dueDate']);
});

test('CORRECTION: completed task dueTime change succeeds, same invariants', async () => {
  const done = new Date('2026-07-10T09:00:00Z');
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: done }) });
  const r = await applyTaskPatch('t1', { dueTime: '14:30' }, { db });
  assert.equal(r.ok, true);
  assert.equal(r.task.dueTime, '14:30');
  assert.equal(r.task.status, 'completed');
  assert.equal(r.task.completedAt, done);
});

test('CORRECTION: a terminal edit writes ONE timeline audit entry, atomically', async () => {
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: new Date() }) });
  await applyTaskPatch('t1', { dueDate: '2026-07-21' }, { db });
  assert.equal(db.log.timeline.length, 1, 'the correction is recorded');
  assert.equal(db.log.timeline[0].kind, 'task');
  assert.equal(db.log.timeline[0].data.event, 'task_corrected');
  assert.equal(db.log.timeline[0].subjectId, 'd1');
});

test('CORRECTION carries the acting user when the route provides one', async () => {
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: new Date() }) });
  const origin = { actorType: 'user', actorLabel: null, createdBy: 'u1', createdByName: 'dorko' };
  await applyTaskPatch('t1', { priority: 'high' }, { db, origin });
  assert.equal(db.log.timeline[0].createdBy, 'u1');
});

test('CORRECTION on a terminal WhatsApp task NEVER touches the scheduled message', async () => {
  // The send is settled (here: already sent). Fixing the due date is a record
  // correction — re-arming/resending would be a catastrophe, so the mirror must
  // not even be attempted (schedUpdateCount: 0 would 409 if it were).
  const db = fakeDb({
    task: openTask({ status: 'sent', channel: 'whatsapp', scheduledMessageId: 'sm1', completedAt: new Date() }),
    schedUpdateCount: 0,
  });
  const r = await applyTaskPatch('t1', { dueDate: '2026-07-22' }, { db });
  assert.equal(r.ok, true);
  assert.equal(db.log.schedUpdates.length, 0, 'the settled message was not touched');
  assert.equal(r.task.status, 'sent', 'nothing resent, nothing reopened');
});

test('CORRECTION: retyping stays guarded at ANY status', async () => {
  // whatsapp source: locked even after completion
  const dbWa = fakeDb({
    task: openTask({ status: 'not_sent', channel: 'whatsapp', scheduledMessageId: 'sm1' }),
    taskTypes: { call: { id: 'call', channel: 'none' } },
  });
  assert.deepEqual(await applyTaskPatch('t1', { taskTypeId: 'call' }, { db: dbWa }), { ok: false, status: 409, error: 'whatsapp_type_locked' });
  // whatsapp target: forbidden even on a completed normal task
  const dbTo = fakeDb({
    task: openTask({ status: 'completed', completedAt: new Date() }),
    taskTypes: { wa: { id: 'wa', channel: 'whatsapp' } },
  });
  assert.deepEqual(await applyTaskPatch('t1', { taskTypeId: 'wa' }, { db: dbTo }), { ok: false, status: 400, error: 'type_channel_not_allowed' });
});

test('transitions still refuse terminal tasks — a correction can never complete twice', async () => {
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: new Date() }) });
  assert.deepEqual(await completeTask('t1', ORIGIN, db), { ok: false, status: 409, error: 'task_not_open' });
  assert.deepEqual(await cancelTask('t1', ORIGIN, db), { ok: false, status: 409, error: 'task_not_open' });
});

test('patch: owner must resolve to a real AdminUser', async () => {
  const db = fakeDb({ task: openTask(), owners: ['u1'] });
  assert.deepEqual(await applyTaskPatch('t1', { ownerUserId: 'ghost' }, { db }), { ok: false, status: 400, error: 'owner_not_found' });
  const ok = await applyTaskPatch('t1', { ownerUserId: 'u1' }, { db });
  assert.equal(ok.ok, true);
  assert.equal(ok.task.ownerUserId, 'u1');
});

test('SAFE TYPE PATH: a WhatsApp task can never be retyped (would orphan its send)', async () => {
  const db = fakeDb({
    task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1' }),
    taskTypes: { call: { id: 'call', channel: 'none' } },
  });
  const r = await applyTaskPatch('t1', { taskTypeId: 'call' }, { db });
  assert.deepEqual(r, { ok: false, status: 409, error: 'whatsapp_type_locked' });
  assert.equal(db.log.taskUpdates.length, 0, 'nothing was written');
});

test('SAFE TYPE PATH: a normal task can never be retyped INTO a WhatsApp type', async () => {
  // That would claim channel semantics with no scheduled message behind them —
  // WhatsApp tasks are born in the composer, never made by edit.
  const db = fakeDb({ task: openTask(), taskTypes: { wa: { id: 'wa', channel: 'whatsapp' } } });
  const r = await applyTaskPatch('t1', { taskTypeId: 'wa' }, { db });
  assert.deepEqual(r, { ok: false, status: 400, error: 'type_channel_not_allowed' });
});

test('SAFE TYPE PATH: valid retype updates taskTypeId and NOTHING else — channel untouched', async () => {
  const db = fakeDb({ task: openTask({ taskTypeId: 'old' }), taskTypes: { call: { id: 'call', channel: 'none' } } });
  const r = await applyTaskPatch('t1', { taskTypeId: 'call' }, { db });
  assert.equal(r.ok, true);
  assert.deepEqual(db.log.taskUpdates[0].data, { taskTypeId: 'call' });
  assert.equal(r.task.channel, 'none');
});

test('unknown type id is a 400', async () => {
  const db = fakeDb({ task: openTask() });
  assert.deepEqual(await applyTaskPatch('t1', { taskTypeId: 'nope' }, { db }), { ok: false, status: 400, error: 'invalid_task_type' });
});

test('WhatsApp field edit mirrors onto the scheduled message, CAS-guarded', async () => {
  const db = fakeDb({ task: openTask({ channel: 'whatsapp', scheduledMessageId: 'sm1', dueTime: '10:00' }) });
  const r = await applyTaskPatch('t1', { dueDate: '2099-08-02', dueTime: '11:00' }, { db });
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
  const r = await applyTaskPatch('t1', { dueDate: '2099-08-02' }, { db });
  assert.deepEqual(r, { ok: false, status: 409, error: 'scheduled_not_editable' });
  assert.equal(db.log.taskUpdates.length, 0, 'task and message can never drift');
});

test('timeline is written for TRANSITIONS only — field edits keep parity with the old PATCH', async () => {
  const db = fakeDb({ task: openTask() });
  await applyTaskPatch('t1', { priority: 'high' }, { db });
  assert.equal(db.log.timeline.length, 0);
});

// ── reopen (owner decision 2026-07-16): the ONLY terminal→open transition ────

test('REOPEN: a completed task returns to open — same row, creation date preserved', async () => {
  const created = new Date('2026-07-01T08:00:00Z');
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: new Date(), createdAt: created }) });
  const r = await reopenTask('t1', ORIGIN, db);
  assert.equal(r.ok, true);
  assert.equal(r.task.status, 'open');
  assert.equal(r.task.id, 't1', 'the SAME task — never a new one');
  assert.equal(r.task.createdAt, created, 'creation date untouched');
  assert.equal(r.task.completedAt, null, 'an open task cannot carry completedAt');
  assert.equal(db.log.timeline.length, 1);
  assert.equal(db.log.timeline[0].data.event, 'task_reopened');
});

test('REOPEN: the full audit sequence — completed, reopened, completed again', async () => {
  const db = fakeDb({ task: openTask() });
  await completeTask('t1', ORIGIN, db);
  await reopenTask('t1', ORIGIN, db);
  const again = await completeTask('t1', ORIGIN, db);
  assert.equal(again.task.status, 'completed');
  assert.deepEqual(
    db.log.timeline.map((e) => e.data.event),
    ['task_completed', 'task_reopened', 'task_completed'],
    'every transition auditable — the original completion entry is never erased',
  );
});

test('REOPEN: an open task cannot be reopened', async () => {
  const db = fakeDb({ task: openTask() });
  assert.deepEqual(await reopenTask('t1', ORIGIN, db), { ok: false, status: 409, error: 'task_already_open' });
  assert.deepEqual(await reopenTask('missing', ORIGIN, fakeDb({})), { ok: false, status: 404, error: 'task_not_found' });
});

test('REOPEN WHATSAPP: not_sent reopens with a PERMANENT DETACH — message untouched', async () => {
  const db = fakeDb({
    task: openTask({ status: 'not_sent', channel: 'whatsapp', scheduledMessageId: 'sm1', cancelledAt: new Date() }),
  });
  const r = await reopenTask('t1', ORIGIN, db);
  assert.equal(r.ok, true);
  assert.equal(r.task.status, 'open');
  assert.equal(r.task.scheduledMessageId, null, 'detached — send-now is structurally unreachable');
  assert.equal(r.task.channel, 'none', 'continues life as a normal task');
  assert.equal(db.log.schedUpdates.length, 0, 'the settled message row was NOT touched');
});

test('REOPEN WHATSAPP: a SENT task is final — the message went, history must not be misrepresented', async () => {
  const db = fakeDb({ task: openTask({ status: 'sent', channel: 'whatsapp', scheduledMessageId: 'sm1' }) });
  assert.deepEqual(await reopenTask('t1', ORIGIN, db), { ok: false, status: 409, error: 'sent_task_final' });
  assert.equal(db.log.taskUpdates.length, 0, 'nothing written');
  assert.equal(db.log.timeline.length, 0, 'no audit entry for a refused reopen');
});

test('REOPEN: reopening changes ONLY the task — never communication or automation', async () => {
  // The complete inventory of what reopen writes: the status trio (+ the
  // WhatsApp detach). Anything else appearing here is a regression.
  const db = fakeDb({ task: openTask({ status: 'completed', completedAt: new Date() }) });
  await reopenTask('t1', ORIGIN, db);
  assert.deepEqual(Object.keys(db.log.taskUpdates[0].data).sort(), ['cancelledAt', 'completedAt', 'status']);
  assert.equal(db.log.schedUpdates.length, 0);
});
