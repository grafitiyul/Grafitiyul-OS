import { prisma } from '../db.js';

// Lifecycle service for OperationalIssue — the ONE way any subsystem reports
// an operational problem. Two writers exist:
//   * inline call sites (a subsystem that KNOWS it just hit a problem, e.g.
//     the gallery cleanup gate) call raiseIssue directly;
//   * detectors (server/src/control/detectors/) re-derive problems from live
//     domain state on the sweep tick and raise/auto-resolve.
// Every function takes the prisma client (or tx) first so raising an issue
// can commit atomically with the state change that caused it.

export const ACTIVE_STATUSES = ['open', 'acknowledged'];

// Raise (or refresh) the single active issue for a dedupeKey. A resolved
// issue that recurs becomes a NEW row — the lifecycle history stays honest.
// Re-raising an acknowledged issue does NOT flip it back to open (the
// operator already saw it); it only refreshes lastSeenAt + payload.
export async function raiseIssue(
  client,
  { type, severity, sourceModule, dedupeKey, title, explanation, entityRefs, data },
) {
  const db = client || prisma;
  const existing = await db.operationalIssue.findFirst({
    where: { dedupeKey, status: { in: ACTIVE_STATUSES } },
    orderBy: { detectedAt: 'desc' },
  });
  if (existing) {
    return db.operationalIssue.update({
      where: { id: existing.id },
      data: {
        severity,
        title,
        explanation,
        entityRefs: entityRefs ?? existing.entityRefs,
        data: data ?? existing.data ?? undefined,
        lastSeenAt: new Date(),
      },
    });
  }
  return db.operationalIssue.create({
    data: {
      type,
      severity,
      sourceModule,
      dedupeKey,
      title,
      explanation,
      entityRefs: entityRefs ?? [],
      data: data ?? undefined,
    },
  });
}

// Resolve the active issue for a dedupeKey (or a specific id). resolvedBy is
// the acting admin; null means the detector observed the condition is gone.
export async function resolveIssue(
  client,
  { id, dedupeKey, resolution, resolvedBy = null, resolvedByName = null },
) {
  const db = client || prisma;
  const where = id
    ? { id, status: { in: ACTIVE_STATUSES } }
    : { dedupeKey, status: { in: ACTIVE_STATUSES } };
  const res = await db.operationalIssue.updateMany({
    where,
    data: {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy,
      resolvedByName,
      resolution: resolution || (resolvedBy ? null : 'auto'),
    },
  });
  return res.count;
}

// Auto-resolve every ACTIVE issue of a type whose dedupeKey is NOT in the
// still-present set — the detectors' "the problem disappeared" sweep.
export async function resolveMissing(client, type, presentDedupeKeys) {
  const db = client || prisma;
  const res = await db.operationalIssue.updateMany({
    where: {
      type,
      status: { in: ACTIVE_STATUSES },
      dedupeKey: { notIn: [...presentDedupeKeys] },
    },
    data: { status: 'resolved', resolvedAt: new Date(), resolution: 'auto' },
  });
  return res.count;
}
