// The sync baseline — "what the source said last time we agreed".
//
// This is the third input the 3-way merge needs, and the reason the mirror can
// tell a human edit apart from a source edit. It lives on the existing
// LegacyRecord crosswalk rather than in a new table, because LegacyRecord is
// already the permanent, per-(system,type,id) record of the link between a
// legacy record and its GOS entity, and it already survives deletion of the
// entity it points at (Law 5).
//
// Baseline lifecycle:
//   * absent           → first contact; the merge BOOTSTRAPS (adopts, writes nothing)
//   * advanced         → after a merge or a convergence, for those fields only
//   * NOT advanced     → for conflicted fields, so the conflict re-raises until
//                        a human resolves it
//
// The baseline is stored per FIELD, not as a whole-record blob, precisely so a
// conflict on one field cannot block baseline progress on the others.

/**
 * Read the stored baseline for a crosswalked record.
 * Returns `null` when the record has never been synced — which the merge engine
 * treats as bootstrap, NOT as "every field differs".
 */
export async function readBaseline(db, { sourceSystem, sourceType, sourceId }) {
  const row = await db.legacyRecord.findUnique({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
    select: { id: true, entityType: true, entityId: true, syncBaseline: true, sourceDeletedAt: true, lastSyncedAt: true },
  });
  if (!row) return null;
  return {
    crosswalkId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    // A row that exists but has never been synced still bootstraps.
    baseline: row.syncBaseline ?? null,
    sourceDeletedAt: row.sourceDeletedAt ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
  };
}

/**
 * Advance the baseline for the given fields only.
 *
 * Merged into the existing baseline rather than replacing it: a conflicted
 * field must keep its OLD baseline value, or the next sync would compare
 * against the very value it refused to accept and the conflict would vanish
 * silently — exactly the failure this design exists to prevent.
 */
export async function advanceBaseline(db, { sourceSystem, sourceType, sourceId }, advance, { syncedAt = new Date() } = {}) {
  if (!advance || Object.keys(advance).length === 0) {
    // Still record that we looked, so "last checked" is honest even on a no-op.
    await db.legacyRecord.update({
      where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
      data: { lastSyncedAt: syncedAt },
    });
    return null;
  }

  const current = await db.legacyRecord.findUnique({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
    select: { syncBaseline: true },
  });
  const merged = { ...(current?.syncBaseline || {}), ...serializeBaseline(advance) };

  await db.legacyRecord.update({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
    data: { syncBaseline: merged, lastSyncedAt: syncedAt },
  });
  return merged;
}

/**
 * JSON-safe baseline values.
 *
 * Dates become ISO strings and BigInt becomes a decimal string, because the
 * baseline round-trips through JSONB. `sameValue` in the merge engine compares
 * dates by instant and money across representations precisely so this
 * conversion cannot manufacture a false conflict on the next run.
 */
export function serializeBaseline(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'bigint') out[k] = v.toString();
    else if (v === undefined) out[k] = null;
    else out[k] = v;
  }
  return out;
}

/**
 * Mark a record as gone from the source.
 *
 * A record that disappears from Pipedrive/Airtable is NEVER deleted in GOS
 * (ownership map §6.7): legacy deletions are frequently accidental, and GOS is
 * now the system of record for operational history — payroll, guide-portal
 * state and quotes all hang off these records. The disappearance is recorded
 * and surfaced; the decision belongs to a human.
 */
export async function markSourceDeleted(db, { sourceSystem, sourceType, sourceId }, { at = new Date() } = {}) {
  return db.legacyRecord.update({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
    data: { sourceDeletedAt: at },
  });
}

/** Undo a deletion mark when the record reappears (an accidental legacy delete). */
export async function clearSourceDeleted(db, { sourceSystem, sourceType, sourceId }) {
  return db.legacyRecord.update({
    where: { sourceSystem_sourceType_sourceId: { sourceSystem, sourceType, sourceId: String(sourceId) } },
    data: { sourceDeletedAt: null },
  });
}
