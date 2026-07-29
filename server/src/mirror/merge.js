// THE 3-way merge engine for the one-way legacy mirror.
//
// Every field decision in the mirror comes through here. There is deliberately
// no second merge implementation anywhere — this is the generalisation of the
// algorithm already proven in the cutover importer (planDealDelta), lifted so
// that the mirror, the delta and any future reconciler all agree by construction.
//
// The three inputs (ownership map §6.1):
//   base   — the value at the last successful sync (LegacyRecord.syncBaseline)
//   source — the value now in Pipedrive/Airtable
//   gos    — the value now in GOS
//
// A 2-way merge (source vs gos) cannot tell "GOS was edited" from "the source
// was edited", so it must either clobber humans or refuse everything. The
// baseline is the entire reason Law 3 — never silently overwrite a human — is
// implementable rather than aspirational.
//
// The decision table (§6.2), exhaustively:
//
//   base vs source | base vs gos                | action
//   ---------------|----------------------------|---------------------------
//   equal          | anything                   | NOOP      (source unchanged)
//   changed        | equal                      | MERGE     (GOS untouched)
//   changed        | changed, gos == source      | CONVERGED (both moved alike)
//   changed        | changed, gos != source      | CONFLICT  (write nothing)
//
// A CONFLICT leaves BOTH systems exactly as they were and does NOT advance the
// baseline, so the next sync re-raises it until a human decides. That is
// intentional: a conflict that quietly disappears is worse than one that nags.

import { CLASS, MERGE, fieldOwnership } from './ownership.js';

export const ACTION = Object.freeze({
  NOOP: 'noop',
  MERGE: 'merge',
  CONVERGED: 'converged',
  CONFLICT: 'conflict',
  SKIPPED: 'skipped',       // the mirror is not allowed to write this field
  BLOCKED: 'blocked',       // a guard revoked legacy ownership at runtime
  BOOTSTRAP: 'bootstrap',   // first contact: adopt a baseline, write nothing
});

/**
 * Value equality for merge purposes.
 *
 * Dates compare by instant, not by object identity or by string form — a
 * Date and its ISO string are the same value here, because the source, the
 * baseline (JSON) and the database column will each hand us a different one of
 * those for the same moment. Getting this wrong produces an endless false
 * conflict on every timestamp field, which is the classic way a mirror becomes
 * unusable noise.
 */
export function sameValue(a, b) {
  if (a === b) return true;
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull || bNull) return aNull && bNull;

  const aDate = a instanceof Date;
  const bDate = b instanceof Date;
  if (aDate || bDate) {
    const at = aDate ? a.getTime() : Date.parse(a);
    const bt = bDate ? b.getTime() : Date.parse(b);
    if (!Number.isNaN(at) && !Number.isNaN(bt)) return at === bt;
  }

  // BigInt money columns arrive as BigInt, string or number depending on path.
  if (typeof a === 'bigint' || typeof b === 'bigint') return String(a) === String(b);
  if (typeof a === 'number' || typeof b === 'number') {
    const an = Number(a); const bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an === bn;
  }
  return String(a) === String(b);
}

/**
 * Decide ONE field. Pure — no I/O, no database, no clock.
 *
 * `guards` maps a guard name declared in the ownership map to a boolean that
 * the caller has already evaluated (e.g. gosOwnsCommercials). A true guard
 * REVOKES legacy ownership for that field on this record.
 */
export function mergeField({ entity, field, base, source, gos, guards = {} }) {
  const own = fieldOwnership(entity, field);

  // Undeclared, or declared as anything the mirror may not write.
  if (!own) return { action: ACTION.SKIPPED, reason: 'not_declared' };
  if (own.merge === MERGE.NEVER || own.cls !== CLASS.LEGACY) {
    return { action: ACTION.SKIPPED, reason: `class_${own.cls}` };
  }
  if (own.guard && guards[own.guard]) {
    return { action: ACTION.BLOCKED, reason: own.guard };
  }

  // Write-once fields never change after they are set.
  if (own.merge === MERGE.IMMUTABLE) {
    const unset = gos === null || gos === undefined || gos === '';
    if (unset) {
      return sameValue(source, gos)
        ? { action: ACTION.NOOP }
        : { action: ACTION.MERGE, value: source };
    }
    return sameValue(source, gos)
      ? { action: ACTION.NOOP }
      : { action: ACTION.CONFLICT, base, source, gos, reason: 'immutable_field_differs' };
  }

  // Latest-wins never conflicts — that is what "latest" means.
  if (own.merge === MERGE.LATEST_WINS) {
    if (source === null || source === undefined || source === '') return { action: ACTION.NOOP };
    return sameValue(source, gos) ? { action: ACTION.NOOP } : { action: ACTION.MERGE, value: source };
  }

  // Append-only collections are reconciled by their own routine, not here.
  if (own.merge === MERGE.APPEND_ONLY) {
    return { action: ACTION.SKIPPED, reason: 'append_only_handled_separately' };
  }

  // ── the 3-way decision table ────────────────────────────────────────────────
  if (sameValue(base, source)) return { action: ACTION.NOOP, reason: 'source_unchanged' };
  if (sameValue(base, gos)) return { action: ACTION.MERGE, value: source };
  if (sameValue(gos, source)) return { action: ACTION.CONVERGED, value: source };
  return { action: ACTION.CONFLICT, base, source, gos, reason: 'both_changed' };
}

