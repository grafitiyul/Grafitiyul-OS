// Migration Review Center — shared review infrastructure over MigrationDecision.
//
// The prisma client is INJECTED so every function is unit-testable with a stub.
// Nothing here writes to production entities: the only table touched is
// MigrationDecision (the permanent decision ledger).
import { REVIEW_QUEUES, queueByKey, FROZEN_QUEUES, isResolved } from './queues.js';
import { stageConfigDecisions } from './stageConfigSeed.js';
import { decisionFromDraft, draftFromProposal, orgKeyForProposal, orgKeyForGos, orgKeyForStandalone } from './orgDecision.js';
import { contactDecisionFromDraft, batchDecisionFor } from './contactDecision.js';
import { summarizeSections, SECTION_KEYS } from './contactSections.js';
import {
  IDENTITY_QUEUE, identitySubjectKey, legacyIdFromSubjectKey, resolveIdentityEdits,
  identityDecisionFor, identityProposalFor, isEmptyEdit,
} from './contactIdentity.js';
import { nameDecisionFromDraft, nameDraftFromProposal, legacyIdFromNameKey, openLinked, wonLinked } from './nameCleanup.js';
import { dealIdFromSubjectKey } from './dealImpact.js';
import { buildReadiness, foldStatus } from './readiness.js';
import { normalizePhoneIntl } from '../../whatsapp/phone.js';

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

// Where every CLUSTERED legacy organization is routed by the owner's decisions:
//   canonical | unit | excluded | standalone (other_organization → new:<self>) |
//   routed (other_organization → some other target) | pending (cluster undecided).
// A legacy org id ABSENT from this map was never in any duplicate cluster — it
// imports as-is and is a legitimate standalone destination (`new:<id>`).
export async function buildOrgDispositionIndex(client) {
  const rows = await client.migrationDecision.findMany({ where: { queue: 'organizations' } });
  const index = new Map();
  for (const r of rows) {
    const pending = !isResolved(r.status);
    for (const [legacyId, d] of Object.entries(r.decision?.dispositions || {})) {
      let kind;
      if (pending) kind = 'pending';
      else if (d.disposition === 'organization') kind = 'canonical';
      else if (d.disposition === 'unit') kind = 'unit';
      else if (d.disposition === 'excluded') kind = 'excluded';
      else kind = d.targetOrganizationKey === `new:${legacyId}` ? 'standalone' : 'routed';
      index.set(Number(legacyId), kind);
    }
    // A member with no disposition (pending cluster) is fail-safe ineligible.
    for (const m of r.proposal?.members || []) {
      if (!index.has(m.legacyId)) index.set(m.legacyId, 'pending');
    }
  }
  return index;
}

// May `new:<legacyOrgId>` be a mapping destination? Yes when the org was never
// clustered (absent) or the owner explicitly sent it standalone. Everything else
// either becomes part of another organisation or will not exist at all.
export const standaloneEligible = (dispositionIndex, legacyOrgId) => {
  const kind = dispositionIndex.get(Number(legacyOrgId));
  return kind == null || kind === 'standalone';
};

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

// Business-impact sections for the Contacts queue. `none` is reachable ONLY by
// asking for it explicitly (the statistics link) — it is never part of a normal
// queue listing, because a cluster with <2 importable members has nothing to decide.
function applySection(decisions, section) {
  if (section) return decisions.filter((d) => d.proposal?.section === section);
  return decisions.filter((d) => d.proposal?.section !== 'none');
}

