import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependency, resolveDependencies, isKnownDependencyKind } from './dependencies.js';

// Dependency resolvers are what turn the registry into a control center: they
// must name the SPECIFIC thing that is wrong, and they must distinguish
// "can never run" (hard → שבורה) from "cannot run yet" (soft → ממתינה לתלות).

// Minimal stub client — only the reads the resolvers actually perform.
function stubDb(data = {}) {
  return {
    questionnaireTemplate: {
      findUnique: async ({ where }) => data.templates?.[where.key] ?? null,
    },
    questionnaireQuestion: {
      findFirst: async ({ where }) =>
        (data.questions || []).find((q) => q.versionId === where.versionId && q.key === where.key) ?? null,
    },
    questionnaireQuestionOption: {
      findFirst: async ({ where }) =>
        (data.options || []).find((o) => o.questionId === where.questionId && o.value === where.value) ?? null,
    },
    communicationEvent: { findMany: async () => data.commEvents ?? [] },
    adminReportConfig: { findUnique: async ({ where }) => data.reportConfigs?.[where.reportNumber] ?? null },
    taskType: { findUnique: async ({ where }) => data.taskTypes?.[where.key] ?? null },
  };
}

const LIVE_TEMPLATE = {
  id: 'tpl1', internalName: 'שיחת תיאום', status: 'active', currentVersionId: 'v9',
};

// ── questionnaire_template ───────────────────────────────────────────────────

test('a missing template is HARD — no configuration change can fix it', async () => {
  const r = await resolveDependency(
    { kind: 'questionnaire_template', templateKey: 'tour_coordination' },
    { db: stubDb() },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'hard');
  assert.match(r.detailHe, /אינו קיים/);
});

