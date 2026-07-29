// Baseline seeding — the step that makes buffered replay mean anything.
//
// THE PROBLEM IT SOLVES
//
// The cutover import writes GOS records from a snapshot, but historically wrote
// no `syncBaseline`. The first mirror event for each record would therefore hit
// BOOTSTRAP, which by design adopts the current source value as the baseline
// and WRITES NOTHING. Every change that happened between the snapshot and the
// mirror going live would be silently accepted as "the way things are":
//
//   * no error
//   * no conflict
//   * no missing-data signal
//   * a mirror that looks perfectly healthy
//
// Seeding the baseline with the SNAPSHOT values closes that hole. Afterwards:
//
//   * an event carrying a post-snapshot change   → base ≠ source → MERGE (applied)
//   * an event carrying the snapshot state       → base = source → NOOP
//
// The second property is what removes the need for timestamp filtering during
// replay: a pre-boundary event is harmless by the merge algebra, not by
// bookkeeping. Clock skew, delivery lag and retries therefore cannot cause a
// double-apply, because applying such an event twice is indistinguishable from
// applying it zero times.
//
// Bootstrap remains correct for records the mirror meets that the import never
// saw — that is genuinely first contact.

import { serializeBaseline } from './baseline.js';
import { writableFields } from './ownership.js';

/**
 * Build the baseline object for one record from its SOURCE-shaped values.
 *
 * Only mirror-writable fields are seeded. Seeding a field the mirror may never
 * write would be meaningless at best, and at worst would imply the mirror had
 * agreed something about a field it does not own.
 */
export function baselineFromSource(entity, sourceFields) {
  const allowed = new Set(writableFields(entity));
  const out = {};
  for (const [k, v] of Object.entries(sourceFields || {})) {
    if (!allowed.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return serializeBaseline(out);
}

/**
 * Seed baselines in bulk for one (system, sourceType).
 *
 * `rows` are `{ sourceId, fields }` — the SOURCE values as of the snapshot, not
 * the GOS values after import. That distinction is the whole point: the
 * baseline records what the SOURCE said, so a later source change is detectable.
 *
 * Idempotent. `overwrite: false` (the default) never disturbs a baseline the
 * live mirror has already advanced — re-running the seeder after the mirror has
 * been running must not rewind it.
 */
export async function seedBaselines(db, { system, sourceType, entity, rows, overwrite = false, batchSize = 500 }) {
  const stats = { considered: 0, seeded: 0, skippedExisting: 0, skippedNoCrosswalk: 0, empty: 0 };

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const ids = batch.map((r) => String(r.sourceId));

    const existing = await db.legacyRecord.findMany({
      where: { sourceSystem: system, sourceType, sourceId: { in: ids } },
      select: { sourceId: true, syncBaseline: true, entityId: true },
    });
    const byId = new Map(existing.map((e) => [e.sourceId, e]));

    for (const row of batch) {
      stats.considered += 1;
      const link = byId.get(String(row.sourceId));
      if (!link || !link.entityId) { stats.skippedNoCrosswalk += 1; continue; }
      if (link.syncBaseline && !overwrite) { stats.skippedExisting += 1; continue; }

      const baseline = baselineFromSource(entity, row.fields);
      if (!Object.keys(baseline).length) { stats.empty += 1; continue; }

      await db.legacyRecord.update({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: system, sourceType, sourceId: String(row.sourceId) } },
        data: { syncBaseline: baseline, lastSyncedAt: new Date() },
      });
      stats.seeded += 1;
    }
  }
  return stats;
}

/**
 * The readiness check the mirror activation gate calls.
 *
 * A crosswalked record with NO baseline is a record whose next mirror event
 * would bootstrap — i.e. a change that would be silently swallowed. This
 * counts them, so "are we safe to enable apply?" is a measured answer.
 */
export async function baselineCoverage(db, { system, sourceType }) {
  const total = await db.legacyRecord.count({
    where: { sourceSystem: system, sourceType, entityId: { not: null } },
  });
  const seeded = await db.legacyRecord.count({
    where: { sourceSystem: system, sourceType, entityId: { not: null }, syncBaseline: { not: null } },
  });
  return {
    system, sourceType, total, seeded,
    missing: total - seeded,
    complete: total === seeded,
    // The honest framing: an unseeded record is one whose next change is lost.
    atRiskOfSilentBootstrap: total - seeded,
  };
}
