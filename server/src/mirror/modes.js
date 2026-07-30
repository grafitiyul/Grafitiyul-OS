// THE two canonical synchronization modes.
//
// The mirror pipeline was built around one shape: an event names a record, that
// record has a crosswalk, and its fields are merged. That is `entity_merge`, and
// it fits any source row that is 1:1 with a GOS row.
//
// It does NOT fit a change to a CHILD row whose GOS effect is derived by
// aggregation. An Airtable coordination row is the motivating case — several of
// them collapse into one Booking with summed seats — but the shape is generic
// and nothing here is Airtable-specific:
//
//   * the changed row is not 1:1 with any GOS row
//   * the GOS effect is a SET (rows appear and disappear, not just change)
//   * the correct target is derived from ALL of the parent's children, so the
//     one changed row cannot be applied in isolation
//
// That is `parent_recompute`: resolve the event to its PARENT, recompute the
// parent's derived set from the current children, diff it against GOS, apply the
// difference. Any source with header/detail rows needs it — Pipedrive deal
// products would use the same mode unchanged.
//
// An adapter DECLARES its mode. The pipeline dispatches on the declaration, so
// adding a mode is an engine change and using one is a one-line adapter change.

export const MODE = Object.freeze({
  ENTITY_MERGE: 'entity_merge',
  PARENT_RECOMPUTE: 'parent_recompute',
});

export const MODES = Object.freeze(Object.values(MODE));

/**
 * The mode an adapter requires. Defaults to entity_merge so every existing
 * adapter keeps working without declaring anything — the default is the
 * behaviour that already shipped.
 */
export function modeOf(adapter) {
  const declared = adapter?.mode;
  if (!declared) return MODE.ENTITY_MERGE;
  if (!MODES.includes(declared)) {
    const e = new Error(`unknown_sync_mode: "${declared}" (expected ${MODES.join(' | ')})`);
    e.code = 'UNKNOWN_SYNC_MODE';
    throw e;
  }
  return declared;
}

/**
 * Validate that an adapter actually implements the contract for its mode.
 * Checked once, at dispatch, so a half-written adapter fails with a message
 * naming the missing function instead of a TypeError deep inside a merge.
 */
export function assertAdapterContract(adapter, mode = modeOf(adapter)) {
  const missing = [];
  const need = (name) => { if (typeof adapter?.[name] !== 'function') missing.push(name); };

  if (mode === MODE.ENTITY_MERGE) {
    need('normalize'); need('loadGos'); need('applyGos');
    if (!adapter?.sourceType) missing.push('sourceType');
  } else {
    // parent_recompute: the adapter resolves the parent, derives the desired
    // state, reads the current state, and applies a diff. It never merges
    // fields, so normalize()/applyGos() are not part of this contract.
    need('resolveParent');   // (db, event) -> { sourceId, entityId } | null
    need('derive');          // (db, parent) -> desired set
    need('loadCurrent');     // (db, parent) -> current set
    need('applyDiff');       // (db, parent, diff) -> void
    if (!adapter?.parentSourceType) missing.push('parentSourceType');
  }

  if (missing.length) {
    const e = new Error(`adapter_contract_incomplete: mode "${mode}" requires ${missing.join(', ')}`);
    e.code = 'ADAPTER_CONTRACT_INCOMPLETE';
    e.missing = missing;
    throw e;
  }
  return true;
}

/**
 * The generic set diff behind parent_recompute.
 *
 * `keyOf` gives each member its identity; `sameOf` decides whether two members
 * with the same identity are equal. Both are injected because identity is
 * domain knowledge — a booking is identified by its deal, an assignment by its
 * person — and the engine must not invent either.
 *
 * `protect` is the guard that stops a recompute from destroying local truth: it
 * receives (current, desired) for a matched pair and returns a REPLACEMENT
 * desired value, or the string 'conflict' to refuse the change. This is where
 * "never reduce seats below what GOS has already registered" lives, expressed
 * by the domain rather than hardcoded here.
 */
export function diffSets({ current = [], desired = [], keyOf, sameOf, protect = null }) {
  const cur = new Map(current.map((m) => [keyOf(m), m]));
  const des = new Map(desired.map((m) => [keyOf(m), m]));

  const add = [];
  const update = [];
  const remove = [];
  const conflicts = [];

  for (const [key, want] of des) {
    const have = cur.get(key);
    if (!have) { add.push(want); continue; }
    let target = want;
    if (protect) {
      const verdict = protect(have, want);
      if (verdict === 'conflict') {
        conflicts.push({ key, current: have, desired: want });
        continue;
      }
      if (verdict !== undefined && verdict !== null) target = verdict;
    }
    if (!sameOf(have, target)) update.push({ key, from: have, to: target });
  }

  for (const [key, have] of cur) {
    if (!des.has(key)) remove.push(have);
  }

  return {
    add, update, remove, conflicts,
    hasWork: add.length > 0 || update.length > 0 || remove.length > 0,
    changed: add.length + update.length + remove.length,
  };
}
