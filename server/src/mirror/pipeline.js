// THE mirror pipeline — one code path for every source and every transport.
//
// A Pipedrive webhook, an Airtable poll and a reconciliation sweep all end up
// here, so they cannot drift apart in how they merge, how they conflict, or
// what they refuse to touch.
//
//   1. RECEIVE   persist the raw payload FIRST, keyed by (system, idempotencyKey).
//                A redelivery, a retry, or a poll that re-sees the same version
//                is recognised and never processed twice.
//   2. RESOLVE   find the GOS entity through the LegacyRecord crosswalk. No
//                crosswalk = not ours to mirror; recorded, not guessed.
//   3. MERGE     3-way through the shared engine, gated by the ownership map.
//   4. APPLY     write only the merged fields; raise conflicts; advance the
//                baseline for merged + converged fields ONLY.
//
// The mirror never writes to Pipedrive or Airtable. There is no code path here
// that could, and a test asserts the module exports none.

import crypto from 'node:crypto';
import { mergeRecord } from './merge.js';
import { OWNERSHIP, owningSystem } from './ownership.js';
import { advanceBaseline, markSourceDeleted, readBaseline } from './baseline.js';
import { raiseSyncConflict } from './conflicts.js';
import { mirrorShouldIgnore, sourceForLegacyLabel } from './sourceRegistry.js';
import { applyEnabled } from './config.js';
import { MODE, assertAdapterContract, diffSets, modeOf } from './modes.js';

export const OUTCOME = Object.freeze({
  CREATED: 'created',   // the mirror created the GOS record (no crosswalk existed)
  MERGED: 'merged',
  CONVERGED: 'converged',
  NOOP: 'noop',
  CONFLICT: 'conflict',
  BOOTSTRAPPED: 'bootstrapped',
  SOURCE_DELETED: 'source_deleted',
  NOT_CROSSWALKED: 'not_crosswalked',
  IGNORED_SOURCE_CUT_OVER: 'ignored_source_cut_over',
  // parent_recompute outcomes
  RECOMPUTED: 'recomputed',
  NO_PARENT: 'no_parent',
});

const MAX_ATTEMPTS = 6;
const retryDelayMs = (attempt) => Math.min(60_000 * 2 ** (attempt - 1), 60 * 60_000);

// How long an event waits before being re-examined when nothing can be done with
// it YET — no creation support, or an adapter that declined for a nameable
// reason. Long enough not to spin the worker, short enough that support landing
// mid-day is picked up without anyone poking it.
const UNSUPPORTED_RETRY_MS = 30 * 60 * 1000;

export function buildIdempotencyKey({ system, entity, externalId, changeKind, version }) {
  // `version` is whatever the source offers to distinguish one change from the
  // next: Pipedrive's update_time, Airtable's lastModifiedTime, or a hash of
  // the payload when neither exists. Without it a poll would re-process every
  // record on every tick.
  return crypto.createHash('sha256')
    .update([system, entity, externalId, changeKind, version ?? ''].join('|'), 'utf8')
    .digest('hex');
}

