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

export const OUTCOME = Object.freeze({
  MERGED: 'merged',
  CONVERGED: 'converged',
  NOOP: 'noop',
  CONFLICT: 'conflict',
  BOOTSTRAPPED: 'bootstrapped',
  SOURCE_DELETED: 'source_deleted',
  NOT_CROSSWALKED: 'not_crosswalked',
  IGNORED_SOURCE_CUT_OVER: 'ignored_source_cut_over',
});

const MAX_ATTEMPTS = 6;
const retryDelayMs = (attempt) => Math.min(60_000 * 2 ** (attempt - 1), 60 * 60_000);

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
export async function processEvent(db, eventId, adapter) {
  const row = await db.mirrorEvent.findUnique({ where: { id: eventId } });
  if (!row) return { status: 'missing' };
  if (row.status === 'processed' || row.status === 'skipped') {
    return { status: row.status, outcome: row.outcome, alreadyDone: true };
  }

  const attemptNo = (row.attemptCount || 0) + 1;
  const finish = (data) => db.mirrorEvent.update({
    where: { id: eventId },
    data: { attemptCount: attemptNo, processedAt: new Date(), claimedAt: null, claimedBy: null, ...data },
  });

  try {
    const system = row.system;
    const entity = row.entity;
    if (owningSystem(entity) !== system) {
      await finish({ status: 'skipped', outcome: OUTCOME.NOT_CROSSWALKED, failureCode: 'entity_not_owned_by_system' });
      return { status: 'skipped', outcome: OUTCOME.NOT_CROSSWALKED };
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

    // No crosswalk → this legacy record was never imported. The mirror does NOT
    // create records: creation is the ingress platform's job, and inventing one
    // here would produce a second, unlinked copy of a customer.
    if (!link?.entityId) {
      await finish({ status: 'processed', outcome: OUTCOME.NOT_CROSSWALKED });
      return { status: 'processed', outcome: OUTCOME.NOT_CROSSWALKED };
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

/** Receive + process in one call — the path webhooks and pollers both use. */
export async function ingestMirror(db, args, adapter) {
  const { eventId, duplicate, status } = await receive(db, args);
  if (duplicate && (status === 'processed' || status === 'skipped')) {
    return { eventId, duplicate: true, status };
  }
  const res = await processEvent(db, eventId, adapter);
  return { eventId, duplicate, ...res };
}

/** Entities this mirror knows how to handle, per system. */
export function mirroredEntities(system) {
  return Object.entries(OWNERSHIP).filter(([, spec]) => spec.system === system).map(([k]) => k);
}