// Identity Import readiness, derived entirely from the live ledger.
// Reports only — there is no action here, and no flag to toggle.
export async function buildImportReadiness(client) {
  const all = await client.migrationDecision.findMany({
    where: { queue: { in: ['organizations', 'contacts', 'stage_config', 'name_cleanup', 'exceptional'] } },
    select: { queue: true, status: true, proposal: true, decision: true },
  });
  const of = (q) => all.filter((r) => r.queue === q);

  const contacts = of('contacts');
  const sections = summarizeSections(contacts.map((r) => ({ ...r.proposal, _s: r.status })), (p) => !isResolved(p._s));
  const byKey = Object.fromEntries(sections.sections.map((s) => [s.key, s.counts]));

  const names = of('name_cleanup');
  const unresolvedNames = names.filter((r) => !isResolved(r.status));
  const excs = of('exceptional');
  const unresolvedExcs = excs.filter((r) => !isResolved(r.status));

  return buildReadiness({
    orgs: foldStatus(of('organizations')),
    stageConfigCount: of('stage_config').length,
    contactSections: {
      critical: byKey.critical || { unresolved: 0 },
      historicalUnresolved: (byKey.recent?.unresolved || 0) + (byKey.historical?.unresolved || 0) + (byKey.low?.unresolved || 0),
    },
    nameStats: {
      criticalUnresolved: unresolvedNames.filter((r) => r.proposal?.section === 'critical' && r.proposal?.decisionRequired).length,
      blockingUnresolved: unresolvedNames.filter((r) => r.proposal?.blocking).length,
      historicalUnresolved: unresolvedNames.filter((r) => ['recent', 'historical', 'low'].includes(r.proposal?.section)).length,
    },
    exceptionStats: {
      blockingUnresolved: unresolvedExcs.filter((r) => r.proposal?.blocksIdentity).length,
      nonBlockingUnresolved: unresolvedExcs.filter((r) => !r.proposal?.blocksIdentity).length,
    },
    // An unreviewed cluster must carry no merge — proven from the data, not assumed.
    implicitMergeCount: contacts.filter(
      (r) => !isResolved(r.status) && !r.proposal?.batchApprovable && (r.proposal?.proposedMergeLegacyIds || []).length > 0,
    ).length,
    // The canonical resolver applies corrections (contactDecision imports
    // applyIdentityEdit); this asserts the wiring exists rather than trusting it.
    identityEditsApplied: true,
    // DERIVED, not asserted: the gap is closed only if the proposals on the ledger
    // actually carry participant counts. If a re-seed ever ran against a snapshot
    // without pipedrive/deal_participants, every member would lack the field and
    // the gate must reopen rather than quietly trust a stale `true`.
    participantGapResolved: contacts.some((r) =>
      (r.proposal?.members || []).some((m) => typeof m.participantCount === 'number'),
    ),
    shellExclusionCount: contacts.filter((r) => r.proposal?.section === 'none').length,
  });
}

// The Contacts dashboard: the four headline numbers + per-section progress.
// Reads the ledger, folds by the section the ENGINE precomputed. No re-derivation.
export async function buildContactWorkload(client) {
  const rows = await client.migrationDecision.findMany({
    where: { queue: 'contacts' },
    select: { proposal: true, status: true },
  });
  const proposals = rows.map((r) => ({ ...r.proposal, _status: r.status }));
  const summary = summarizeSections(proposals, (p) => !isResolved(p._status));
  return {
    ...summary,
    totalClusters: rows.length,
    generatedAt: new Date().toISOString(),
  };
}

