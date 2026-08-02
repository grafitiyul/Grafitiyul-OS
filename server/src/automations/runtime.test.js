import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutomation, RUN_STATUS } from './runtime.js';
import { registerActionExecutor } from './actions/index.js';

// The runtime's contract, stated as tests:
//   * the same submission can NEVER act twice;
//   * a submission is never harmed by an automation;
//   * every stop is explained in Hebrew on the run row;
//   * conditions read stable keys against frozen answers.

const def = (over = {}) => ({
  id: 'AUT-900',
  slug: 'a',
  nameHe: 'אוטומציה א',
  descriptionHe: 'x',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: 'questionnaire_submitted', templateKey: 'tour_summary' },
  when: null,
  actions: [{ kind: 'test_action' }],
  dependsOn: [],
  idempotency: (e) => `AUT-900:${e.submissionId}`,
  ...over,
});

const submission = {
  id: 'sub1',
  purpose: 'tour_summary',
  template: { key: 'tour_summary' },
  answers: [],
};

// In-memory stand-in for the AutomationRun table, including its unique index —
// the idempotency guarantee has to be exercised, not assumed.
function stubDb({ state = null, templates = {}, questions = [], bookings = [] } = {}) {
  const runs = new Map(); // idempotencyKey → row
  const byId = new Map();
  let seq = 0;
  return {
    runs, byId,
    automationState: { findUnique: async () => state },
    automationRun: {
      create: async ({ data }) => {
        if (runs.has(data.idempotencyKey)) {
          const e = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `run${++seq}`, ...data };
        runs.set(data.idempotencyKey, row);
        byId.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = byId.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    questionnaireTemplate: { findUnique: async ({ where }) => templates[where.key] ?? null },
    questionnaireQuestion: {
      findFirst: async ({ where }) =>
        questions.find((q) => q.versionId === where.versionId && q.key === where.key) ?? null,
    },
    questionnaireQuestionOption: { findFirst: async () => null },
    communicationEvent: { findMany: async () => [] },
    booking: {
      findMany: async ({ where }) => bookings.filter((b) => b.tourEventId === where.tourEventId && b.status !== 'cancelled'),
      findUnique: async ({ where }) => bookings.find((b) => b.id === where.id) ?? null,
    },
  };
}

const silent = { info: () => {}, error: () => {}, warn: () => {}, log: () => {} };
const lastRun = (db) => [...db.byId.values()].at(-1);

// A controllable executor so the runtime is tested without the Communication
// Center in the loop.
let actionCalls = [];
let actionResult = { ok: true, detailHe: 'בוצע' };
registerActionExecutor('test_action', async () => {
  actionCalls.push(1);
  if (actionResult instanceof Error) throw actionResult;
  return actionResult;
});
const reset = () => { actionCalls = []; actionResult = { ok: true, detailHe: 'בוצע' }; };

// ── idempotency: the headline guarantee ──────────────────────────────────────

test('the same submission can never act twice', async () => {
  reset();
  const db = stubDb();
  const first = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });
  const second = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });

  assert.equal(first.status, RUN_STATUS.ran);
  assert.equal(second.recorded, false);
  assert.equal(second.status, 'duplicate');
  assert.equal(actionCalls.length, 1, 'the action must run exactly once');
  assert.equal(db.runs.size, 1);
});

test('a different submission is a different business event', async () => {
  reset();
  const db = stubDb();
  await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });
  await runAutomation(def(), { submission: { ...submission, id: 'sub2' }, answers: {}, refs: { submissionId: 'sub2' } }, { db, log: silent });
  assert.equal(actionCalls.length, 2);
  assert.equal(db.runs.size, 2);
});

// ── the silent gates ─────────────────────────────────────────────────────────

test('an edit does not re-fire, and leaves no run row', async () => {
  reset();
  const db = stubDb();
  const r = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' }, firstSubmit: false }, { db, log: silent });
  assert.equal(r.recorded, false);
  assert.equal(r.status, 'not_first_submit');
  assert.equal(db.runs.size, 0);
  assert.equal(actionCalls.length, 0);
});

test('firstSubmitOnly:false lets an automation react to edits too', async () => {
  reset();
  const db = stubDb();
  const d = def({ trigger: { kind: 'questionnaire_submitted', templateKey: 'tour_summary', firstSubmitOnly: false } });
  const r = await runAutomation(d, { submission, answers: {}, refs: { submissionId: 'sub1' }, firstSubmit: false }, { db, log: silent });
  assert.equal(r.status, RUN_STATUS.ran);
});

