// Phase C — replay the buffered window.
//
// Between "capture started" and "cutover import finished" every source change
// was persisted as a MirrorEvent but deliberately NOT applied. This drains that
// buffer in source order, with apply explicitly permitted for this operation
// only — the global apply switch stays off until Phase D.
//
// Ordering: `receivedAt` ascending. It matters where a field carries a
// transition (a deal moving open → won → lost), and it is harmless where it
// does not, because each step is a 3-way merge against the evolving baseline.
//
// Correctness properties, all consequences of the merge algebra rather than of
// bookkeeping (see seedBaseline.js):
//
//   * an event that predates the snapshot is a NOOP (base = source)
//   * replaying the same event twice is indistinguishable from once
//   * a partially-completed replay resumes correctly — processed events are
//     recognised and skipped

import { processEvent } from './pipeline.js';

/**
 * Replay pending events. `allowApply: true` is passed explicitly so this
 * operation can write while the global switch is still off; nothing else in the
 * system does that.
 */
export async function replayBufferedWindow(db, adapterFactory, {
  system = null, entity = null, limit = 100_000, dryRun = false, onProgress = () => {},
} = {}) {
  const where = { status: 'pending' };
  if (system) where.system = system;
  if (entity) where.entity = entity;

  const events = await db.mirrorEvent.findMany({
    where,
    orderBy: { receivedAt: 'asc' },
    take: limit,
    // Full rows: the factory needs rawPayload to tell an Airtable master-tour
    // event from a child-table one — they share entity 'tourEvent' by design.
  });

  const stats = {
    total: events.length,
    applied: 0, created: 0, converged: 0, noop: 0, conflicts: 0,
    bootstrapped: 0, notCrosswalked: 0, sourceDeleted: 0, skipped: 0, failed: 0,
    deferred: 0, deferredReasons: {},
    byEntity: {},
  };
  const conflicts = [];

  if (dryRun) return { ...stats, dryRun: true, conflicts };

  let i = 0;
  for (const ev of events) {
    const adapter = adapterFactory(ev.system, ev.entity, ev);
    if (!adapter) {
      // No adapter is a DEFERRAL, not a skip: the event stays pending and is
      // counted so the completion report can name what remains and why.
      stats.deferred += 1;
      stats.deferredReasons.no_adapter = (stats.deferredReasons.no_adapter || 0) + 1;
      continue;
    }

    const res = await processEvent(db, ev.id, adapter, { allowApply: true });
    const key = `${ev.system}:${ev.entity}`;
    stats.byEntity[key] = stats.byEntity[key] || { applied: 0, conflicts: 0, noop: 0 };

    switch (res.outcome) {
      case 'merged': stats.applied += 1; stats.byEntity[key].applied += 1; break;
      case 'created': stats.created += 1; stats.byEntity[key].applied += 1; break;
      case 'recomputed': stats.applied += 1; stats.byEntity[key].applied += 1; break;
      case 'converged': stats.converged += 1; break;
      case 'noop': stats.noop += 1; stats.byEntity[key].noop += 1; break;
      case 'conflict':
        stats.conflicts += 1; stats.byEntity[key].conflicts += 1;
        conflicts.push({ system: ev.system, entity: ev.entity, externalId: ev.externalId, fields: res.conflicts?.map((c) => c.field) });
        break;
      case 'bootstrapped': stats.bootstrapped += 1; break;
      case 'not_crosswalked': stats.notCrosswalked += 1; break;
      case 'source_deleted': stats.sourceDeleted += 1; break;
      default:
        if (res.status === 'pending') {
          // Deferred by the pipeline (awaiting creation support / declined with a
          // reason / unresolvable parent). Still pending, still measurable.
          stats.deferred += 1;
          const why = res.reason || (res.awaitingSupport ? 'awaiting_creation_support' : 'deferred');
          stats.deferredReasons[why] = (stats.deferredReasons[why] || 0) + 1;
        } else if (res.status === 'skipped') stats.skipped += 1;
        else if (res.status !== 'processed') stats.failed += 1;
    }
    if (++i % 200 === 0) onProgress({ done: i, total: events.length });
  }

  return { ...stats, conflicts };
}

/**
 * Prove there is no blind window, mechanically.
 *
 * A blind window exists if capture began AFTER the snapshot was taken: changes
 * in between were neither imported nor buffered, and nothing downstream can
 * detect that. This is the check that makes "zero blind window" a measured
 * claim rather than an intention.
 */
export async function verifyNoBlindWindow(db, { snapshotTakenAt, systems = ['pipedrive', 'airtable'] }) {
  const findings = [];
  for (const system of systems) {
    const first = await db.mirrorEvent.findFirst({
      where: { system },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    });
    if (!first) {
      findings.push({ system, ok: false, problem: 'no_capture', detail: 'no events captured at all — this source has no live capture' });
      continue;
    }
    const captureStarted = new Date(first.receivedAt);
    const snap = new Date(snapshotTakenAt);
    const ok = captureStarted <= snap;
    findings.push({
      system,
      ok,
      captureStartedAt: captureStarted.toISOString(),
      snapshotTakenAt: snap.toISOString(),
      problem: ok ? null : 'blind_window',
      detail: ok
        ? `capture began ${Math.round((snap - captureStarted) / 60000)} min before the snapshot`
        : `capture began ${Math.round((captureStarted - snap) / 60000)} min AFTER the snapshot — changes in that gap are lost`,
    });
  }
  return { ok: findings.every((f) => f.ok), findings };
}

/** Nothing may remain unapplied when apply goes live. */
export async function replayResidue(db) {
  const pending = await db.mirrorEvent.count({ where: { status: 'pending' } });
  const dead = await db.mirrorEvent.count({ where: { status: 'dead' } });
  return { pending, dead, clean: pending === 0 && dead === 0 };
}
