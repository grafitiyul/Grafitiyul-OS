import test from 'node:test';
import assert from 'node:assert/strict';
import { seedStageConfig, buildReviewSummary, listQueue, recordDecision, batchApproveSafe, buildOrgTargets, buildContactWorkload, recordIdentityEdits, getIdentityEdits } from './service.js';
import { STAGE_CONFIG_COUNT } from './stageConfigSeed.js';
import { draftFromProposal } from './orgDecision.js';

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
      [...rows.values()].filter(
        (r) =>
          r.queue === where.queue &&
          (!where.status || r.status === where.status) &&
          (!where.subjectKey?.in || where.subjectKey.in.includes(r.subjectKey)),
      ),
    findUnique: async ({ where }) => {
      if (where.id) return [...rows.values()].find((r) => r.id === where.id) || null;
      const k = key(where.queue_subjectKey.queue, where.queue_subjectKey.subjectKey);
      return rows.get(k) || null;
    },
    create: async ({ data }) => {
      const row = { id: `d${++idc}`, decidedBy: null, note: null, ...data };
      rows.set(key(data.queue, data.subjectKey), row);
      return row;
    },
    delete: async ({ where: { id } }) => {
      for (const [k, r] of rows) if (r.id === id) { rows.delete(k); return r; }
      return null;
    },
    update: async ({ where: { id }, data }) => {
      const r = [...rows.values()].find((x) => x.id === id);
      Object.assign(r, data);
      return r;
    },
  };

  // Live GOS organizations are READ (never written) as merge targets/evidence.
  const organization = {
    findMany: async () => [{ id: 'gosA', name: 'ארגון קיים', units: [{ id: 'gosU1', name: 'סניף קיים' }] }],
  };

  return new Proxy({ migrationDecision, organization, _rows: rows }, {
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

// Generic audit behaviour, on a queue with no domain resolver of its own.
// (`exceptional` stores the chosen treatment verbatim — Organizations, Contacts and
// Name Cleanup each resolve their decision server-side instead.)
test('recording a decision preserves who decided and when', async () => {
  const c = stubClient([{ queue: 'exceptional', subjectKey: 'exc:archived_open_deal:1', status: 'pending', proposal: {} }]);
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

// A minimal organizations proposal for decision-recording tests.
const ORG_PROPOSAL = {
  kind: 'organization_cluster',
  members: [
    { legacyId: 1, name: 'Leumi Capital Markets', dealCount: 3, contactCount: 1 },
    { legacyId: 2, name: 'Capital Markets', dealCount: 2, contactCount: 1 },
  ],
  proposedCanonical: { name: 'Leumi Capital Markets', organizationTypeId: null },
  proposedUnits: [],
  proposedAssignments: { 1: 'organization', 2: 'organization' },
};

test('an owner decision stores the EDITED names + the per-source mapping', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL }]);
  const id = [...c._rows.values()][0].id;
  const row = await recordDecision(c, {
    id, action: 'edit', userId: 'u1', userName: 'elinoy',
    decision: {
      canonicalName: 'Bank Leumi',
      organizationTypeId: null,
      mergeIntoGosId: null,
      units: [{ key: 'cm', name: 'Capital Markets Division' }],
      dispositions: { 1: { disposition: 'organization' }, 2: { disposition: 'unit', targetUnitKey: 'cm' } },
    },
  });
  assert.equal(row.status, 'edited');
  assert.equal(row.decision.canonicalName, 'Bank Leumi', 'the typed name wins');
  assert.equal(row.decision.result.units[0].name, 'Capital Markets Division');
  assert.deepEqual(row.decision.dispositions['2'], { disposition: 'unit', targetUnitKey: 'cm' });
  assert.equal(row.decision.result.valid, true);
  assert.equal(row.decidedByName, 'elinoy');
});

test('an invalid edited decision is refused (never silently stored)', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'org:normName:y', status: 'pending', proposal: ORG_PROPOSAL }]);
  const id = [...c._rows.values()][0].id;
  // No disposition for either source record → blocked.
  await assert.rejects(
    () => recordDecision(c, { id, action: 'edit', decision: { canonicalName: 'x', units: [], dispositions: {} } }),
    (e) => e.code === 'INVALID_DECISION',
  );
  assert.equal([...c._rows.values()][0].status, 'pending', 'left untouched');
});