/**
 * Decide a whole record. Returns:
 *   set        — the fields to write
 *   conflicts  — fields to surface for a human (nothing is written for these)
 *   advance    — the fields whose baseline may move (merged AND converged)
 *   skipped    — fields the mirror is not permitted to touch, with reasons
 *
 * `advance` deliberately includes CONVERGED: both systems already agree, so the
 * baseline must catch up or the field would be re-evaluated forever. It
 * deliberately EXCLUDES conflicts, which is what makes a conflict re-raise on
 * the next sync until it is resolved.
 */
export function mergeRecord({ entity, base = {}, source = {}, gos = {}, guards = {}, fields = null }) {
  const candidates = fields || Object.keys(source);

  // ── Bootstrap: the record has never been synced ─────────────────────────────
  // With no baseline the engine cannot distinguish "a human edited GOS" from
  // "the record was imported and has since drifted", so a 3-way merge would
  // declare a CONFLICT on every differing field — a storm of tens of thousands
  // of conflicts the first time the mirror runs, which is indistinguishable
  // from noise and would get ignored.
  //
  // First contact therefore ADOPTS a baseline and writes NOTHING. GOS is left
  // exactly as it is, legacy is left exactly as it is, and from the next sync
  // onward every real source change merges correctly. Fields that already
  // differ are reported as `drift` — visible, but not dressed up as conflicts
  // caused by an edit nobody made.
  if (base === null || base === undefined) {
    const advance = {};
    const drift = [];
    for (const field of candidates) {
      const own = fieldOwnership(entity, field);
      if (!own || own.cls !== CLASS.LEGACY || own.merge === MERGE.NEVER || own.merge === MERGE.APPEND_ONLY) continue;
      advance[field] = source?.[field];
      if (!sameValue(source?.[field], gos?.[field])) {
        drift.push({ field, source: source?.[field] ?? null, gos: gos?.[field] ?? null });
      }
    }
    return { set: {}, conflicts: [], advance, skipped: [], drift, bootstrapped: true, hasWork: false };
  }

  const set = {};
  const conflicts = [];
  const advance = {};
  const skipped = [];

  for (const field of candidates) {
    const r = mergeField({ entity, field, base: base?.[field], source: source?.[field], gos: gos?.[field], guards });
    switch (r.action) {
      case ACTION.MERGE:
        set[field] = r.value;
        advance[field] = source?.[field];
        break;
      case ACTION.CONVERGED:
        advance[field] = source?.[field];
        break;
      case ACTION.CONFLICT:
        conflicts.push({ field, base: r.base ?? null, source: r.source ?? null, gos: r.gos ?? null, reason: r.reason });
        break;
      case ACTION.SKIPPED:
      case ACTION.BLOCKED:
        skipped.push({ field, action: r.action, reason: r.reason });
        break;
      default:
        break; // NOOP
    }
  }

  return {
    set,
    conflicts,
    advance,
    skipped,
    drift: [],
    bootstrapped: false,
    hasWork: Object.keys(set).length > 0 || conflicts.length > 0,
  };
}

/**
 * Append-only channel reconciliation (phones/emails).
 *
 * Adds what the source has and GOS does not. NEVER reformats, re-primaries or
 * removes an existing channel: a number the office already uses must not change
 * shape because a sync ran. Returns only the values to ADD.
 *
 * `isSame` is injected so this reuses the caller's canonical comparison
 * (normalizePhoneIntl for phones, lowercase for emails) instead of inventing a
 * second notion of "same number".
 */
export function reconcileAppendOnly({ current = [], incoming = [], isSame }) {
  const add = [];
  for (const value of incoming) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    if (current.some((c) => isSame(c, value))) continue;
    if (add.some((c) => isSame(c, value))) continue;
    add.push(value);
  }
  return { add, removed: [] }; // removed is always empty, by contract
}
