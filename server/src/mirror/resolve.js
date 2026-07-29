// Conflict resolution — the operator's three choices.
//
// The critical property: resolving a conflict must do TWO things atomically.
//
//   1. resolve the OperationalIssue, and
//   2. advance the sync baseline for the fields it covered.
//
// Doing only (1) makes the conflict re-raise on the next sync — the operator
// clicks, it vanishes, it comes back, and they stop trusting the screen.
// Doing only (2) hides a decision nobody made. Both halves belong to one
// operator action, which is why they live in one function here rather than
// being left to whoever wires the button.
//
// Whatever the choice, the BASELINE MOVES TO THE SOURCE VALUE. That is what
// "we have now reconciled with the source" means:
//   accept_legacy — write the source value into GOS, baseline := source
//   keep_gos      — write nothing, baseline := source (we have SEEN it and
//                   decided GOS is right; a future source change re-conflicts)
//
// keep_gos is the subtle one. Setting the baseline to the source value is
// exactly right: if the source later changes AGAIN, base != source and GOS
// still differs, so a NEW conflict is raised — which is correct, because that
// is genuinely new information.

import { advanceBaseline, readBaseline } from './baseline.js';
import { resolveSyncConflict } from './conflicts.js';
import { isMirrorWritable } from './ownership.js';

export const CHOICES = Object.freeze(['accept_legacy', 'keep_gos']);

/**
 * @param apply  async (db, entityId, set) => void  — the same applyGos the
 *               adapter uses, so resolution and sync write through one path.
 */
export async function resolveConflict(db, {
  issue, choice, apply, sourceType, resolvedBy = null, resolvedByName = null,
}) {
  if (!CHOICES.includes(choice)) {
    const e = new Error(`unknown_choice: ${choice}`);
    e.code = 'UNKNOWN_CHOICE';
    throw e;
  }
  const data = issue?.data || {};
  const { system, entity, entityId } = data;
  const fields = data.fields || [];
  if (!system || !entity || !entityId) {
    const e = new Error('malformed_conflict_issue: missing system/entity/entityId');
    e.code = 'MALFORMED_ISSUE';
    throw e;
  }

  // The conflict card stores DISPLAY values. The raw values needed to write and
  // to advance the baseline come from the MirrorEvent that raised it — display
  // strings ("5,310 ₪") must never be written back into a money column.
  const event = await db.mirrorEvent.findFirst({
    where: { gosEntityType: entity, gosEntityId: entityId, outcome: 'conflict' },
    orderBy: { processedAt: 'desc' },
    select: { conflicts: true, externalId: true },
  });
  if (!event?.conflicts?.length) {
    const e = new Error('no_conflict_event: cannot resolve without the raw source values');
    e.code = 'NO_CONFLICT_EVENT';
    throw e;
  }

  const raw = event.conflicts.filter((c) => isMirrorWritable(entity, c.field));
  const set = {};
  const advance = {};
  for (const c of raw) {
    advance[c.field] = c.source;
    if (choice === 'accept_legacy') set[c.field] = c.source;
  }

  if (choice === 'accept_legacy' && Object.keys(set).length) {
    await apply(db, entityId, set);
  }

  const key = { sourceSystem: system, sourceType, sourceId: event.externalId };
  const link = await readBaseline(db, key);
  if (link) await advanceBaseline(db, key, advance);

  await resolveSyncConflict(db, {
    id: issue.id,
    choice,
    resolvedBy,
    resolvedByName,
  });

  return {
    choice,
    entity,
    entityId,
    fieldsWritten: Object.keys(set),
    baselineAdvanced: Object.keys(advance),
    skipped: (event.conflicts || []).filter((c) => !isMirrorWritable(entity, c.field)).map((c) => c.field),
  };
}