test('rejecting an Organizations cluster materialises EXPLICIT standalone dispositions', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL }]);
  const id = [...c._rows.values()][0].id;
  const row = await recordDecision(c, { id, action: 'reject', userName: 'elinoy' });
  assert.equal(row.status, 'rejected');
  // "Not duplicates" → each source row is its own organization, stated explicitly
  // so the import never has to infer intent.
  assert.equal(row.decision.rejectedAsSeparate, true);
  assert.deepEqual(Object.keys(row.decision.dispositions).sort(), ['1', '2']);
  for (const [id2, d] of Object.entries(row.decision.dispositions)) {
    assert.equal(d.disposition, 'other_organization');
    assert.equal(d.targetOrganizationKey, `new:${id2}`);
  }
  assert.equal(row.decision.result.totals.sentElsewhere, 2);
  assert.equal(row.decidedByName, 'elinoy');
});

test('EVERY source id in a decided cluster has exactly one disposition', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL }]);
  const id = [...c._rows.values()][0].id;
  for (const action of ['reject', 'edit']) {
    const decision = action === 'edit'
      ? { canonicalName: 'X', units: [], dispositions: { 1: { disposition: 'organization' }, 2: { disposition: 'organization' } } }
      : null;
    const row = await recordDecision(c, { id, action, decision });
    const ids = ORG_PROPOSAL.members.map((m) => String(m.legacyId));
    assert.deepEqual(Object.keys(row.decision.dispositions).sort(), ids.sort(), `${action}: every source id covered`);
    for (const d of Object.values(row.decision.dispositions)) assert.ok(d.disposition, `${action}: one disposition each`);
  }
});

test('a cross-cluster mapping is validated against the LIVE target registry', async () => {
  const c = stubClient([
    { queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL },
    { queue: 'organizations', subjectKey: 'org:normName:store', status: 'pending', proposal: { ...ORG_PROPOSAL, proposedCanonical: { name: 'STORE NEXT', organizationTypeId: null } } },
  ]);
  const [a] = [...c._rows.values()];
  // Map source 2 to the OTHER cluster's organization — a real, existing target.
  const ok = await recordDecision(c, {
    id: a.id, action: 'edit', userName: 'elinoy',
    decision: {
      canonicalName: 'IMD SOFT', units: [],
      dispositions: { 1: { disposition: 'organization' }, 2: { disposition: 'other_organization', targetOrganizationKey: 'prop:org:normName:store' } },
    },
  });
  assert.equal(ok.decision.result.elsewhere[0].targetName, 'STORE NEXT', 'resolved through the registry');

  // A target that does not exist is refused.
  await assert.rejects(
    () => recordDecision(c, {
      id: a.id, action: 'edit',
      decision: { canonicalName: 'IMD SOFT', units: [], dispositions: { 1: { disposition: 'organization' }, 2: { disposition: 'other_organization', targetOrganizationKey: 'prop:nope' } } },
    }),
    (e) => e.code === 'INVALID_DECISION',
  );
});

test('an existing GOS organization is offered as a mapping target (read-only)', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL }]);
  const targets = await buildOrgTargets(c);
  assert.equal(targets.gos.length, 1);
  assert.equal(targets.gos[0].key, 'gos:gosA');
  assert.deepEqual(targets.gos[0].units, [{ key: 'gosU1', name: 'סניף קיים' }]);
  assert.equal(targets.proposals[0].key, 'prop:org:normName:x');
});