test('an unpublished template is SOFT — publishing it makes the automation live', async () => {
  const r = await resolveDependency(
    { kind: 'questionnaire_template', templateKey: 'tour_coordination' },
    { db: stubDb({ templates: { tour_coordination: { ...LIVE_TEMPLATE, currentVersionId: null } } }) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'soft');
  assert.match(r.detailHe, /גרסה מפורסמת/);
  assert.equal(r.link, '/admin/questionnaires/tpl1');
});

test('an archived template is HARD', async () => {
  const r = await resolveDependency(
    { kind: 'questionnaire_template', templateKey: 'tour_coordination' },
    { db: stubDb({ templates: { tour_coordination: { ...LIVE_TEMPLATE, status: 'archived' } } }) },
  );
  assert.equal(r.severity, 'hard');
});

test('a live template resolves ok', async () => {
  const r = await resolveDependency(
    { kind: 'questionnaire_template', templateKey: 'tour_coordination' },
    { db: stubDb({ templates: { tour_coordination: LIVE_TEMPLATE } }) },
  );
  assert.equal(r.ok, true);
});

// ── questionnaire_question — the key-deletion hazard ─────────────────────────

test('a question key missing from the PUBLISHED version is HARD and says why', async () => {
  // This is the exact failure the whole guard exists for: someone deleted the
  // question and added it back, minting a new key.
  const r = await resolveDependency(
    { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' },
    { db: stubDb({ templates: { tour_coordination: LIVE_TEMPLATE }, questions: [] }) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'hard');
  assert.match(r.detailHe, /q_9f3a12bd/);
  assert.match(r.detailHe, /נמחקה ונוצרה מחדש/);
});

test('a question present in the published version resolves ok', async () => {
  const r = await resolveDependency(
    { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' },
    {
      db: stubDb({
        templates: { tour_coordination: LIVE_TEMPLATE },
        questions: [{ id: 'q1', versionId: 'v9', key: 'q_9f3a12bd' }],
      }),
    },
  );
  assert.equal(r.ok, true);
});

test('a question in a DRAFT-only version does not count as satisfied', async () => {
  // Real submissions are filled against the published structure; a key alive
  // only in a draft would make a broken automation look healthy.
  const r = await resolveDependency(
    { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' },
    {
      db: stubDb({
        templates: { tour_coordination: LIVE_TEMPLATE },
        questions: [{ id: 'q1', versionId: 'v10-draft', key: 'q_9f3a12bd' }],
      }),
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'hard');
});

// ── questionnaire_option ─────────────────────────────────────────────────────

test('a removed option is HARD, and is not double-reported when the question is gone', async () => {
  const db = stubDb({
    templates: { tour_coordination: LIVE_TEMPLATE },
    questions: [{ id: 'q1', versionId: 'v9', key: 'q_9f3a12bd' }],
    options: [],
  });
  const r = await resolveDependency(
    { kind: 'questionnaire_option', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd', optionValue: 'o_7c21ab90' },
    { db },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'hard');
  assert.match(r.detailHe, /o_7c21ab90/);
});

// ── communication_trigger ────────────────────────────────────────────────────

test('no configured communication rule is SOFT — the automation runs, it just sends nothing', async () => {
  const r = await resolveDependency(
    { kind: 'communication_trigger', triggerType: 'deal_won' },
    { db: stubDb({ commEvents: [] }) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'soft');
  assert.match(r.detailHe, /אירוע תקשורת פעיל/);
});

test('an active rule with no live message is SOFT and says so specifically', async () => {
  const r = await resolveDependency(
    { kind: 'communication_trigger', triggerType: 'deal_won' },
    { db: stubDb({ commEvents: [{ id: 'e1', messages: [] }] }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.detailHe, /אין בו מסר פעיל/);
});

test('a live communication rule resolves ok with its message count', async () => {
  const r = await resolveDependency(
    { kind: 'communication_trigger', triggerType: 'deal_won' },
    { db: stubDb({ commEvents: [{ id: 'e1', messages: [{ id: 'm1' }, { id: 'm2' }] }] }) },
  );
  assert.equal(r.ok, true);
  assert.match(r.detailHe, /2 מסרים/);
});

test('an unknown communication trigger type is HARD — only code fixes it', async () => {
  const r = await resolveDependency(
    { kind: 'communication_trigger', triggerType: 'not_a_trigger' },
    { db: stubDb() },
  );
  assert.equal(r.severity, 'hard');
});

// ── admin_report ─────────────────────────────────────────────────────────────

test('an unconfigured admin report is SOFT with the operator-facing reason', async () => {
  const r = await resolveDependency({ kind: 'admin_report', number: 4 }, { db: stubDb() });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'soft');
  assert.match(r.detailHe, /לא הוגדר/);
});

test('a disabled admin report is SOFT', async () => {
  const r = await resolveDependency(
    { kind: 'admin_report', number: 4 },
    { db: stubDb({ reportConfigs: { 4: { enabled: false, waAccountId: 'a', waChatId: 'c' } } }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.detailHe, /מושבת/);
});

test('a fully configured admin report resolves ok', async () => {
  const r = await resolveDependency(
    { kind: 'admin_report', number: 4 },
    { db: stubDb({ reportConfigs: { 4: { enabled: true, waAccountId: 'a', waChatId: 'c' } } }) },
  );
  assert.equal(r.ok, true);
});

test('a report number outside the code catalog is HARD', async () => {
  const r = await resolveDependency({ kind: 'admin_report', number: 9999 }, { db: stubDb() });
  assert.equal(r.severity, 'hard');
});

// ── task_type / control_issue_type / env ─────────────────────────────────────

test('a missing task type is HARD; an inactive one is SOFT', async () => {
  const missing = await resolveDependency({ kind: 'task_type', taskTypeKey: 'follow_up' }, { db: stubDb() });
  assert.equal(missing.severity, 'hard');

  const inactive = await resolveDependency(
    { kind: 'task_type', taskTypeKey: 'follow_up' },
    { db: stubDb({ taskTypes: { follow_up: { nameHe: 'מעקב', isActive: false } } }) },
  );
  assert.equal(inactive.ok, false);
  assert.equal(inactive.severity, 'soft');
});

test('an unregistered control issue type is HARD', async () => {
  const r = await resolveDependency({ kind: 'control_issue_type', issueType: 'nope' }, { db: stubDb() });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'hard');
});

test('a missing env var is SOFT', async () => {
  const r = await resolveDependency({ kind: 'env', name: 'DEFINITELY_NOT_SET_XYZ' }, { db: stubDb() });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'soft');
});

// ── contract ─────────────────────────────────────────────────────────────────

test('a definition may escalate soft to hard, but never downgrade hard to soft', async () => {
  // Downgrading a structural break to "waiting" would hide a real fault.
  const escalated = await resolveDependency(
    { kind: 'admin_report', number: 4, severity: 'hard' },
    { db: stubDb() },
  );
  assert.equal(escalated.severity, 'hard');

  const cannotDowngrade = await resolveDependency(
    { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd', severity: 'soft' },
    { db: stubDb({ templates: { tour_coordination: LIVE_TEMPLATE }, questions: [] }) },
  );
  assert.equal(cannotDowngrade.severity, 'hard');
});

test('an unknown dependency kind is reported, not thrown', async () => {
  assert.equal(isKnownDependencyKind('made_up'), false);
  const r = await resolveDependency({ kind: 'made_up' }, { db: stubDb() });
  assert.equal(r.ok, false);
});

test('a resolver that throws degrades to a soft report — the screen never goes down', async () => {
  const exploding = {
    questionnaireTemplate: { findUnique: async () => { throw new Error('db down'); } },
  };
  const r = await resolveDependency(
    { kind: 'questionnaire_template', templateKey: 'x' },
    { db: exploding },
  );
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'soft');
  assert.match(r.detailHe, /db down/);
});

test('resolveDependencies preserves declaration order', async () => {
  const results = await resolveDependencies(
    {
      dependsOn: [
        { kind: 'env', name: 'DEFINITELY_NOT_SET_XYZ' },
        { kind: 'admin_report', number: 4 },
      ],
    },
    { db: stubDb() },
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].dep.kind, 'env');
  assert.equal(results[1].dep.kind, 'admin_report');
});

test('a definition with no dependencies resolves to an empty list', async () => {
  assert.deepEqual(await resolveDependencies({}, { db: stubDb() }), []);
});
