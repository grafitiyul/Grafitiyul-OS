// Per-parent coalescing for parent_recompute.
//
// THE PROBLEM
//
// A recompute is expensive: it reads ALL of a parent's children (an API call, or
// several) and re-derives the whole set. In parent_recompute mode the unit of
// work is the PARENT, but events arrive per CHILD — so ten coordination edits on
// one tour would trigger ten identical recomputes, each re-reading the same
// children. That is the N+1 pattern, and on a source with a request quota it is
// not merely wasteful, it is the thing that exhausts the quota.
//
// THE FIX
//
// Group pending events by resolved parent, recompute each parent ONCE, and mark
// every event that contributed as processed by the same outcome. Correctness is
// unaffected because a recompute is idempotent and already reads current state:
// processing the newest event for a parent produces exactly the state that
// processing all ten in order would.
//
// Ordering still matters ACROSS parents, but within one parent the last state
// wins by construction — which is precisely why coalescing is safe here and
// would not be safe for entity_merge, where each event carries its own
// intermediate value.

import { modeOf, MODE } from './modes.js';
import { processEvent } from './pipeline.js';

/**
 * Group events by the parent they resolve to.
 *
 * Resolution uses the adapter, so the grouping key is domain-correct rather than
 * guessed from the payload shape. An event whose parent cannot be resolved is
 * returned separately — it still needs processing (to be recorded as
 * `no_parent`), it just cannot be coalesced with anything.
 */
export async function groupByParent(db, events, adapterFactory) {
  const groups = new Map();   // parentKey → { parent, events[] }
  const unresolved = [];

  for (const ev of events) {
    const adapter = adapterFactory(ev.system, ev.entity);
    if (!adapter || modeOf(adapter) !== MODE.PARENT_RECOMPUTE) { unresolved.push(ev); continue; }
    // Resolution failures are NOT swallowed here. The event falls through to
    // individual processing, where the pipeline records the named reason — if
    // this caught and discarded the error, the audit trail would show only
    // `no_parent` with no way to tell why.
    let parent = null;
    try {
      parent = await adapter.resolveParent(db, ev);
    } catch {
      parent = null; // re-thrown and recorded by processEvent for this event
    }
    if (!parent?.entityId) { unresolved.push(ev); continue; }

    const key = `${ev.system}:${adapter.parentSourceType}:${parent.sourceId}`;
    if (!groups.has(key)) groups.set(key, { key, parent, adapter, events: [] });
    groups.get(key).events.push(ev);
  }
  return { groups: [...groups.values()], unresolved };
}

/**
 * Process a batch with coalescing.
 *
 * For each parent group: recompute ONCE using the NEWEST event (the state it
 * carries is the state that matters), then mark the older siblings processed
 * with the same outcome and a `coalescedInto` pointer so the audit trail shows
 * why they were not individually recomputed.
 */
export async function processCoalesced(db, events, adapterFactory, { allowApply = null } = {}) {
  const stats = {
    events: events.length,
    parents: 0,
    recomputes: 0,
    coalesced: 0,
    unresolved: 0,
    conflicts: 0,
    // The whole point: how many recomputes were avoided.
    savedRecomputes: 0,
  };

  const { groups, unresolved } = await groupByParent(db, events, adapterFactory);
  stats.parents = groups.length;

  for (const g of groups) {
    // Newest wins: a recompute reads current state, so the latest event's
    // arrival is the correct moment to evaluate the parent.
    const ordered = [...g.events].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    const [newest, ...older] = ordered;

    const res = await processEvent(db, newest.id, g.adapter, { allowApply });
    stats.recomputes += 1;
    if (res.outcome === 'conflict') stats.conflicts += 1;

    // A buffered event must NOT drag its siblings into a terminal state: with
    // apply off nothing was evaluated, so every event in the group stays pending.
    if (res.buffered) continue;

    for (const ev of older) {
      await db.mirrorEvent.update({
        where: { id: ev.id },
        data: {
          status: 'processed',
          outcome: res.outcome,
          gosEntityType: g.parent.entityType || ev.entity,
          gosEntityId: g.parent.entityId,
          processedAt: new Date(),
          claimedAt: null,
          claimedBy: null,
          failureCode: null,
          failureMessage: null,
          // Audit: this event was real, and it was accounted for by one
          // recompute of its parent rather than ignored.
          fieldsWritten: { coalescedInto: newest.id },
        },
      });
      stats.coalesced += 1;
    }
    stats.savedRecomputes += older.length;
  }

  // Events that could not be grouped still get processed individually — they
  // must reach a terminal state, not sit pending forever.
  for (const ev of unresolved) {
    const adapter = adapterFactory(ev.system, ev.entity);
    if (!adapter) {
      await db.mirrorEvent.update({
        where: { id: ev.id },
        data: { status: 'skipped', failureCode: 'no_adapter', claimedAt: null, claimedBy: null },
      });
    } else {
      await processEvent(db, ev.id, adapter, { allowApply });
    }
    stats.unresolved += 1;
  }

  return stats;
}

/**
 * A bounded request budget shared across one run.
 *
 * The Airtable client already refuses past its ceiling; this makes the ceiling
 * shared, so several tables polling in the same tick cannot each spend a full
 * allowance. `spend()` throws at the limit rather than continuing, because a
 * partial run that reports honestly is safer than a complete run that drained
 * the quota.
 */
export function createBudget(ceiling) {
  return {
    used: 0,
    ceiling,
    get remaining() { return Math.max(0, this.ceiling - this.used); },
    spend(n = 1) {
      if (this.used + n > this.ceiling) {
        const e = new Error(`api_ceiling_reached: ${this.used}/${this.ceiling} requests this run`);
        e.code = 'API_CEILING';
        throw e;
      }
      this.used += n;
      return this.used;
    },
  };
}
