import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHealth, resolveEnabled, needsAttention, STATUS } from './health.js';
import { registerAutomation, __resetRegistry } from './registry.js';
import { ALLOCATED, RETIRED } from './ledger.js';

// Live operational status. The contract: an automation that cannot run says so,
// with the specific reason, and nothing is ever masked.

const def = (over = {}) => ({
  id: 'AUT-001',
  slug: 'a',
  nameHe: 'אוטומציה א',
  descriptionHe: 'x',
  category: 'tours',
  defaultEnabled: true,
  trigger: { kind: 'questionnaire_submitted', templateKey: 'tour_coordination' },
  when: null,
  actions: [{ kind: 'communication' }],
  dependsOn: [],
  idempotency: (e) => e.id,
  ...over,
});

// Stub client covering only what health.js reads.
function stubDb({ state = null, runs = [], templates = {}, questions = [], reportConfigs = {} } = {}) {
  const match = (r, where) => {
    if (where.autId && r.autId !== where.autId) return false;
    if (where.status && r.status !== where.status) return false;
    if (where.startedAt?.gte && new Date(r.startedAt) < where.startedAt.gte) return false;
    return true;
  };
  return {
    automationState: { findUnique: async () => state },
    automationRun: {
      count: async ({ where }) => runs.filter((r) => match(r, where)).length,
      findFirst: async ({ where }) =>
        runs.filter((r) => match(r, where))
          .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] ?? null,
    },
    questionnaireTemplate: { findUnique: async ({ where }) => templates[where.key] ?? null },
    questionnaireQuestion: {
      findFirst: async ({ where }) =>
        questions.find((q) => q.versionId === where.versionId && q.key === where.key) ?? null,
    },
    questionnaireQuestionOption: { findFirst: async () => null },
    communicationEvent: { findMany: async () => [] },
    adminReportConfig: { findUnique: async ({ where }) => reportConfigs[where.reportNumber] ?? null },
    taskType: { findUnique: async () => null },
  };
}

const LIVE_TEMPLATE = { id: 'tpl1', internalName: 'שיחת תיאום', status: 'active', currentVersionId: 'v9' };

function withDef(d, fn) {
  const borrowed = !ALLOCATED.includes(d.id);
  if (borrowed) ALLOCATED.push(d.id);
  try {
    registerAutomation(d);
    return fn();
  } finally {
    __resetRegistry();
    if (borrowed) ALLOCATED.splice(ALLOCATED.indexOf(d.id), 1);
  }
}

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// ── resolveEnabled ───────────────────────────────────────────────────────────

test('the operator override beats the definition default, in both directions', () => {
  assert.equal(resolveEnabled({ defaultEnabled: true }, null), true);
  assert.equal(resolveEnabled({ defaultEnabled: true }, { enabled: false }), false);
  assert.equal(resolveEnabled({ defaultEnabled: false }, { enabled: true }), true);
  // A row that exists without an explicit choice inherits the default.
  assert.equal(resolveEnabled({ defaultEnabled: true }, { enabled: null }), true);
});

// ── statuses ─────────────────────────────────────────────────────────────────

test('a healthy automation that has never run says so honestly', async () => {
  await withDef(def(), async () => {
    const h = await resolveHealth('AUT-001', { db: stubDb() });
    assert.equal(h.status, STATUS.active);
    assert.match(h.reasonHe, /טרם רצה/);
    assert.equal(needsAttention(h), false);
  });
});