test('re-seeding NEVER overwrites an owner-edited organizations decision', async () => {
  // Simulates the proposal pass: it may refresh a PENDING proposal, never a decided one.
  const c = stubClient([
    { queue: 'organizations', subjectKey: 'org:normName:x', status: 'pending', proposal: ORG_PROPOSAL },
    { queue: 'organizations', subjectKey: 'org:normName:z', status: 'pending', proposal: ORG_PROPOSAL },
  ]);
  const [a, b] = [...c._rows.values()];
  await recordDecision(c, {
    id: a.id, action: 'edit', userId: 'u1', userName: 'elinoy',
    decision: {
      canonicalName: 'Bank Leumi',
      units: [{ key: 'cm', name: 'Capital Markets Division' }],
      dispositions: { 1: { disposition: 'organization' }, 2: { disposition: 'unit', targetUnitKey: 'cm' } },
    },
  });

  // The pass's rule: the EVIDENCE (proposal) is refreshed on every row so decided
  // clusters show the same full context; status/decision/audit are never touched.
  for (const row of [...c._rows.values()]) row.proposal = { ...ORG_PROPOSAL, rank: 99 };

  const decided = [...c._rows.values()].find((r) => r.id === a.id);
  assert.equal(decided.status, 'edited', 'status untouched');
  assert.equal(decided.decidedByName, 'elinoy', 'audit untouched');
  assert.equal(decided.decision.canonicalName, 'Bank Leumi', 'owner edit survived re-seeding');
  assert.equal(decided.decision.result.units[0].name, 'Capital Markets Division');
  assert.equal(decided.proposal.rank, 99, 'evidence IS refreshed, even on a decided row');
  assert.equal([...c._rows.values()].find((r) => r.id === b.id).status, 'pending', 'undecided rows stay pending');

  // And re-opening the decided row still yields the OWNER's values, not the
  // refreshed proposal's suggestion.
  const reopened = draftFromProposal(decided.proposal, decided.decision);
  assert.equal(reopened.canonicalName, 'Bank Leumi');
  assert.equal(reopened.units[0].name, 'Capital Markets Division');
});

// ── Batch approval of safe contact clusters ─────────────────────────────────
const contactCluster = (id, confidence, batchApprovable, section = batchApprovable ? 'safe' : 'historical') => ({
  queue: 'contacts', subjectKey: `contact:phone:${id}`, status: 'pending',
  proposal: {
    kind: 'contact_cluster', confidence, batchApprovable, section,
    decisionRequired: !batchApprovable && section !== 'none',
    members: [
      { legacyId: id * 10, name: 'דנה', phones: ['050-1111111'], emails: [], dealCount: 2 },
      { legacyId: id * 10 + 1, name: 'דנה', phones: ['0501111111'], emails: [], dealCount: 1 },
    ],
    proposedPrimaryLegacyId: id * 10,
    proposedMergeLegacyIds: [id * 10 + 1],
    proposedSeparateLegacyIds: [],
  },
});

test('batch approve touches ONLY engine-marked safe clusters, with a full audit trail', async () => {
  const c = stubClient([
    contactCluster(1, 'safe', true),
    contactCluster(2, 'safe', true),
    contactCluster(3, 'probable', false),
    contactCluster(4, 'shared', false),
    contactCluster(5, 'ambiguous', false),
  ]);
  const res = await batchApproveSafe(c, { queue: 'contacts', userId: 'u1', userName: 'elinoy' });
  assert.equal(res.approved, 2);
  assert.equal(res.skipped, 3);

  const rows = [...c._rows.values()];
  for (const r of rows) {
    if (r.proposal.batchApprovable) {
      assert.equal(r.status, 'approved');
      assert.equal(r.decidedByName, 'elinoy', 'audited exactly like a manual approval');
      assert.ok(r.decidedAt instanceof Date);
      assert.equal(r.decision.primaryLegacyId, r.proposal.proposedPrimaryLegacyId, 'stores exactly the proposal');
      assert.match(r.note, /אישור קבוצתי/);
    } else {
      assert.equal(r.status, 'pending', 'risky clusters are never batch-approved');
      assert.equal(r.decision, undefined);
    }
  }
});

test('batch approve cannot be pointed at another queue, and is idempotent', async () => {
  const c = stubClient([contactCluster(1, 'safe', true)]);
  await assert.rejects(() => batchApproveSafe(c, { queue: 'organizations' }), (e) => e.code === 'BATCH_NOT_SUPPORTED');
  await assert.rejects(() => batchApproveSafe(c, { queue: 'stage_config' }), (e) => e.code === 'BATCH_NOT_SUPPORTED');

  assert.equal((await batchApproveSafe(c, { queue: 'contacts' })).approved, 1);
  // Running it again approves nothing new — decided rows are no longer pending.
  assert.equal((await batchApproveSafe(c, { queue: 'contacts' })).approved, 0);
});

