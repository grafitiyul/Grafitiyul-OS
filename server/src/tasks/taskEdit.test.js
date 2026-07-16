import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskPatch, buildScheduledMirror, combineDateTime, TIME_RE, SCHEDULE_MIN_LEAD_MS, CANCELLABLE_SCHED } from './taskEdit.js';

// The ONE validator behind every task editor (Deal tab PATCH, workspace inline
// cells, bulk field edits). These tests pin the shapes the routes used to
// enforce inline, so the extraction is provably behaviour-preserving.

// ── parseTaskPatch ──────────────────────────────────────────────────────────

test('PATCH semantics: only fields present in the body are touched', () => {
  const r = parseTaskPatch({ priority: 'high' });
  assert.deepEqual(r, { ok: true, data: { priority: 'high' } });
});

test('an empty edit is an error, not a silent no-op write', () => {
  assert.deepEqual(parseTaskPatch({}), { ok: false, error: 'nothing_to_update' });
  assert.deepEqual(parseTaskPatch(null), { ok: false, error: 'nothing_to_update' });
});

test('text: required non-empty, trimmed, capped at 500', () => {
  assert.deepEqual(parseTaskPatch({ text: '  שיחה חוזרת  ' }).data, { title: 'שיחה חוזרת' });
  assert.deepEqual(parseTaskPatch({ text: '   ' }), { ok: false, error: 'text_required' });
  assert.equal(parseTaskPatch({ text: 'א'.repeat(600) }).data.title.length, 500);
});

test('priority: vocabulary or null — junk normalises to null, never stored', () => {
  for (const p of ['low', 'medium', 'high']) assert.equal(parseTaskPatch({ priority: p }).data.priority, p);
  for (const junk of ['none', '', null, 'urgent', 'HIGH']) {
    assert.equal(parseTaskPatch({ priority: junk }).data.priority, null, `${JSON.stringify(junk)} → null`);
  }
});

test('owner: non-empty required (existence is the service’s DB check)', () => {
  assert.deepEqual(parseTaskPatch({ ownerUserId: ' u1 ' }).data, { ownerUserId: 'u1' });
  assert.deepEqual(parseTaskPatch({ ownerUserId: '' }), { ok: false, error: 'owner_required' });
});

test('dueTime: HH:MM or null — a malformed time clears rather than errors (parity with the old route)', () => {
  assert.equal(parseTaskPatch({ dueTime: '09:30' }).data.dueTime, '09:30');
  assert.equal(parseTaskPatch({ dueTime: '25:00' }).data.dueTime, null);
  assert.equal(parseTaskPatch({ dueTime: null }).data.dueTime, null);
});

test('dueDate: must parse to a real Date', () => {
  assert.ok(parseTaskPatch({ dueDate: '2026-08-01' }).data.dueDate instanceof Date);
  assert.deepEqual(parseTaskPatch({ dueDate: 'not-a-date' }), { ok: false, error: 'due_date_invalid' });
});

test('taskTypeId: non-empty required; channel guards are the service’s job', () => {
  assert.deepEqual(parseTaskPatch({ taskTypeId: ' t1 ' }).data, { taskTypeId: 't1' });
  assert.deepEqual(parseTaskPatch({ taskTypeId: '' }), { ok: false, error: 'task_type_required' });
});

test('notes: nullable, capped at 2000', () => {
  assert.equal(parseTaskPatch({ notes: null }).data.notes, null);
  assert.equal(parseTaskPatch({ notes: 'x'.repeat(3000) }).data.notes.length, 2000);
});

// ── buildScheduledMirror ────────────────────────────────────────────────────

const WA_TASK = { channel: 'whatsapp', scheduledMessageId: 'sm1', dueDate: new Date('2026-08-01T00:00:00Z'), dueTime: '10:00' };
const FUTURE = Date.parse('2026-07-16T12:00:00Z');

test('non-WhatsApp tasks never mirror', () => {
  const r = buildScheduledMirror({ channel: 'none', scheduledMessageId: null }, { dueDate: '2026-08-01' }, { dueDate: new Date() }, FUTURE);
  assert.deepEqual(r, { ok: true, sched: null });
});

test('a WhatsApp edit that touches neither text nor time does not mirror', () => {
  const r = buildScheduledMirror(WA_TASK, { priority: 'high' }, { priority: 'high' }, FUTURE);
  assert.deepEqual(r, { ok: true, sched: null });
});

test('content edit mirrors, allowed only while PENDING', () => {
  const r = buildScheduledMirror(WA_TASK, { text: 'חדש' }, { title: 'חדש' }, FUTURE);
  assert.equal(r.ok, true);
  assert.equal(r.sched.data.content, 'חדש');
  assert.deepEqual(r.sched.allowedStatuses, ['pending']);
});

test('time-only edit may RE-ARM failed/skipped (attempts reset)', () => {
  const r = buildScheduledMirror(WA_TASK, { dueDate: '2026-08-02' }, { dueDate: new Date('2026-08-02') }, FUTURE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sched.allowedStatuses, ['pending', 'failed', 'skipped']);
  assert.equal(r.sched.data.attemptCount, 0);
  assert.equal(r.sched.data.status, 'pending');
  assert.ok(r.sched.data.scheduledAt instanceof Date);
});

test('client-computed scheduledAt wins over the server combine', () => {
  const explicit = '2026-08-02T07:30:00.000Z';
  const r = buildScheduledMirror(WA_TASK, { dueDate: '2026-08-02', scheduledAt: explicit }, { dueDate: new Date('2026-08-02') }, FUTURE);
  assert.equal(r.sched.data.scheduledAt.toISOString(), explicit);
});

test('a past (or too-near) send time is rejected', () => {
  const now = Date.parse('2026-08-02T09:59:50Z');
  const r = buildScheduledMirror(WA_TASK, { scheduledAt: '2026-08-02T10:00:00Z' }, {}, now);
  assert.deepEqual(r, { ok: false, error: 'scheduled_at_past' }, 'inside the 30s lead window');
  const ok = buildScheduledMirror(WA_TASK, { scheduledAt: '2026-08-02T10:01:00Z' }, {}, now);
  assert.equal(ok.ok, true);
});

test('garbage scheduledAt is rejected', () => {
  assert.deepEqual(
    buildScheduledMirror(WA_TASK, { scheduledAt: 'whenever' }, {}, FUTURE),
    { ok: false, error: 'scheduled_at_invalid' },
  );
});

// ── shared constants ────────────────────────────────────────────────────────

test('constants preserved from the original route', () => {
  assert.equal(SCHEDULE_MIN_LEAD_MS, 30_000);
  assert.deepEqual(CANCELLABLE_SCHED, ['pending', 'failed', 'skipped']);
  assert.ok(TIME_RE.test('23:59'));
  assert.ok(!TIME_RE.test('24:00'));
});

test('combineDateTime: date + optional HH:MM, local wall-clock', () => {
  const d = combineDateTime('2026-08-01', '09:30');
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
  assert.equal(combineDateTime('garbage', '09:30'), null);
  assert.ok(combineDateTime('2026-08-01', null) instanceof Date);
});