test('a hard dependency failure reports BROKEN with the specific reason', async () => {
  await withDef(
    def({ dependsOn: [{ kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' }] }),
    async () => {
      const h = await resolveHealth('AUT-001', {
        db: stubDb({ templates: { tour_coordination: LIVE_TEMPLATE }, questions: [] }),
      });
      assert.equal(h.status, STATUS.broken);
      assert.match(h.reasonHe, /q_9f3a12bd/);
      assert.equal(needsAttention(h), true);
    },
  );
});

test('a soft dependency failure reports WAITING, not broken', async () => {
  await withDef(def({ dependsOn: [{ kind: 'communication_trigger', triggerType: 'deal_won' }] }), async () => {
    const h = await resolveHealth('AUT-001', { db: stubDb() });
    assert.equal(h.status, STATUS.waiting_dependency);
    assert.match(h.reasonHe, /לא הוגדר/);
  });
});

test('recent failures report ERROR with the count and the last message', async () => {
  await withDef(def(), async () => {
    const h = await resolveHealth('AUT-001', {
      db: stubDb({
        runs: [
          { autId: 'AUT-001', status: 'failed', startedAt: daysAgo(1), reasonHe: 'שליחה נכשלה' },
          { autId: 'AUT-001', status: 'failed', startedAt: daysAgo(2), reasonHe: 'שליחה נכשלה' },
          { autId: 'AUT-001', status: 'ran', startedAt: daysAgo(3) },
        ],
      }),
    });
    assert.equal(h.status, STATUS.error);
    assert.match(h.reasonHe, /2 הרצות נכשלו/);
    assert.match(h.reasonHe, /שליחה נכשלה/);
  });
});

test('failures OUTSIDE the window do not make a healthy automation look broken', async () => {
  await withDef(def(), async () => {
    const h = await resolveHealth('AUT-001', {
      db: stubDb({ runs: [{ autId: 'AUT-001', status: 'failed', startedAt: daysAgo(30) }] }),
    });
    assert.equal(h.status, STATUS.active);
    assert.equal(h.stats.totalRuns, 1);
    assert.ok(h.stats.lastFailureAt);
  });
});

test('DISABLED outranks broken — but the breakage is still reported, never hidden', async () => {
  await withDef(
    def({ dependsOn: [{ kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' }] }),
    async () => {
      const h = await resolveHealth('AUT-001', {
        db: stubDb({
          state: { autId: 'AUT-001', enabled: false, updatedByName: 'דור' },
          templates: { tour_coordination: LIVE_TEMPLATE },
          questions: [],
        }),
      });
      assert.equal(h.status, STATUS.disabled);
      assert.match(h.reasonHe, /דור/);
      // The secondary chip is what stops "disabled" from masking a real fault.
      assert.deepEqual(h.secondary.map((s) => s.status), [STATUS.broken]);
    },
  );
});

test('BROKEN outranks waiting and error when several problems coexist', async () => {
  await withDef(
    def({
      dependsOn: [
        { kind: 'communication_trigger', triggerType: 'deal_won' },
        { kind: 'questionnaire_question', templateKey: 'tour_coordination', questionKey: 'q_9f3a12bd' },
      ],
    }),
    async () => {
      const h = await resolveHealth('AUT-001', {
        db: stubDb({
          templates: { tour_coordination: LIVE_TEMPLATE },
          questions: [],
          runs: [{ autId: 'AUT-001', status: 'failed', startedAt: daysAgo(1) }],
        }),
      });
      assert.equal(h.status, STATUS.broken);
      assert.deepEqual(h.secondary.map((s) => s.status), [STATUS.waiting_dependency, STATUS.error]);
    },
  );
});

test('a retired automation stays visible with its history and its reason', async () => {
  // "If an automation is removed, the registry must reflect it."
  const borrowed = !ALLOCATED.includes('AUT-001');
  if (borrowed) ALLOCATED.push('AUT-001');
  RETIRED['AUT-001'] = { retiredOn: '2026-09-01', reasonHe: 'הוחלפה על ידי AUT-019' };
  try {
    const h = await resolveHealth('AUT-001', {
      db: stubDb({ runs: [{ autId: 'AUT-001', status: 'ran', startedAt: daysAgo(40) }] }),
    });
    assert.equal(h.status, STATUS.retired);
    assert.match(h.reasonHe, /AUT-019/);
    assert.equal(h.stats.totalRuns, 1);
  } finally {
    delete RETIRED['AUT-001'];
    if (borrowed) ALLOCATED.splice(ALLOCATED.indexOf('AUT-001'), 1);
  }
});

test('stats expose last run, last success and last failure separately', async () => {
  // Timestamps are computed ONCE — recomputing daysAgo() for the assertion
  // races the clock and makes this flaky by a millisecond.
  const failedAt = daysAgo(1);
  const succeededAt = daysAgo(5);
  await withDef(def(), async () => {
    const h = await resolveHealth('AUT-001', {
      db: stubDb({
        runs: [
          { autId: 'AUT-001', status: 'failed', startedAt: failedAt, reasonHe: 'x' },
          { autId: 'AUT-001', status: 'ran', startedAt: succeededAt },
          { autId: 'AUT-001', status: 'skipped', startedAt: daysAgo(6) },
        ],
      }),
    });
    assert.equal(h.stats.totalRuns, 3);
    assert.equal(h.stats.lastRunStatus, 'failed');
    assert.equal(h.stats.lastSuccessAt, succeededAt);
    assert.equal(h.stats.lastFailureAt, failedAt);
    assert.equal(h.stats.lastError, 'x');
  });
});