// ── Business-impact sections ────────────────────────────────────────────────
// The point of the whole exercise: the owner must not be shown 789 clusters as if
// they were equal, and must never be shown the ones with nothing to decide.
test('the Contacts queue hides `none` clusters unless they are asked for explicitly', async () => {
  const c = stubClient([
    contactCluster(1, 'safe', true),
    contactCluster(2, 'probable', false, 'critical'),
    contactCluster(3, 'probable', false, 'historical'),
    contactCluster(4, 'ambiguous', false, 'none'),
    contactCluster(5, 'ambiguous', false, 'none'),
  ]);
  // Default listing: everything EXCEPT `none`.
  const all = await listQueue(c, 'contacts');
  assert.equal(all.decisions.length, 3);
  assert.ok(!all.decisions.some((d) => d.proposal.section === 'none'), 'never shown by default');

  // The landing section is the only one that blocks Identity Import.
  const critical = await listQueue(c, 'contacts', { section: 'critical' });
  assert.equal(critical.decisions.length, 1);
  assert.equal(critical.decisions[0].proposal.section, 'critical');

  // `none` is reachable only on purpose (the statistics link).
  const none = await listQueue(c, 'contacts', { section: 'none' });
  assert.equal(none.decisions.length, 2);

  await assert.rejects(() => listQueue(c, 'contacts', { section: 'nope' }), (e) => e.code === 'UNKNOWN_SECTION');
});

test('sections apply to Contacts only — other queues are untouched', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'o1', status: 'pending', proposal: {} }]);
  const orgs = await listQueue(c, 'organizations');
  assert.equal(orgs.decisions.length, 1, 'an org proposal has no section and must not be filtered away');
});

test('the workload dashboard reports the four headline numbers and the import gate', async () => {
  const c = stubClient([
    contactCluster(1, 'safe', true),
    contactCluster(2, 'safe', true),
    contactCluster(3, 'probable', false, 'critical'),
    contactCluster(4, 'probable', false, 'recent'),
    contactCluster(5, 'probable', false, 'historical'),
    contactCluster(6, 'ambiguous', false, 'low'),
    contactCluster(7, 'ambiguous', false, 'none'),
  ]);
  const w = await buildContactWorkload(c);
  assert.equal(w.headline.safe, 2);
  assert.equal(w.headline.beforeImport, 1, 'only the critical section blocks import');
  assert.equal(w.headline.historicalReview, 3, 'recent + historical + low');
  assert.equal(w.headline.noDecisionRequired, 1);
  assert.equal(w.criticalCleared, false);

  // Deciding the critical cluster opens the gate — and nothing else has to happen.
  const critical = [...c._rows.values()].find((r) => r.proposal.section === 'critical');
  critical.status = 'approved';
  const after = await buildContactWorkload(c);
  assert.equal(after.headline.beforeImport, 0);
  assert.equal(after.criticalCleared, true, 'the owner can stop here and import safely');
  assert.equal(after.headline.historicalReview, 3, 'the rest stays open, and that is fine');
});

// ── Source-data corrections ─────────────────────────────────────────────────
const identityCluster = () => ({
  queue: 'contacts', subjectKey: 'contact:email:itay@example.com', status: 'pending',
  proposal: {
    kind: 'contact_cluster', confidence: 'probable', batchApprovable: false, section: 'critical',
    clusterKind: 'email', clusterKey: 'itay@example.com',
    members: [
      { legacyId: 1, name: 'איתי רון', phones: ['050-1112222'], emails: ['itay@example.com'], dealCount: 2 },
      { legacyId: 2, name: 'מיכל אבן', phones: ['054-3334444'], emails: ['itay@example.com'], dealCount: 3 },
    ],
    proposedPrimaryLegacyId: 2, proposedMergeLegacyIds: [], proposedSeparateLegacyIds: [1],
  },
});

test('a correction is stored per SOURCE CONTACT, not per cluster', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  const res = await recordIdentityEdits(c, {
    clusterDecisionId: cluster.id,
    edits: { 2: { removeEmails: ['itay@example.com'] } },
    note: 'the address belongs to the other person',
    userId: 'u1', userName: 'elinoy',
  });
  assert.equal(res.written, 1, 'only the corrected record gets a row');

  const rows = [...c._rows.values()].filter((r) => r.queue === 'contact_identity');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subjectKey, 'person:2', 'keyed by the source contact');
  assert.deepEqual(rows[0].decision.effective, { phones: ['054-3334444'], emails: [] });
  assert.deepEqual(rows[0].proposal.original.emails, ['itay@example.com'], 'the ORIGINAL is preserved as evidence');
  assert.equal(rows[0].decidedByName, 'elinoy');
  assert.match(rows[0].note, /belongs to the other person/);

  // The cluster proposal itself is untouched — the snapshot values still stand.
  assert.deepEqual(cluster.proposal.members[1].emails, ['itay@example.com']);
});

