import test from 'node:test';
import assert from 'node:assert/strict';
import { seedStageConfig, buildReviewSummary, listQueue, recordDecision } from './service.js';
import { STAGE_CONFIG_COUNT } from './stageConfigSeed.js';

// A stub prisma that exposes ONLY migrationDecision. Any attempt to touch a
// production model (deal/contact/organization/tour/task/timeline) or LegacyRecord
// throws — so "no production writes" is enforced by the test, not by inspection.
function stubClient(extra = []) {
  const rows = new Map();
  let idc = 0;
  const key = (q, s) => `${q}|${s}`;
  for (const r of extra) rows.set(key(r.queue, r.subjectKey), { id: `pre${++idc}`, ...r });

  const migrationDecision = {
    count: async ({ where } = {}) =>
      [...rows.values()].filter((r) => (!where?.queue || r.queue === where.queue)).length,
    upsert: async ({ where, create, update }) => {
      const k = key(where.queue_subjectKey.queue, where.queue_subjectKey.subjectKey);
      if (rows.has(k)) { Object.assign(rows.get(k), update); return rows.get(k); }
      const row = { id: `d${++idc}`, decidedBy: null, note: null, ...create };
      rows.set(k, row);
      return row;
    },
    groupBy: async () => {
      const acc = new Map();
      for (const r of rows.values()) {
        const k = `${r.queue}|${r.status}`;
        acc.set(k, (acc.get(k) || 0) + 1);
      }
      return [...acc.entries()].map(([k, n]) => {
        const [queue, status] = k.split('|');
        return { queue, status, _count: n };
      });
    },
    findMany: async ({ where }) =>
      [...rows.values()].filter((r) => r.queue === where.queue && (!where.status || r.status === where.status)),
    findUnique: async ({ where: { id } }) => [...rows.values()].find((r) => r.id === id) || null,
    update: async ({ where: { id }, data }) => {
      const r = [...rows.values()].find((x) => x.id === id);
      Object.assign(r, data);
      return r;
    },
  };

  return new Proxy({ migrationDecision, _rows: rows }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(`FORBIDDEN: review code touched prisma.${String(prop)} — no production writes allowed`);
    },
  });
}

test('seeds the approved configuration exactly once, as approved, with audit metadata', async () => {
  const c = stubClient();
  const r = await seedStageConfig(c);
  assert.equal(r.expected, STAGE_CONFIG_COUNT);
  assert.equal(r.created, STAGE_CONFIG_COUNT);
  assert.equal(r.total, STAGE_CONFIG_COUNT);
  const rows = [...c._rows.values()];
  assert.ok(rows.length > 20, 'a meaningful number of decisions');
  assert.ok(rows.every((x) => x.queue === 'stage_config'));
  assert.ok(rows.every((x) => x.status === 'approved'), 'seeded as already-approved (never re-asked)');
  assert.ok(rows.every((x) => x.decidedByName && x.decidedAt), 'audit metadata present');
  // Both shapes present: stage mappings and rules.
  assert.ok(rows.some((x) => x.proposal.kind === 'stage_mapping'));
  assert.ok(rows.some((x) => x.proposal.kind === 'rule'));
});

test('repeated seeding does not duplicate decisions and preserves the audit trail', async () => {
  const c = stubClient();
  await seedStageConfig(c);
  const before = [...c._rows.values()].find((x) => x.subjectKey.startsWith('stage:'));
  const stampedAt = before.decidedAt;
  // Simulate a recorded human edit that must survive re-seeding.
  before.note = 'הערה שנרשמה';

  const second = await seedStageConfig(c);
  assert.equal(second.created, 0, 'no new rows on re-seed');
  assert.equal(second.total, STAGE_CONFIG_COUNT, 'total unchanged');
  assert.equal(c._rows.size, STAGE_CONFIG_COUNT, 'no duplicates');
  const after = [...c._rows.values()].find((x) => x.subjectKey === before.subjectKey);
  assert.equal(after.decidedAt, stampedAt, 'decidedAt untouched');
  assert.equal(after.note, 'הערה שנרשמה', 'recorded state never clobbered by re-seeding');
});

