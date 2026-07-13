import { resolveIssue } from './issueService.js';

// Part 4 requirement lifecycle. A first-class sub-requirement state machine: the
// parent OperationalIssue closes ONLY when every requirement of its current
// revision is resolved (completed or waived). calendar_sync / woo_sync states are
// DERIVED from the tour's own sync flags; customer_notification from send
// completeness; manual_decision / guide_notification by an explicit operator act.

export const REQUIREMENT_KINDS = [
  'customer_notification',
  'calendar_sync',
  'woo_sync',
  'guide_notification',
  'manual_decision',
];
const RESOLVED = new Set(['completed', 'waived']);

// Which requirement kinds a given impact needs.
export function requirementKindsForImpact(impactType, { hasGuides = false } = {}) {
  if (impactType === 'capacity_below_occupancy') return ['manual_decision'];
  const kinds = ['customer_notification', 'calendar_sync', 'woo_sync'];
  if (hasGuides) kinds.push('guide_notification');
  return kinds;
}

// Create the requirement rows for an issue+revision. Idempotent (unique on
// issue+revision+kind) and never clobbers an already-advanced requirement, so
// repeated reconciliation cannot duplicate or reset them.
export async function ensureRequirements(client, { issueId, revision, kinds }) {
  for (const kind of kinds) {
    await client.issueRequirement.upsert({
      where: { issueId_revision_kind: { issueId, revision, kind } },
      create: { issueId, revision, kind, state: 'pending' },
      update: {},
    });
  }
}

function syncState(status, doneVals, failVals) {
  if (doneVals.includes(status)) return 'completed';
  if (failVals.includes(status)) return 'failed';
  return null; // still in flight
}

// Derive calendar_sync / woo_sync requirement state from the tour's live sync
// flags (they resolve as the calendar/woo workers converge; failures stay OPEN).
export async function syncDerivedRequirements(client, issue) {
  if (!issue?.revision) return;
  const tourEventId = issue.data?.tourEventId;
  if (!tourEventId) return;
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: { wooSyncStatus: true, gcalSyncStatus: true },
  });
  if (!tour) return;
  const derived = {
    woo_sync: syncState(tour.wooSyncStatus, ['synced', 'skipped'], ['failed']),
    calendar_sync: syncState(tour.gcalSyncStatus, ['synced', 'skipped'], ['failed']),
  };
  for (const [kind, state] of Object.entries(derived)) {
    if (!state) continue;
    await client.issueRequirement.updateMany({
      where: { issueId: issue.id, revision: issue.revision, kind, state: { notIn: ['completed', 'waived'] } },
      data: { state, ...(state === 'completed' ? { resolvedAt: new Date(), resolvedByName: 'auto' } : {}) },
    });
  }
}

// Set one requirement's state. Manual completion/waive ALWAYS require a note.
export async function setRequirementState(client, requirementId, state, { note = null, resolvedBy = null, resolvedByName = null, manual = false } = {}) {
  if (manual && (state === 'completed' || state === 'waived') && !String(note || '').trim()) {
    const err = new Error('note_required');
    err.code = 'note_required';
    throw err;
  }
  const data = { state };
  if (note != null) data.note = note;
  if (RESOLVED.has(state)) {
    data.resolvedAt = new Date();
    data.resolvedBy = resolvedBy;
    data.resolvedByName = resolvedByName;
  }
  const req = await client.issueRequirement.update({ where: { id: requirementId }, data });
  await refreshIssueClosure(client, req.issueId);
  return req;
}

// Close the parent issue iff EVERY requirement of its current revision is
// resolved. Never closes merely because the tour was updated (the requirements —
// notably customer_notification — gate it). Returns true if it closed.
export async function refreshIssueClosure(client, issueId) {
  const issue = await client.operationalIssue.findUnique({ where: { id: issueId } });
  if (!issue) return false;
  await syncDerivedRequirements(client, issue);
  const reqs = await client.issueRequirement.findMany({ where: { issueId, revision: issue.revision ?? undefined } });
  if (!reqs.length) return false;
  const allResolved = reqs.every((r) => RESOLVED.has(r.state));
  if (allResolved && ['open', 'acknowledged'].includes(issue.status)) {
    await resolveIssue(client, { id: issueId, resolution: 'requirements_complete', resolvedByName: 'auto' });
    return true;
  }
  return false;
}