test('a disabled automation leaves NO trace', async () => {
  reset();
  const db = stubDb({ state: { autId: 'AUT-900', enabled: false } });
  const r = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });
  assert.equal(r.recorded, false);
  assert.equal(db.runs.size, 0, 'a switched-off automation must not fill the log with skips');
});

// ── explained stops ──────────────────────────────────────────────────────────

test('an unmet condition is a SKIPPED run with a reason, not silence', async () => {
  reset();
  const db = stubDb();
  const d = def({ when: { q: 'q_aaaaaaaa', op: 'eq', value: 'o_11111111' } });
  const r = await runAutomation(d, {
    submission, answers: { q_aaaaaaaa: 'o_22222222' }, refs: { submissionId: 'sub1' },
  }, { db, log: silent });

  assert.equal(r.status, RUN_STATUS.skipped);
  const row = lastRun(db);
  assert.equal(row.stoppedAt, 'condition');
  assert.match(row.reasonHe, /תנאי התשובות/);
  assert.equal(actionCalls.length, 0);
});

test('a met condition runs the actions', async () => {
  reset();
  const db = stubDb();
  const d = def({ when: { q: 'q_aaaaaaaa', op: 'eq', value: 'o_11111111' } });
  const r = await runAutomation(d, {
    submission, answers: { q_aaaaaaaa: 'o_11111111' }, refs: { submissionId: 'sub1' },
  }, { db, log: silent });
  assert.equal(r.status, RUN_STATUS.ran);
  assert.equal(actionCalls.length, 1);
});

test('a broken dependency stops the run and names it', async () => {
  reset();
  const db = stubDb({
    templates: { tour_summary: { id: 't1', internalName: 'סיכום', status: 'active', currentVersionId: 'v9' } },
    questions: [],
  });
  const d = def({
    dependsOn: [{ kind: 'questionnaire_question', templateKey: 'tour_summary', questionKey: 'q_9f3a12bd' }],
  });
  const r = await runAutomation(d, { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });

  assert.equal(r.status, RUN_STATUS.skipped);
  const row = lastRun(db);
  assert.equal(row.stoppedAt, 'dependency');
  assert.match(row.reasonHe, /q_9f3a12bd/);
  assert.equal(actionCalls.length, 0);
});

// ── failure handling ─────────────────────────────────────────────────────────

test('a failing action produces a FAILED run with the error, and never throws out', async () => {
  reset();
  actionResult = { ok: false, error: 'bridge unreachable' };
  const db = stubDb();
  const r = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });

  assert.equal(r.status, RUN_STATUS.failed);
  const row = lastRun(db);
  assert.equal(row.stoppedAt, 'action');
  assert.match(row.reasonHe, /bridge unreachable/);
});

test('an executor that THROWS still ends as an auditable failed run', async () => {
  reset();
  actionResult = new Error('boom');
  const db = stubDb();
  const r = await runAutomation(def(), { submission, answers: {}, refs: { submissionId: 'sub1' } }, { db, log: silent });
  assert.equal(r.status, RUN_STATUS.failed);
  assert.match(lastRun(db).reasonHe, /boom/);
});

test('an action kind with no executor fails loudly instead of doing nothing', async () => {
  // A kind declared in the catalogue but not yet wired must be a visible
  // failure, never a silent no-op that looks like success.
  reset();
  const db = stubDb();
  const r = await runAutomation(def({ actions: [{ kind: 'not_wired_yet' }] }), {
    submission, answers: {}, refs: { submissionId: 'sub1' },
  }, { db, log: silent });
  assert.equal(r.status, RUN_STATUS.failed);
  assert.match(lastRun(db).reasonHe, /not_implemented/);
});

// ── the frozen run input ─────────────────────────────────────────────────────

test('only the answers the automation reads are frozen into the run', async () => {
  reset();
  const db = stubDb();
  const d = def({ when: { q: 'q_aaaaaaaa', op: 'answered' } });
  await runAutomation(d, {
    submission,
    answers: { q_aaaaaaaa: 'כן', q_private: 'הערה פרטית של המדריך' },
    refs: { submissionId: 'sub1' },
  }, { db, log: silent });

  const input = lastRun(db).input;
  assert.deepEqual(Object.keys(input.answers), ['q_aaaaaaaa']);
  assert.equal(input.answers.q_private, undefined, 'unread answers must not land in an audit table');
});

// The subject→refs and answersOf helpers were removed with
// sources/questionnaire.js: no questionnaire automation exists any more, and the
// submit path calls its consequences directly. Their tests went with them
// rather than being kept alive against a module nothing imports.