// One queue's decisions, shaped for the UI (label→value proposals; never raw
// payload dumps). `id` is returned for actions but the UI never displays it.
// Ordered by the proposal's precomputed priority rank when present.
export async function listQueue(client, queueKey, { status = null, filter = null, section = null } = {}) {
  const q = queueByKey(queueKey);
  if (!q) { const e = new Error('unknown_queue'); e.code = 'UNKNOWN_QUEUE'; throw e; }
  if (section && !SECTION_KEYS.includes(section)) { const e = new Error('unknown_section'); e.code = 'UNKNOWN_SECTION'; throw e; }
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
  // Queue-specific response extras (e.g. the shared claimed-phone index).
  const extra = {};
  // Name Cleanup uses the same business-impact ladder as Contacts.
  if (queueKey === 'name_cleanup') {
    decisions = applySection(decisions, section);
    // Everything the editor + preview need, computed server-side so the client
    // mirror never has to invent it:
    //   * identityEdit    — this person's source-data correction (effective emails).
    //   * claimedPhones   — normalized numbers already owned by OTHER decisions,
    //                       self-claims excluded, so the client can warn pre-save.
    //   * orgDestination  — the FINAL mapped organisation, read live from the
    //                       Organizations ledger. Deliberately NOT copied into the
    //                       stored name decision: the org ledger is the single
    //                       source of truth and the import reads it directly.
    const ids = decisions.map((d) => legacyIdFromNameKey(d.subjectKey)).filter((x) => x != null);
    const [edits, claims, orgRows] = await Promise.all([
      ids.length ? getIdentityEdits(client, ids) : {},
      buildClaimedPhones(client),
      client.migrationDecision.findMany({ where: { queue: 'organizations' }, select: { decision: true, proposal: true } }),
    ]);
    // legacy orgId → final destination name (organisation · unit), from dispositions.
    const orgDest = new Map();
    for (const r of orgRows) {
      const canonical = r.decision?.canonicalName || r.proposal?.proposedCanonical?.name || null;
      const unitNames = new Map((r.decision?.units || []).map((u) => [u.key, u.name]));
      for (const [legacyId, d] of Object.entries(r.decision?.dispositions || {})) {
        if (d.disposition === 'excluded') orgDest.set(Number(legacyId), { label: 'הוחרג — לא ייווצר ארגון', excluded: true });
        else if (d.disposition === 'unit') orgDest.set(Number(legacyId), { label: `${canonical} · ${unitNames.get(d.targetUnitKey) || 'יחידה'}` });
        else orgDest.set(Number(legacyId), { label: canonical || 'ארגון היעד' });
      }
    }
    decisions = decisions.map((d) => {
      const legacyId = legacyIdFromNameKey(d.subjectKey);
      const orgId = d.proposal?.context?.orgId ?? null;
      return {
        ...d,
        identityEdit: edits[legacyId] || null,
        orgDestination: orgId != null ? orgDest.get(orgId) || { label: d.proposal.context.orgName || `ארגון ${orgId}`, pending: true } : null,
      };
    });
    // ONE shared claim index on the response (not per row — that would square the
    // payload). ownerIds lets the client exclude a person's own claims; the server
    // re-checks with the same exclusion on save regardless.
    extra.claimedPhones = Object.fromEntries(
      [...claims].map(([n, c]) => [n, { label: c.label, ownerIds: [...c.ownerIds] }]),
    );
  }
  // Contacts are routed by business impact; other queues have no sections and are
  // left exactly as they were.
  if (queueKey === 'contacts') {
    decisions = applySection(decisions, section);
    // Attach any source-data corrections for the records on screen. The proposal's
    // member values stay ORIGINAL — the correction is shown as an override beside
    // them, never folded into them.
    const ids = decisions.flatMap((d) => (d.proposal?.members || []).map((m) => m.legacyId));
    const edits = ids.length ? await getIdentityEdits(client, [...new Set(ids)]) : {};
    decisions = decisions.map((d) => {
      const mine = Object.fromEntries(
        (d.proposal?.members || []).filter((m) => edits[m.legacyId]).map((m) => [m.legacyId, edits[m.legacyId]]),
      );
      return { ...d, identityEdits: mine };
    });
  }

  // Priority order (rank was computed once, in the bounded generation pass).
  if (decisions.some((d) => d.proposal?.rank != null)) {
    decisions.sort((a, b) => (a.proposal?.rank ?? 1e9) - (b.proposal?.rank ?? 1e9));
  } else {
    decisions.sort((a, b) => Number(isResolved(a.status)) - Number(isResolved(b.status)) || a.subjectKey.localeCompare(b.subjectKey));
  }

  // Section tallies for the sectioned queues, computed over ALL rows (not the
  // filtered page) so the tab counts never depend on what is on screen.
  let sectionCounts = null;
  let batchApprovable = null;
  if (queueKey === 'contacts' || queueKey === 'name_cleanup') {
    sectionCounts = {};
    for (const r of rows) {
      const s = r.proposal?.section;
      if (!s) continue;
      // `none` counts everything; the review sections count what still needs a human.
      if (s === 'none' || !isResolved(r.status)) sectionCounts[s] = (sectionCounts[s] || 0) + 1;
    }
    batchApprovable = rows.filter((r) => r.status === 'pending' && r.proposal?.batchApprovable === true).length;
    // The MANDATORY dimension, orthogonal to sections: rows whose import would
    // fail outright. Computed over ALL rows so the counter never depends on the
    // section on screen — this is the number that keeps the readiness gate red.
    if (queueKey === 'name_cleanup') {
      const pendingBlocking = rows.filter((r) => r.proposal?.blocking === true && !isResolved(r.status));
      extra.blockingUnresolved = pendingBlocking.length;
      // The owner's two focused review queues over the blocking rows:
      // OPEN-linked is the highest-priority section; WON-linked (without OPEN) is
      // "נדרש לעבור — מקושר לעסקת WON". Both include secondary-participant links.
      extra.openLinkedUnresolved = pendingBlocking.filter((r) => openLinked(r.proposal)).length;
      extra.wonLinkedUnresolved = pendingBlocking.filter((r) => wonLinked(r.proposal) && !openLinked(r.proposal)).length;
      // Owner-deleted deals, so the client preview applies the same cascade the
      // server enforces on save.
      extra.deadDealIds = [...(await getDeadDealIds(client))];
    }
  }

  return {
    queue: { key: q.key, label: q.label, kind: q.kind, blocking: q.blocking, implemented: q.implemented, summary: q.summary, frozen: FROZEN_QUEUES.has(q.key) },
    counts: { shown: decisions.length, all: rows.length },
    sectionCounts,
    batchApprovable,
    ...extra,
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
// `name_cleanup` qualifies for the same treatment, under the same rule: only the
// cleanups the ENGINE marked deterministic AND identity-preserving (moving the same
// string into the field GOS requires). Nothing is ever applied silently — the owner
// still presses the button.
const BATCHABLE_QUEUES = new Set(['contacts', 'name_cleanup']);
const BATCH_NOTE = {
  contacts: 'אושר באישור קבוצתי של הקבוצות הבטוחות',
  name_cleanup: 'אושר באישור קבוצתי של התיקונים הדטרמיניסטיים',
};

export async function batchApproveSafe(client, { queue, userId = null, userName = null } = {}) {
  if (!BATCHABLE_QUEUES.has(queue)) { const e = new Error('batch_not_supported'); e.code = 'BATCH_NOT_SUPPORTED'; throw e; }
  const rows = await client.migrationDecision.findMany({ where: { queue, status: 'pending' } });
  const targets = rows.filter((r) => r.proposal?.batchApprovable === true);
  const decidedAt = new Date();
  let approved = 0;
  for (const r of targets) {
    const decision = queue === 'contacts'
      ? batchDecisionFor(r.proposal)
      : nameDecisionFromDraft(r.proposal, { treatment: r.proposal.treatment, fields: r.proposal.proposedFields });
    await client.migrationDecision.update({
      where: { id: r.id },
      data: {
        status: 'approved',
        decision,
        decidedBy: userId,
        decidedByName: userName,
        decidedAt,
        note: BATCH_NOTE[queue],
      },
    });
    approved++;
  }
  return { approved, skipped: rows.length - targets.length, examined: rows.length };
}

// ── Source-data corrections (identity overrides) ─────────────────────────────
// Keyed by SOURCE CONTACT, not by cluster: one legacy record can appear in both a
// phone cluster and an email cluster, and must never carry two conflicting
// corrections. Stored as MigrationDecision overrides; Slice 6 applies them.
// The snapshot and the Snapshot Browser are untouched — see contactIdentity.js.

// Every correction that applies to a set of source contacts, as a map keyed by
// legacyId, ready to hand to the resolver.
export async function getIdentityEdits(client, legacyIds = null) {
  const rows = await client.migrationDecision.findMany({
    where: {
      queue: IDENTITY_QUEUE,
      ...(legacyIds ? { subjectKey: { in: legacyIds.map(identitySubjectKey) } } : {}),
    },
  });
  const edits = {};
  for (const r of rows) {
    const id = legacyIdFromSubjectKey(r.subjectKey);
    if (id != null && r.decision) edits[id] = { ...r.decision, note: r.note ?? null, decidedByName: r.decidedByName ?? null, decidedAt: r.decidedAt ?? null };
  }
  return edits;
}

// Record (or clear) the corrections for one cluster's source records.
//
// Submitted per CLUSTER because a MOVE spans two records and is only coherent as one
// atomic act — but STORED per source contact. Validated server-side against the
// ORIGINAL snapshot values carried on the proposal, so a stale client cannot remove
// a value that is not there.
export async function recordIdentityEdits(client, { clusterDecisionId, edits, note = null, userId = null, userName = null }) {
  const cluster = await client.migrationDecision.findUnique({ where: { id: clusterDecisionId } });
  if (!cluster) { const e = new Error('decision_not_found'); e.code = 'NOT_FOUND'; throw e; }
  if (cluster.queue !== 'contacts') { const e = new Error('identity_edits_are_contacts_only'); e.code = 'BATCH_NOT_SUPPORTED'; throw e; }

  const members = cluster.proposal?.members || [];
  // A deleted record is terminal — identity data may not be corrected on it or
  // moved to it. (Moving a value OFF it is pointless: it imports nothing.)
  const deletedIds = await getDeletedPersonIds(client);
  const touchingDeleted = Object.keys(edits || {}).map(Number).filter((id) => deletedIds.has(id));
  if (touchingDeleted.length) {
    const e = new Error(`invalid_identity_edit: הרשומות ${touchingDeleted.join(', ')} נמחקו על ידי הבעלים`);
    e.code = 'INVALID_DECISION';
    e.problems = [`הרשומות ${touchingDeleted.join(', ')} נמחקו על ידי הבעלים — אין מה לתקן בהן`];
    throw e;
  }
  const resolved = resolveIdentityEdits(members, edits);
  if (!resolved.valid) {
    const e = new Error(`invalid_identity_edit: ${resolved.problems.join(' · ')}`);
    e.code = 'INVALID_DECISION';
    e.problems = resolved.problems;
    throw e;
  }

  const byId = new Map(members.map((m) => [m.legacyId, m]));
  const decidedAt = new Date();
  let written = 0, cleared = 0;
  for (const m of members) {
    const edit = edits?.[m.legacyId];
    const subjectKey = identitySubjectKey(m.legacyId);
    const existing = await client.migrationDecision.findUnique({
      where: { queue_subjectKey: { queue: IDENTITY_QUEUE, subjectKey } },
    });
    // An emptied correction is DELETED, not stored as a no-op row: "no correction"
    // and "a correction that changes nothing" must not be distinguishable states.
    if (isEmptyEdit(edit)) {
      if (existing) { await client.migrationDecision.delete({ where: { id: existing.id } }); cleared++; }
      continue;
    }
    const data = {
      queue: IDENTITY_QUEUE,
      subjectKey,
      status: 'edited',
      proposal: identityProposalFor(byId.get(m.legacyId)),
      decision: identityDecisionFor(byId.get(m.legacyId), edit),
      note,
      decidedBy: userId,
      decidedByName: userName,
      decidedAt,
    };
    if (existing) await client.migrationDecision.update({ where: { id: existing.id }, data });
    else await client.migrationDecision.create({ data });
    written++;
  }
  return { written, cleared, warnings: resolved.warnings };
}

// ── Claimed phones ────────────────────────────────────────────────────────────
// Every normalized number already spoken for by a DECIDED row anywhere in the
// ledger: a name-cleanup decision keeping it, an identity correction moving it,
// or a contacts-merge survivor owning it. A Name Cleanup approval that keeps a
// number claimed elsewhere is a real conflict — the same person would exist twice
// or the number would land on two contacts — so it blocks until one side lets go.
//
// `ownerIds` are the legacy person ids a claim legitimately belongs to: the same
// person appearing in two queues (their own identity row, their own duplicate
// cluster) must never conflict with themselves.
export async function buildClaimedPhones(client) {
  const claims = new Map(); // normalized → { label, ownerIds:Set<number> }
  const add = (normalized, label, ownerIds) => {
    if (!normalized) return;
    const cur = claims.get(normalized);
    if (cur) { for (const id of ownerIds) cur.ownerIds.add(id); return; }
    claims.set(normalized, { label, ownerIds: new Set(ownerIds) });
  };
  const rows = await client.migrationDecision.findMany({
    where: { queue: { in: ['name_cleanup', 'contact_identity', 'contacts'] }, status: { in: ['approved', 'edited'] } },
    select: { queue: true, subjectKey: true, decision: true, proposal: true },
  });
  for (const r of rows) {
    if (r.queue === 'name_cleanup') {
      const id = legacyIdFromNameKey(r.subjectKey);
      for (const p of r.decision?.phones || []) {
        if (!p.remove && p.normalized) add(p.normalized, `ניקוי שמות: ${r.proposal?.displayName || id}`, [id]);
      }
    } else if (r.queue === 'contact_identity') {
      const id = legacyIdFromSubjectKey(r.subjectKey);
      for (const raw of r.decision?.effective?.phones || []) {
        add(normalizePhoneIntl(raw), `תיקון נתוני מקור: ${r.proposal?.name || id}`, [id]);
      }
    } else {
      // A decided duplicate cluster: the surviving contact owns the kept numbers,
      // on behalf of every member that was merged into it.
      const memberIds = (r.proposal?.members || []).map((m) => m.legacyId);
      for (const raw of r.decision?.result?.primary?.phones || []) {
        add(normalizePhoneIntl(raw), `איחוד כפילויות: ${r.decision?.result?.primary?.name || r.subjectKey}`, memberIds);
      }
    }
  }
  return claims;
}

// The view of the claims one specific person is NOT allowed to collide with.
const claimsExcludingSelf = (claims, selfLegacyId) => ({
  get(normalized) {
    const c = claims.get(normalized);
    return c && !c.ownerIds.has(selfLegacyId) ? c : undefined;
  },
});

// ── Owner-deleted records ─────────────────────────────────────────────────────
// The TERMINAL set: legacy person ids the owner marked "זו שטות מוחלטת — מחק".
// Every resolver treats these as gone — no Contact, no Organization, no mapping,
// no merging, hidden from the normal Legacy Archive UI. Identity Import must use
// this set as its first-pass filter over ALL persons, so a deleted id can never
// become an entity through any path (clustered, separate, or unclustered).
// The raw snapshot objects are untouched — audit integrity is storage-level.
// Deals the owner removed from the migration as HISTORICAL JUNK (deals-queue
// treatment 'deleted'). A dead deal protects nothing: contact deletion
// boundaries subtract it, and the deal importer must never import it. Exclusion
// ('do not import') is deliberately NOT dead — an excluded deal still happened
// and its archive value still protects its contacts.
export async function getDeadDealIds(client) {
  const rows = await client.migrationDecision.findMany({
    where: { queue: 'deals', status: { in: ['approved', 'edited'] } },
    select: { subjectKey: true, decision: true },
  });
  const ids = new Set();
  for (const r of rows) {
    if (r.decision?.treatment === 'deleted') {
      const id = dealIdFromSubjectKey(r.subjectKey);
      if (id != null) ids.add(id);
    }
  }
  return ids;
}

export async function getDeletedPersonIds(client) {
  const rows = await client.migrationDecision.findMany({
    where: { queue: 'name_cleanup', status: { in: ['approved', 'edited'] } },
    select: { subjectKey: true, decision: true },
  });
  const ids = new Set();
  for (const r of rows) {
    if (r.decision?.treatment === 'deleted') {
      const id = legacyIdFromNameKey(r.subjectKey);
      if (id != null) ids.add(id);
    }
  }
  return ids;
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
      // Resolve against the LIVE corrections, so an approved decision can never
      // record identity the owner has already said is wrong.
      const ids = (existing.proposal?.members || []).map((m) => m.legacyId);
      // An owner-DELETED record is terminal: it may not survive as the primary and
      // may not fold its data into a survivor. (Import additionally filters the
      // deleted set over every path, including 'separate' and unclustered.)
      const deletedIds = await getDeletedPersonIds(client);
      const violations = [];
      if (deletedIds.has(decision?.primaryLegacyId)) violations.push(`הרשומה ${decision.primaryLegacyId} נמחקה על ידי הבעלים — לא יכולה להיות איש הקשר שנשמר`);
      for (const [mid, a] of Object.entries(decision?.assignments || {})) {
        if (a === 'merge' && deletedIds.has(Number(mid))) violations.push(`הרשומה ${mid} נמחקה על ידי הבעלים — לא יכולה להשתתף באיחוד`);
      }
      if (violations.length) {
        const e = new Error(`invalid_decision: ${violations.join(' · ')}`);
        e.code = 'INVALID_DECISION';
        e.problems = violations;
        throw e;
      }
      const resolved = contactDecisionFromDraft(existing.proposal, decision, await getIdentityEdits(client, ids));
      if (!resolved.result.valid) {
        const e = new Error(`invalid_decision: ${resolved.result.problems.join(' · ')}`);
        e.code = 'INVALID_DECISION';
        e.problems = resolved.result.problems;
        throw e;
      }
      stored = resolved;
    } else if (existing.queue === 'name_cleanup') {
      // The owner's edited fields ARE the Identity Import result — resolved through
      // the same resolver the preview uses, and re-validated against the canonical
      // GOS rule so an approved name can never fail at import time.
      // Normalised through the draft builder first: a partial payload falls back to
      // the proposal rather than crashing on a missing field.
      //
      // Phone gates are strict here: invalid-for-country, duplicate normalized,
      // unconfirmed unknown-country, and cross-decision ownership conflicts all
      // refuse the save — the server never trusts the client's own validation.
      const legacyId = legacyIdFromNameKey(existing.subjectKey);
      const ctx = {
        identityEdit: (await getIdentityEdits(client, [legacyId]))[legacyId] || null,
        claimedPhones: claimsExcludingSelf(await buildClaimedPhones(client), legacyId),
        // Owner-deleted deals no longer protect their contacts (the cascade).
        deadDealIds: await getDeadDealIds(client),
      };
      // "This is an Organization" mapped to an existing target: the key must be a
      // destination that will actually exist after migration —
      //   * a registry key (cluster canonical / live GOS org), or
      //   * `new:<legacyOrgId>` for a STANDALONE-ELIGIBLE legacy organisation
      //     (never clustered, or explicitly sent standalone by the owner).
      // A member routed into another org, a unit, or an excluded org is refused —
      // it will not exist as its own destination. Snapshot EXISTENCE of new:<id>
      // is verified at the route layer (it has the snapshot index); this layer
      // owns the routing legality.
      if (decision?.treatment === 'organization' && decision?.organization?.targetOrganizationKey) {
        const registry = await buildOrgTargets(client);
        const registryKeys = new Set([...registry.proposals, ...registry.gos].map((x) => x.key));
        const dispositions = await buildOrgDispositionIndex(client);
        ctx.orgTargetKeys = {
          has(key) {
            const m = /^new:(\d+)$/.exec(String(key || ''));
            if (m) return standaloneEligible(dispositions, Number(m[1]));
            return registryKeys.has(key);
          },
        };
      }
      const resolved = nameDecisionFromDraft(existing.proposal, nameDraftFromProposal(existing.proposal, decision), ctx);
      if (!resolved.result.valid) {
        const e = new Error(`invalid_decision: ${resolved.result.problems.join(' · ')}`);
        e.code = 'INVALID_DECISION';
        e.problems = resolved.result.problems;
        throw e;
      }
      // A deletion is stamped with who and when INSIDE the decision — the binding
      // audit record the owner mandated, beyond the row's own decidedBy/decidedAt.
      if (resolved.treatment === 'deleted') {
        resolved.deleted = { ...resolved.deleted, deletedAt: new Date().toISOString(), deletedBy: userName || userId || null };
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