test('progress summary + blocking gate are correct while other queues are unbuilt', async () => {
  const c = stubClient();
  await seedStageConfig(c);
  const s = await buildReviewSummary(c);

  assert.equal(s.queues.length, 6, 'six tabs');
  assert.deepEqual(s.queues.map((q) => q.key), ['organizations', 'contacts', 'name_cleanup', 'stage_config', 'exceptional', 'legacy_archive']);

  const stage = s.queues.find((q) => q.key === 'stage_config');
  assert.equal(stage.counts.total, STAGE_CONFIG_COUNT);
  assert.equal(stage.counts.unresolved, 0);
  assert.equal(stage.counts.approved, STAGE_CONFIG_COUNT);
  assert.equal(stage.complete, true);
  assert.equal(stage.frozen, true);

  // Unbuilt queues are honestly incomplete — the gate stays closed.
  assert.equal(s.queues.find((q) => q.key === 'organizations').complete, false);
  assert.equal(s.gate.blockingTotal, 4);
  assert.equal(s.gate.blockingComplete, 1);
  assert.equal(s.gate.readyToFinalize, false);
  assert.deepEqual(s.gate.waitingOn.map((w) => w.key), ['organizations', 'contacts', 'name_cleanup']);
  assert.ok(s.gate.waitingOn.every((w) => w.reason === 'טרם נבנה'));

  assert.equal(s.totals.decisions, STAGE_CONFIG_COUNT);
  assert.equal(s.totals.resolved, STAGE_CONFIG_COUNT);
  assert.equal(s.totals.unresolved, 0);
});

test('gate opens only when every blocking queue is resolved; non-blocking never blocks', async () => {
  const c = stubClient([
    { queue: 'organizations', subjectKey: 'o1', status: 'approved', proposal: {} },
    { queue: 'contacts', subjectKey: 'c1', status: 'edited', proposal: {} },
    { queue: 'name_cleanup', subjectKey: 'n1', status: 'pending', proposal: {} },
    { queue: 'exceptional', subjectKey: 'e1', status: 'pending', proposal: {} }, // non-blocking
  ]);
  await seedStageConfig(c);

  let s = await buildReviewSummary(c);
  assert.equal(s.gate.readyToFinalize, false, 'name_cleanup still pending');
  assert.deepEqual(s.gate.waitingOn.map((w) => w.key), ['name_cleanup']);
  assert.equal(s.gate.waitingOn[0].reason, 'ממתין להחלטות');

  // Resolve the last blocking decision — the pending NON-blocking one must not matter.
  [...c._rows.values()].find((r) => r.queue === 'name_cleanup').status = 'rejected';
  s = await buildReviewSummary(c);
  assert.equal(s.gate.readyToFinalize, true, 'gate opens; the pending exceptional row does not block');
  assert.equal(s.queues.find((q) => q.key === 'exceptional').counts.unresolved, 1);
});

test('recording a decision preserves who decided and when', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'o1', status: 'pending', proposal: {} }]);
  const target = [...c._rows.values()][0];
  const row = await recordDecision(c, {
    id: target.id, action: 'approve', decision: { merge: true }, note: '  אושר  ',
    userId: 'u1', userName: 'elinoy',
  });
  assert.equal(row.status, 'approved');
  assert.equal(row.decidedBy, 'u1');
  assert.equal(row.decidedByName, 'elinoy');
  assert.ok(row.decidedAt instanceof Date);
  assert.deepEqual(row.decision, { merge: true });
});

test('frozen configuration cannot be re-decided through the API', async () => {
  const c = stubClient();
  await seedStageConfig(c);
  const target = [...c._rows.values()][0];
  await assert.rejects(
    () => recordDecision(c, { id: target.id, action: 'reject', userId: 'u1', userName: 'x' }),
    (e) => e.code === 'QUEUE_FROZEN',
  );
});

test('invalid action and unknown queue are rejected', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'o1', status: 'pending', proposal: {} }]);
  const id = [...c._rows.values()][0].id;
  await assert.rejects(() => recordDecision(c, { id, action: 'nuke' }), (e) => e.code === 'INVALID_ACTION');
  await assert.rejects(() => recordDecision(c, { id: 'nope', action: 'approve' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => listQueue(c, 'not_a_queue'), (e) => e.code === 'UNKNOWN_QUEUE');
});

test('listQueue returns label→value proposals + audit, and marks resolution', async () => {
  const c = stubClient();
  await seedStageConfig(c);
  const { queue, decisions } = await listQueue(c, 'stage_config');
  assert.equal(queue.key, 'stage_config');
  assert.equal(queue.frozen, true);
  assert.equal(decisions.length, STAGE_CONFIG_COUNT);
  assert.ok(decisions.every((d) => d.resolved === true));
  const stage = decisions.find((d) => d.proposal.kind === 'stage_mapping');
  // Plain, renderable facts — no raw legacy payload blobs.
  assert.ok(stage.proposal.pipeline && stage.proposal.stage && stage.proposal.targetStageLabel);
  assert.equal(typeof stage.proposal.deals, 'number');
  assert.ok(stage.decidedByName);
});

test('the whole review service touches ONLY the decision ledger (no production writes)', async () => {
  // The stub throws on any other prisma model; reaching the end proves it.
  const c = stubClient();
  await seedStageConfig(c);
  await buildReviewSummary(c);
  await listQueue(c, 'stage_config');
  assert.ok(true);
});
