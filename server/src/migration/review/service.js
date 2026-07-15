// Migration Review Center — shared review infrastructure over MigrationDecision.
//
// The prisma client is INJECTED so every function is unit-testable with a stub.
// Nothing here writes to production entities: the only table touched is
// MigrationDecision (the permanent decision ledger).
import { REVIEW_QUEUES, queueByKey, FROZEN_QUEUES, isResolved } from './queues.js';
import { stageConfigDecisions } from './stageConfigSeed.js';
import { decisionFromDraft, draftFromProposal, orgKeyForProposal, orgKeyForGos, orgKeyForStandalone } from './orgDecision.js';
import { contactDecisionFromDraft, batchDecisionFor } from './contactDecision.js';

// Every Organization a source record may be mapped to: the canonical org of each
// migration proposal, plus every live GOS organization (with its real units).
// Standalone `new:<sourceId>` targets need no registry entry — they are created by
// the mapping itself.
export async function buildOrgTargets(client) {
  const rows = await client.migrationDecision.findMany({ where: { queue: 'organizations' } });
  const proposals = rows.map((r) => ({
    key: orgKeyForProposal(r.subjectKey),
    subjectKey: r.subjectKey,
    // The owner's edited name wins over the suggestion, exactly like everywhere else.
    name: r.decision?.canonicalName || r.proposal?.proposedCanonical?.name || r.subjectKey,
    kind: 'proposal',
    status: r.status,
    units: (r.decision?.units ?? r.proposal?.proposedUnits ?? []).map((u) => ({ key: u.key, name: u.name })),
  }));

  const gosRows = await client.organization.findMany({
    select: { id: true, name: true, units: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  const gos = gosRows.map((g) => ({
    key: orgKeyForGos(g.id),
    name: g.name,
    kind: 'gos',
    units: g.units.map((u) => ({ key: u.id, name: u.name })),
  }));

  return { proposals, gos };
}

// Registry shape the resolver validates against.
function targetsIndex({ proposals, gos }, selfKey = null) {
  const orgs = new Map();
  for (const t of [...proposals, ...gos]) {
    orgs.set(t.key, {
      name: t.name,
      units: new Set(t.units.map((u) => u.key)),
      unitNames: new Map(t.units.map((u) => [u.key, u.name])),
    });
  }
  return { orgs, selfKey };
}

// A source row may not be sent to an organization that is not actually created —
// e.g. cluster A points at cluster B while every row of B has been sent elsewhere.
// That is the real "circular / dangling" case, and it is checked against the ledger.
function danglingTargets(draft, registry, ownSubjectKey) {
  const problems = [];
  const byKey = new Map(registry.proposals.map((p) => [p.key, p]));
  for (const [legacyId, d] of Object.entries(draft.dispositions || {})) {
    if (d.disposition !== 'other_organization' || !d.targetOrganizationKey) continue;
    const key = d.targetOrganizationKey;
    if (key.startsWith('new:') || key.startsWith('gos:')) continue;
    const target = byKey.get(key);
    if (!target) { problems.push(`ארגון היעד ${key} לא נמצא`); continue; }
    if (target.subjectKey === ownSubjectKey) { problems.push('לא ניתן למפות רשומה לארגון של אותה קבוצה'); continue; }
    // Does the target cluster actually create its organization?
    const dec = target.decisionRef;
    if (dec && !Object.values(dec.dispositions || {}).some((x) => x.disposition === 'organization')) {
      problems.push(`ארגון היעד "${target.name}" לא ייווצר — אף רשומה בקבוצה שלו לא שויכה אליו`);
    }
  }
  return problems;
}

// Idempotent seeding of the frozen, owner-approved configuration.
// upsert(update: {}) means a re-run NEVER clobbers a recorded decision or its
// audit metadata — repeated seeding is a no-op.
export async function seedStageConfig(client) {
  const rows = stageConfigDecisions();
  const before = await client.migrationDecision.count({ where: { queue: 'stage_config' } });
  for (const r of rows) {
    await client.migrationDecision.upsert({
      where: { queue_subjectKey: { queue: r.queue, subjectKey: r.subjectKey } },
      create: r,
      update: {}, // ← idempotency: existing rows are left exactly as they are
    });
  }
  const after = await client.migrationDecision.count({ where: { queue: 'stage_config' } });
  return { expected: rows.length, created: after - before, existingBefore: before, total: after };
}

// [{queue, status, _count}] → { queue: { status: n } } (Prisma _count may be a
// number or an object).
function foldCounts(groups) {
  const out = {};
  for (const g of groups || []) {
    const n = typeof g._count === 'number' ? g._count : g._count?._all ?? 0;
    out[g.queue] = out[g.queue] || {};
    out[g.queue][g.status] = n;
  }
  return out;
}

// Queue counts + progress + the blocking gate.
export async function buildReviewSummary(client) {
  const groups = await client.migrationDecision.groupBy({ by: ['queue', 'status'], _count: true });
  const byQueue = foldCounts(groups);

  const queues = REVIEW_QUEUES.map((q) => {
    const c = byQueue[q.key] || {};
    const approved = c.approved || 0;
    const rejected = c.rejected || 0;
    const edited = c.edited || 0;
    const deferred = c.deferred || 0;
    const pending = c.pending || 0;
    // Derive from ALL statuses so a new status can never silently vanish from the
    // totals (and `deferred` correctly keeps the gate closed).
    const total = Object.values(c).reduce((n, v) => n + v, 0);
    const unresolved = total - (approved + rejected + edited);
    // Data-driven, not flag-driven: a queue is complete once it actually HAS
    // proposals and none await a human. An unbuilt queue has no proposals, so it
    // is honestly incomplete and the gate stays closed until its slice lands.
    const complete = total > 0 && unresolved === 0;
    return {
      key: q.key, label: q.label, kind: q.kind, blocking: q.blocking,
      implemented: q.implemented, summary: q.summary, frozen: FROZEN_QUEUES.has(q.key),
      counts: { total, unresolved, approved, rejected, edited, deferred, pending },
      complete,
    };
  });

  const blocking = queues.filter((q) => q.blocking);
  const gate = {
    blockingTotal: blocking.length,
    blockingComplete: blocking.filter((q) => q.complete).length,
    // Deliberately no "Finalize import" action yet — this only REPORTS readiness.
    readyToFinalize: blocking.length > 0 && blocking.every((q) => q.complete),
    waitingOn: blocking
      .filter((q) => !q.complete)
      .map((q) => ({ key: q.key, label: q.label, reason: q.counts.total === 0 ? 'טרם נבנה' : 'ממתין להחלטות' })),
  };

  const totals = queues.reduce(
    (acc, q) => ({
      decisions: acc.decisions + q.counts.total,
      unresolved: acc.unresolved + q.counts.unresolved,
      resolved: acc.resolved + q.counts.approved + q.counts.rejected + q.counts.edited,
    }),
    { decisions: 0, unresolved: 0, resolved: 0 },
  );

  return { queues, gate, totals, generatedAt: new Date().toISOString() };
}

// Named filters for the queue UI. Applied in JS over a single bounded fetch
// (a queue is at most a few hundred rows) — no N+1, no JSON-path querying.
const FILTERS = {
  unresolved: (d) => !isResolved(d.status),
  approved: (d) => d.status === 'approved' || d.status === 'edited',
  rejected: (d) => d.status === 'rejected',
  deferred: (d) => d.status === 'deferred',
  safe: (d) => ['safe', 'high'].includes(d.proposal?.confidence),
  active: (d) => d.proposal?.operationallyActive === true,
  gos: (d) => !!d.proposal?.gosMatch,
  top25: (d) => d.proposal?.auditedTop25 === true,
  // Contacts: everything that needs a human, and the individual risk buckets.
  needsReview: (d) => d.proposal?.batchApprovable === false,
  probable: (d) => d.proposal?.confidence === 'probable',
  ambiguous: (d) => d.proposal?.confidence === 'ambiguous',
  shared: (d) => d.proposal?.confidence === 'shared',
};

// One queue's decisions, shaped for the UI (label→value proposals; never raw
// payload dumps). `id` is returned for actions but the UI never displays it.
// Ordered by the proposal's precomputed priority rank when present.
export async function listQueue(client, queueKey, { status = null, filter = null } = {}) {
  const q = queueByKey(queueKey);
  if (!q) { const e = new Error('unknown_queue'); e.code = 'UNKNOWN_QUEUE'; throw e; }
  const rows = await client.migrationDecision.findMany({
    where: { queue: queueKey, ...(status ? { status } : {}) },
    orderBy: [{ subjectKey: 'asc' }],
  });

  let decisions = rows.map((r) => ({
    id: r.id,
    subjectKey: r.subjectKey,
    proposal: r.proposal,
    status: r.status,
    resolved: isResolved(r.status),
    decision: r.decision ?? null,
    note: r.note ?? null,
    // Audit trail — who decided and when.
    decidedByName: r.decidedByName ?? null,
    decidedAt: r.decidedAt ?? null,
  }));

  const fn = filter ? FILTERS[filter] : null;
  if (filter && !fn) { const e = new Error('unknown_filter'); e.code = 'UNKNOWN_FILTER'; throw e; }
  if (fn) decisions = decisions.filter(fn);

  // Priority order (rank was computed once, in the bounded generation pass).
  if (decisions.some((d) => d.proposal?.rank != null)) {
    decisions.sort((a, b) => (a.proposal?.rank ?? 1e9) - (b.proposal?.rank ?? 1e9));
  } else {
    decisions.sort((a, b) => Number(isResolved(a.status)) - Number(isResolved(b.status)) || a.subjectKey.localeCompare(b.subjectKey));
  }

  return {
    queue: { key: q.key, label: q.label, kind: q.kind, blocking: q.blocking, implemented: q.implemented, summary: q.summary, frozen: FROZEN_QUEUES.has(q.key) },
    counts: { shown: decisions.length, all: rows.length },
    decisions,
  };
}

// EXPLICIT batch approval of the deterministically-safe contact clusters.
//
// Deliberately narrow, because a batch action is the easiest place to do damage:
//   * only the `contacts` queue,
//   * only rows still `pending`,
//   * only proposals the ENGINE marked batchApprovable (`safe`) — the flag comes
//     from the evidence, never from the caller,
//   * each row is written with its own resolved decision + full audit trail, so a
//     batch is indistinguishable from the owner approving them one by one.
// It never invents a decision: it stores exactly what the proposal proposed.
export async function batchApproveSafe(client, { queue, userId = null, userName = null } = {}) {
  if (queue !== 'contacts') { const e = new Error('batch_not_supported'); e.code = 'BATCH_NOT_SUPPORTED'; throw e; }
  const rows = await client.migrationDecision.findMany({ where: { queue, status: 'pending' } });
  const targets = rows.filter((r) => r.proposal?.batchApprovable === true);
  const decidedAt = new Date();
  let approved = 0;
  for (const r of targets) {
    await client.migrationDecision.update({
      where: { id: r.id },
      data: {
        status: 'approved',
        decision: batchDecisionFor(r.proposal),
        decidedBy: userId,
        decidedByName: userName,
        decidedAt,
        note: 'אושר באישור קבוצתי של הקבוצות הבטוחות',
      },
    });
    approved++;
  }
  return { approved, skipped: rows.length - targets.length, examined: rows.length };
}

const ACTION_STATUS = { approve: 'approved', reject: 'rejected', edit: 'edited', defer: 'deferred' };

// Record a human decision with its audit trail.
export async function recordDecision(client, { id, action, decision = null, note = null, userId = null, userName = null }) {
  const status = ACTION_STATUS[action];
  if (!status) { const e = new Error('invalid_action'); e.code = 'INVALID_ACTION'; throw e; }
  const existing = await client.migrationDecision.findUnique({ where: { id } });
  if (!existing) { const e = new Error('decision_not_found'); e.code = 'NOT_FOUND'; throw e; }
  // Frozen queues are owner-approved spec — never re-decided through the UI.
  if (FROZEN_QUEUES.has(existing.queue)) {
    const e = new Error('queue_frozen: this configuration is already approved and is read-only');
    e.code = 'QUEUE_FROZEN';
    throw e;
  }

  // Organizations: the owner's edited draft IS the migration result. Resolve it
  // server-side (same resolver the preview uses) and store the resolved shape, so
  // the import consumes the DECISION, never the proposal.
  let stored = decision ?? existing.decision ?? null;

  // Rejecting an Organizations cluster means "these are NOT duplicates" — i.e. every
  // source row becomes its own standalone Organization. That is a real destination,
  // so it is materialised EXPLICITLY: the import must never have to infer intent,
  // and "every source id has exactly one binding disposition" has to hold for
  // rejected clusters too.
  if (existing.queue === 'organizations' && status === 'rejected') {
    const standalone = {
      canonicalName: existing.proposal?.proposedCanonical?.name ?? null,
      organizationTypeId: null,
      mergeIntoGosId: null,
      units: [],
      dispositions: Object.fromEntries(
        (existing.proposal?.members || []).map((m) => [
          m.legacyId,
          { disposition: 'other_organization', targetOrganizationKey: orgKeyForStandalone(m.legacyId), targetUnitKey: null },
        ]),
      ),
    };
    stored = { ...decisionFromDraft(existing.proposal, standalone), rejectedAsSeparate: true };
  }

  if (decision && (status === 'approved' || status === 'edited')) {
    if (existing.queue === 'organizations') {
      // Resolve against the LIVE target registry so cross-cluster mappings are
      // validated for real: the target must exist, a chosen unit must belong to it,
      // and it must not be dangling/self-referential.
      const registry = await buildOrgTargets(client);
      const decRows = await client.migrationDecision.findMany({ where: { queue: 'organizations' }, select: { subjectKey: true, decision: true } });
      const decBySubject = new Map(decRows.map((r) => [r.subjectKey, r.decision]));
      for (const p of registry.proposals) p.decisionRef = decBySubject.get(p.subjectKey) || null;

      const selfKey = orgKeyForProposal(existing.subjectKey);
      const resolved = decisionFromDraft(existing.proposal, decision, targetsIndex(registry, selfKey));
      const cross = danglingTargets(decision, registry, existing.subjectKey);
      const problems = [...resolved.result.problems, ...cross];
      if (problems.length) {
        const e = new Error(`invalid_decision: ${problems.join(' · ')}`);
        e.code = 'INVALID_DECISION';
        e.problems = problems;
        throw e;
      }
      stored = resolved;
    } else if (existing.queue === 'contacts') {
      const resolved = contactDecisionFromDraft(existing.proposal, decision);
      if (!resolved.result.valid) {
        const e = new Error(`invalid_decision: ${resolved.result.problems.join(' · ')}`);
        e.code = 'INVALID_DECISION';
        e.problems = resolved.result.problems;
        throw e;
      }
      stored = resolved;
    }
  }

  return client.migrationDecision.update({
    where: { id },
    data: {
      status,
      decision: stored ?? undefined,
      note: note ?? null,
      decidedBy: userId,
      decidedByName: userName,
      decidedAt: new Date(),
    },
  });
}