export function payloadVersion(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Durably record an inbound change. Returns { eventId, duplicate }.
 * Persisting before processing is what makes replay possible at all.
 */
export async function receive(db, { system, entity, externalId, changeKind, transport, version, rawPayload, rawHeaders = null }) {
  const idempotencyKey = buildIdempotencyKey({ system, entity, externalId, changeKind, version: version ?? payloadVersion(rawPayload) });

  const existing = await db.mirrorEvent.findUnique({
    where: { system_idempotencyKey: { system, idempotencyKey } },
    select: { id: true, status: true },
  });
  if (existing) return { eventId: existing.id, duplicate: true, status: existing.status };

  try {
    const row = await db.mirrorEvent.create({
      data: {
        system, entity, externalId: String(externalId), changeKind, transport,
        idempotencyKey, rawPayload, rawHeaders, status: 'pending',
      },
      select: { id: true },
    });
    return { eventId: row.id, duplicate: false };
  } catch (e) {
    // A concurrent delivery won the unique index — that IS the dedupe working.
    if (e?.code === 'P2002') {
      const row = await db.mirrorEvent.findUnique({
        where: { system_idempotencyKey: { system, idempotencyKey } },
        select: { id: true, status: true },
      });
      return { eventId: row.id, duplicate: true, status: row.status };
    }
    throw e;
  }
}

/**
 * Process one received event.
 *
 * `adapter` supplies the source-specific pieces and NOTHING else:
 *   normalize(rawPayload) -> { fields, sourceDeleted?, legacySourceLabel? }
 *   sourceType            -> LegacyRecord.sourceType for this entity
 *   loadGos(db, entityId) -> the current GOS row (only the mirrored fields)
 *   applyGos(db, entityId, set) -> writes them
 *   guards(db, gosRow)    -> { gosOwnsCommercials: bool, ... }
 *   describe(gosRow)      -> { label, orderNo } for the conflict card
 */
export async function processEvent(db, eventId, adapter, { allowApply = null } = {}) {
  const row = await db.mirrorEvent.findUnique({ where: { id: eventId } });
  if (!row) return { status: 'missing' };
  if (row.status === 'processed' || row.status === 'skipped') {
    return { status: row.status, outcome: row.outcome, alreadyDone: true };
  }

  // THE apply gate. One condition, consulted by every path — webhook, poll,
  // retry worker and replay — so no route can write while apply is off.
  // `allowApply` is the explicit override the replay runner uses during
  // Phase C, when apply is still globally disabled but the buffered window is
  // deliberately being drained.
  const mayApply = allowApply === null ? applyEnabled() : allowApply;
  if (!mayApply) {
    // Deliberately NOT marked processed: the event stays `pending` so that when
    // apply is switched on it is picked up and applied. Marking it processed
    // here is exactly how a buffered window would be silently lost.
    await db.mirrorEvent.update({
      where: { id: eventId },
      data: {
        status: 'pending',
        outcome: null,
        failureCode: null,
        failureMessage: null,
        // RELEASE the claim the worker took to get here. Buffering is not work in
        // progress — nothing was evaluated — so leaving the event marked as claimed
        // states something untrue about it, and a human reading the buffer during a
        // cutover would see 63 events apparently mid-flight in a worker that is not
        // touching them. It also self-throttles re-examination to the claim TTL for
        // no reason. Terminal paths already release via `finish`; this one did not.
        claimedAt: null,
        claimedBy: null,
      },
    });
    return { status: 'pending', outcome: null, buffered: true };
  }

  const attemptNo = (row.attemptCount || 0) + 1;
  const finish = (data) => db.mirrorEvent.update({
    where: { id: eventId },
    data: { attemptCount: attemptNo, processedAt: new Date(), claimedAt: null, claimedBy: null, ...data },
  });

  /**
   * Park an event that could not be actioned YET.
   *
   * Deliberately NOT `finish`: that stamps processedAt, and an event nothing was
   * done to has not been processed. Saying otherwise corrupts the one signal that
   * tells us whether the buffer has been drained, and it is how "we handled it"
   * quietly comes to mean "we dropped it".
   */
  const defer = (code, message, extra = {}) => db.mirrorEvent.update({
    where: { id: eventId },
    data: {
      status: 'pending',
      outcome: null,
      failureCode: code,
      failureMessage: message,
      nextRetryAt: new Date(Date.now() + UNSUPPORTED_RETRY_MS),
      claimedAt: null,
      claimedBy: null,
      ...extra,
    },
  });

  try {
    const system = row.system;
    const entity = row.entity;
    if (owningSystem(entity) !== system) {
      await finish({ status: 'skipped', outcome: OUTCOME.NOT_CROSSWALKED, failureCode: 'entity_not_owned_by_system' });
      return { status: 'skipped', outcome: OUTCOME.NOT_CROSSWALKED };
    }

    // ── mode dispatch ────────────────────────────────────────────────────────
    // The adapter DECLARES its shape; the engine implements both. Everything
    // below this point is entity_merge.
    const mode = modeOf(adapter);
    assertAdapterContract(adapter, mode);
    if (mode === MODE.PARENT_RECOMPUTE) {
      return runParentRecompute(db, row, adapter, finish);
    }

    const normalized = await adapter.normalize(row.rawPayload, row);

    // Law 4 — a source that has cut over to direct ingress must not ALSO be
    // mirrored from legacy, or the same event lands twice by two routes.
    const registrySource = normalized.legacySourceLabel ? sourceForLegacyLabel(normalized.legacySourceLabel) : null;
    if (registrySource && mirrorShouldIgnore(registrySource)) {
      await finish({ status: 'skipped', outcome: OUTCOME.IGNORED_SOURCE_CUT_OVER });
      return { status: 'skipped', outcome: OUTCOME.IGNORED_SOURCE_CUT_OVER, source: registrySource };
    }

    const key = { sourceSystem: system, sourceType: adapter.sourceType, sourceId: row.externalId };
    const link = await readBaseline(db, key);

    // ── no crosswalk ──────────────────────────────────────────────────────────
    // Previously this marked the event `processed` and moved on, which silently
    // and PERMANENTLY discarded every change to a record GOS did not already
    // have — 74% of live traffic when it was measured. Two changes:
    //
    //  1. An adapter that knows how to create its entity does so, crosswalk-first
    //     and idempotent, so a legacy record created after the snapshot still
    //     arrives instead of being lost.
    //  2. An adapter that does NOT support creation leaves the event PENDING with
    //     a named reason and a deferred retry. It stays measurable and replayable,
    //     and lands by itself once support exists or the record is imported.
    //     It is never marked processed on the strength of having done nothing.
    if (!link?.entityId) {
      if (normalized.sourceDeleted) {
        // Nothing to create: the source row is gone and GOS never had it.
        await finish({ status: 'processed', outcome: OUTCOME.SOURCE_DELETED, failureCode: 'deleted_before_import' });
        return { status: 'processed', outcome: OUTCOME.SOURCE_DELETED };
      }

      if (typeof adapter.createGos !== 'function') {
        await defer(
          'awaiting_creation_support',
          `${system}:${entity} ${row.externalId} has no crosswalk and ${entity} creation is not implemented — event retained, not discarded`,
        );
        return { status: 'pending', outcome: null, awaitingSupport: true };
      }

      // Crosswalk-first and idempotent is the ADAPTER's contract: it must write
      // the LegacyRecord in the same transaction as the entity, so a retry after a
      // partial failure finds the crosswalk and returns it instead of creating a
      // second copy of a customer.
      const created = await adapter.createGos(db, normalized, row);
      if (!created?.entityId) {
        // Declined for a nameable reason (unresolvable parent, unmappable
        // payload). Deferred and measurable, never discarded.
        await defer(
          created?.reason || 'creation_declined',
          created?.detail || `adapter declined to create ${entity} ${row.externalId}`,
        );
        return { status: 'pending', outcome: null, creationDeclined: true, reason: created?.reason || 'creation_declined' };
      }

      await finish({
        status: 'processed',
        outcome: OUTCOME.CREATED,
        gosEntityType: created.entityType || entity,
        gosEntityId: created.entityId,
        fieldsWritten: created.fieldsWritten || { created: true },
      });
      return { status: 'processed', outcome: OUTCOME.CREATED, entityId: created.entityId };
    }

    // Disappearance is recorded, never actioned. GOS owns operational history.
    if (normalized.sourceDeleted) {
      await markSourceDeleted(db, key);
      await finish({
        status: 'processed', outcome: OUTCOME.SOURCE_DELETED,
        gosEntityType: link.entityType, gosEntityId: link.entityId,
      });
      return { status: 'processed', outcome: OUTCOME.SOURCE_DELETED, entityId: link.entityId };
    }

    const gos = await adapter.loadGos(db, link.entityId);
    if (!gos) {
      // The GOS row is gone but the crosswalk remains (Law 5). Nothing to merge.
      await finish({ status: 'processed', outcome: OUTCOME.NOT_CROSSWALKED, failureCode: 'gos_entity_missing' });
      return { status: 'processed', outcome: OUTCOME.NOT_CROSSWALKED };
    }

    const guards = adapter.guards ? await adapter.guards(db, gos) : {};
    const merged = mergeRecord({
      entity,
      base: link.baseline,
      source: normalized.fields,
      gos,
      guards,
      fields: Object.keys(normalized.fields),
    });

    let outcome = OUTCOME.NOOP;
    if (merged.bootstrapped) outcome = OUTCOME.BOOTSTRAPPED;
    else if (merged.conflicts.length) outcome = OUTCOME.CONFLICT;
    else if (Object.keys(merged.set).length) outcome = OUTCOME.MERGED;
    else if (Object.keys(merged.advance).length) outcome = OUTCOME.CONVERGED;

    if (Object.keys(merged.set).length) {
      await adapter.applyGos(db, link.entityId, merged.set);
    }

    // Channels travel BESIDE the field set and are reconciled append-only, so
    // they run whether or not any field merged — a contact whose name is
    // unchanged may still have gained a phone number. Additions are counted into
    // the audit trail so "nothing merged" and "nothing happened" stay
    // distinguishable.
    let channelsAdded = null;
    if (normalized.channels && typeof adapter.applyChannels === 'function') {
      channelsAdded = await adapter.applyChannels(db, link.entityId, normalized.channels);
      if (channelsAdded && (channelsAdded.phones || channelsAdded.emails) && outcome === OUTCOME.NOOP) {
        outcome = OUTCOME.MERGED;
      }
    }

    if (merged.conflicts.length) {
      const d = adapter.describe ? adapter.describe(gos) : {};
      await raiseSyncConflict(db, {
        system, entity, entityId: link.entityId,
        entityLabel: d.label, orderNo: d.orderNo,
        conflicts: merged.conflicts,
      });
    }

    // Merged AND converged advance; conflicted fields deliberately do not, so
    // the conflict re-raises until a human resolves it.
    await advanceBaseline(db, key, merged.advance);

    await finish({
      status: 'processed',
      outcome,
      gosEntityType: link.entityType,
      gosEntityId: link.entityId,
      fieldsWritten: Object.keys(merged.set).length ? merged.set : undefined,
      conflicts: merged.conflicts.length ? merged.conflicts : undefined,
      failureCode: null,
      failureMessage: null,
    });

    return {
      status: 'processed', outcome, entityId: link.entityId,
      written: Object.keys(merged.set), conflicts: merged.conflicts, drift: merged.drift,
    };
  } catch (err) {
    const exhausted = attemptNo >= MAX_ATTEMPTS;
    const status = exhausted ? 'dead' : 'pending';
    await db.mirrorEvent.update({
      where: { id: eventId },
      data: {
        status,
        attemptCount: attemptNo,
        failureCode: err?.code || 'process_failed',
        failureMessage: String(err?.message || err).slice(0, 1000),
        nextRetryAt: status === 'pending' ? new Date(Date.now() + retryDelayMs(attemptNo)) : null,
        claimedAt: null,
        claimedBy: null,
      },
    });
    return { status, failureCode: err?.code || 'process_failed' };
  }
}

/**
 * PARENT_RECOMPUTE.
 *
 * A change to a child row is not applied to that row — it is applied by
 * recomputing the parent's whole derived set. That is the only correct move when
 * the GOS effect is an aggregate: one coordination row's seats mean nothing
 * without its siblings, so "merge this row" has no meaning at all.
 *
 * The engine owns the SHAPE (resolve → derive → compare → diff → apply) and the
 * adapter owns the DOMAIN (what a parent is, how the set is derived, what
 * identity and equality mean, what must be protected). Nothing here knows about
 * tours, bookings or Airtable.
 */
async function runParentRecompute(db, row, adapter, finish) {
  let parent = null;
  let resolveError = null;
  try {
    parent = await adapter.resolveParent(db, row);
  } catch (e) {
    resolveError = e;
  }

  if (!parent?.entityId) {
    // The child names a parent GOS has never seen. Recorded, not guessed at —
    // the mirror does not create records.
    //
    // Under normal operation this should not happen: Airtable is not edited
    // directly, so children arrive with parents that were already imported. It
    // is a migration-period guard rail, and terminating beats sitting pending
    // forever — but ONLY if a later investigation can tell why. So the reason,
    // the parent reference the child actually carried, and any thrown error are
    // all recorded. The raw payload is already persisted on the event, so the
    // full source row remains inspectable alongside this.
    const reason = resolveError
      ? 'resolve_parent_threw'
      : (parent?.reason || 'parent_unresolved');
    const detail = resolveError
      ? String(resolveError.message || resolveError).slice(0, 500)
      : (parent?.detail || null);

    await finish({
      status: 'processed',
      outcome: OUTCOME.NO_PARENT,
      failureCode: reason,
      failureMessage: detail,
      // The parent the child POINTED AT, even though it did not resolve — this
      // is what makes "which tour was this row talking about?" answerable.
      fieldsWritten: {
        attemptedParentSourceType: adapter.parentSourceType || null,
        attemptedParentSourceId: parent?.sourceId ?? null,
        childKind: adapter.childKind || null,
      },
    });
    return { status: 'processed', outcome: OUTCOME.NO_PARENT, reason, detail };
  }

  const desired = await adapter.derive(db, parent);
  const current = await adapter.loadCurrent(db, parent);
  const diff = diffSets({
    current,
    desired,
    keyOf: adapter.keyOf,
    sameOf: adapter.sameOf,
    protect: adapter.protect || null,
    protectRemoval: adapter.protectRemoval || null,
  });

  if (diff.conflicts.length) {
    const d = adapter.describeParent ? adapter.describeParent(parent) : {};
    await raiseSyncConflict(db, {
      system: row.system,
      entity: row.entity,
      entityId: parent.entityId,
      entityLabel: d.label,
      orderNo: d.orderNo,
      // Presented in the same three-value shape as a field conflict, so the
      // בקרה card renders one vocabulary regardless of which mode produced it.
      // The reason distinguishes the two causes, because they need different
      // operator decisions: a value was refused, versus the source row VANISHED
      // while GOS still holds the data.
      conflicts: diff.conflicts.map((c) => ({
        field: (adapter.conflictLabelFor && adapter.conflictLabelFor(c))
          || adapter.conflictFieldLabel
          || 'set',
        base: null,
        source: c.desired,
        gos: c.current,
        reason: c.kind === 'removal' ? 'source_member_disappeared' : 'set_protected',
      })),
    });
  }

  if (diff.hasWork) await adapter.applyDiff(db, parent, diff);

  // The baseline for a recompute is the DERIVED set, keyed on the parent — not
  // the child that happened to trigger it. That is what makes a second event on
  // a sibling child a no-op once the parent already converged.
  await advanceBaseline(
    db,
    { sourceSystem: row.system, sourceType: adapter.parentSourceType, sourceId: parent.sourceId },
    { derivedSet: desired },
  );

  const outcome = diff.conflicts.length
    ? OUTCOME.CONFLICT
    : diff.hasWork ? OUTCOME.RECOMPUTED : OUTCOME.NOOP;

  await finish({
    status: 'processed',
    outcome,
    gosEntityType: parent.entityType || row.entity,
    gosEntityId: parent.entityId,
    fieldsWritten: diff.hasWork ? { added: diff.add.length, updated: diff.update.length, removed: diff.remove.length } : undefined,
    conflicts: diff.conflicts.length ? diff.conflicts : undefined,
    failureCode: null,
    failureMessage: null,
  });

  return { status: 'processed', outcome, entityId: parent.entityId, diff };
}

/** Receive + process in one call — the path webhooks and pollers both use. */
export async function ingestMirror(db, args, adapter, opts = {}) {
  const { eventId, duplicate, status } = await receive(db, args);
  if (duplicate && (status === 'processed' || status === 'skipped')) {
    return { eventId, duplicate: true, status };
  }
  const res = await processEvent(db, eventId, adapter, opts);
  return { eventId, duplicate, ...res };
}

/** Entities this mirror knows how to handle, per system. */
export function mirroredEntities(system) {
  return Object.entries(OWNERSHIP).filter(([, spec]) => spec.system === system).map(([k]) => k);
}