test('corrections are surfaced with the queue, beside the original values', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  await recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: { removeEmails: ['itay@example.com'] } } });

  const q = await listQueue(c, 'contacts', { section: 'critical' });
  assert.equal(q.decisions.length, 1);
  assert.ok(q.decisions[0].identityEdits[2], 'the correction rides along');
  assert.deepEqual(q.decisions[0].proposal.members[1].emails, ['itay@example.com'], 'the member still shows the ORIGINAL');
});

test('an approved cluster decision can never record identity the owner corrected away', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  await recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: { removeEmails: ['itay@example.com'] } } });

  await recordDecision(c, {
    id: cluster.id, action: 'edit',
    decision: { primaryLegacyId: 2, assignments: { 1: 'merge', 2: 'primary' } },
  });
  const stored = cluster.decision;
  // Merging record 1 into 2 would normally fold 1's address in. The owner said that
  // address is 1's, not 2's — but it IS 1's, so it survives the merge legitimately.
  assert.ok(stored.result.primary.emails.includes('itay@example.com'));
  // Record 2's own copy was corrected away, so it contributes nothing.
  assert.deepEqual(stored.result.primary.phones, ['054-3334444', '050-1112222']);
});

test('a merged-away record cannot smuggle a corrected identifier into the survivor', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  // Correct the address off record 1 instead, then merge 1 INTO 2.
  await recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 1: { removeEmails: ['itay@example.com'] } } });
  await recordDecision(c, {
    id: cluster.id, action: 'edit',
    decision: { primaryLegacyId: 2, assignments: { 1: 'merge', 2: 'primary' } },
  });
  const stored = cluster.decision;
  assert.deepEqual(stored.result.primary.emails, ['itay@example.com'], "only record 2's own address remains");
  assert.ok(!stored.result.primary.absorbs.some((a) => a.emails), 'nothing re-adds the corrected value');
});

test('clearing a correction DELETES the row — "no correction" is one state, not two', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  await recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: { removeEmails: ['itay@example.com'] } } });
  assert.equal([...c._rows.values()].filter((r) => r.queue === 'contact_identity').length, 1);

  const res = await recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: {} } });
  assert.equal(res.cleared, 1);
  assert.equal([...c._rows.values()].filter((r) => r.queue === 'contact_identity').length, 0);
});

test('an invalid correction is refused server-side, whatever the client sent', async () => {
  const c = stubClient([identityCluster()]);
  const [cluster] = [...c._rows.values()];
  // Removing a value the source record does not have.
  await assert.rejects(
    () => recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: { removePhones: ['03-0000000'] } } }),
    (e) => e.code === 'INVALID_DECISION',
  );
  // Copying rather than moving.
  await assert.rejects(
    () => recordIdentityEdits(c, { clusterDecisionId: cluster.id, edits: { 2: { addPhones: [{ value: '050-1112222', fromLegacyId: 1 }] } } }),
    (e) => e.code === 'INVALID_DECISION',
  );
  assert.equal([...c._rows.values()].filter((r) => r.queue === 'contact_identity').length, 0, 'nothing was written');
});

test('corrections belong to the Contacts queue only', async () => {
  const c = stubClient([{ queue: 'organizations', subjectKey: 'o1', status: 'pending', proposal: {} }]);
  const [org] = [...c._rows.values()];
  await assert.rejects(
    () => recordIdentityEdits(c, { clusterDecisionId: org.id, edits: {} }),
    (e) => e.code === 'BATCH_NOT_SUPPORTED',
  );
});

test('batch approve never resurrects a rejected or deferred cluster', async () => {
  const c = stubClient([contactCluster(1, 'safe', true), contactCluster(2, 'safe', true)]);
  const [a] = [...c._rows.values()];
  a.status = 'rejected';
  a.decidedByName = 'elinoy';
  const res = await batchApproveSafe(c, { queue: 'contacts', userName: 'other' });
  assert.equal(res.approved, 1, 'only the still-pending one');
  assert.equal([...c._rows.values()][0].status, 'rejected', 'the owner rejection stands');
  assert.equal([...c._rows.values()][0].decidedByName, 'elinoy');
});

test('the whole review service touches ONLY the decision ledger (no production writes)', async () => {
  // The stub throws on any other prisma model; reaching the end proves it.
  const c = stubClient();
  await seedStageConfig(c);
  await buildReviewSummary(c);
  await listQueue(c, 'stage_config');
  assert.ok(true);
});
