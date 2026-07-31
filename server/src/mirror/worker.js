// Mirror workers — retry, poll and reconcile.
//
// All three use the claim-based tick already proven by the ingress retry worker
// and the WhatsApp scheduled worker: a conditional updateMany with a TTL means
// several instances can run without double-processing, and a crashed claim is
// reclaimed after the TTL rather than wedging the row forever.
//
// Division of labour:
//   retry      — re-processes `pending` MirrorEvents whose backoff is due.
//   poll       — the BACKSTOP. Asks each source "what changed since X" and
//                feeds the same pipeline. This is what makes the mirror correct
//                when a webhook is missed, delayed, or never configured at all.
//   reconcile  — the slow full sweep. Catches what both transports missed and
//                is the ONLY way to observe deletions reliably.
//
// Polling is not an optimisation of webhooks; it is the correctness guarantee.
// Webhooks are the latency optimisation on top.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { processEvent } from './pipeline.js';
import { captureEnabled, mirrorMode, pollIntervalMs } from './config.js';
import { isRetired } from './legacyPolicy.js';
import { MODE, modeOf } from './modes.js';
import { processCoalesced } from './coalesce.js';

export const CLAIM_TTL_MS = 5 * 60 * 1000;
const RETRY_TICK_MS = 60 * 1000;
const BATCH = 20;

const WORKER_ID = `mirror-${crypto.randomUUID().slice(0, 8)}`;


// ── retry ────────────────────────────────────────────────────────────────────

export async function claimOneEvent(db, now = new Date()) {
  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  const candidates = await db.mirrorEvent.findMany({
    where: {
      status: 'pending',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }] }],
    },
    orderBy: { receivedAt: 'asc' },
    take: BATCH,
    select: { id: true },
  });
  for (const c of candidates) {
    const res = await db.mirrorEvent.updateMany({
      // The predicate repeats the freshness condition, so a concurrent winner
      // between findMany and updateMany loses here (count === 0).
      where: {
        id: c.id,
        status: 'pending',
        OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }],
      },
      data: { claimedAt: now, claimedBy: WORKER_ID },
    });
    if (res.count === 1) return c.id;
  }
  return null;
}

export async function runRetryTick(db, adapterFactory, { max = BATCH } = {}) {
  const stats = { claimed: 0, processed: 0, failed: 0, coalesced: 0, savedRecomputes: 0 };

  // Claim first, then decide how to process. Claiming the whole batch up front
  // is what lets parent_recompute events be coalesced: several children of one
  // parent must be in hand together to collapse into a single recompute.
  const claimedIds = [];
  for (let i = 0; i < max; i++) {
    const id = await claimOneEvent(db);
    if (!id) break;
    claimedIds.push(id);
  }
  stats.claimed = claimedIds.length;
  if (!claimedIds.length) return stats;

  const rows = [];
  for (const id of claimedIds) {
    rows.push(await db.mirrorEvent.findUnique({ where: { id } }));
  }

  // Split by mode: entity_merge events carry their own intermediate values and
  // must each be processed; parent_recompute events are coalesced per parent.
  const perEvent = [];
  const recompute = [];
  for (const row of rows) {
    // A RETIRED source is settled before any adapter is built. Two reasons, and
    // the second is the important one:
    //   * building an Airtable adapter constructs a live API client and a child
    //     fetcher for a source we have decided never to read again;
    //   * retired parent_recompute events would otherwise flow into
    //     processCoalesced, which groups them by parent and recomputes — the
    //     exact operation the cutover exists to stop.
    // processEvent settles it terminally with a named reason; it consults the
    // policy from the row itself and needs no adapter to do so.
    if (isRetired(row.system, row.entity)) {
      await processEvent(db, row.id, null);
      stats.processed++;
      continue;
    }
    // The row is passed so the factory can disambiguate targets that share an
    // entity (all four Airtable pollers declare 'tourEvent').
    const adapter = adapterFactory(row.system, row.entity, row);
    if (!adapter) {
      // NOT 'skipped'. A missing adapter is a CONFIGURATION gap, not a decision
      // about the data — marking it terminal destroys a real change that nothing
      // will ever replay. It stays pending, carries the reason for the health
      // report, and processes itself once the adapter exists. This exact branch
      // silently ate two real Airtable coordination changes on 2026-07-30.
      await db.mirrorEvent.update({
        where: { id: row.id },
        data: {
          status: 'pending',
          failureCode: 'no_adapter',
          failureMessage: `no adapter for ${row.system}:${row.entity} — the event is kept, not discarded`,
          claimedAt: null,
          claimedBy: null,
        },
      });
      stats.failed++;
      continue;
    }
    let mode;
    try { mode = modeOf(adapter); } catch { mode = MODE.ENTITY_MERGE; }
    (mode === MODE.PARENT_RECOMPUTE ? recompute : perEvent).push({ row, adapter });
  }

  for (const { row, adapter } of perEvent) {
    const res = await processEvent(db, row.id, adapter);
    if (res.status === 'processed' || res.status === 'skipped') stats.processed++;
    else stats.failed++;
  }

  if (recompute.length) {
    const c = await processCoalesced(db, recompute.map((r) => r.row), adapterFactory);
    stats.processed += c.recomputes + c.coalesced + c.unresolved;
    stats.coalesced += c.coalesced;
    stats.savedRecomputes += c.savedRecomputes;
  }

  return stats;
}

// ── cursors ──────────────────────────────────────────────────────────────────

/**
 * Cursor identity.
 *
 * `${system}:${entity}` is NOT sufficient: several Airtable tables all mirror
 * into `tourEvent` (the tours table plus three child tables), so keying on the
 * entity alone would give four pollers ONE cursor and they would overwrite each
 * other's position — silently losing changes. `cursorKey` lets a target declare
 * its own position; the entity-based id remains the default for single-table
 * sources.
 */
export function cursorIdFor({ system, entity, cursorKey = null }) {
  return cursorKey || `${system}:${entity}`;
}

export async function claimCursor(db, { system, entity, cursorKey = null }, now = new Date()) {
  const id = cursorIdFor({ system, entity, cursorKey });
  const stale = new Date(now.getTime() - CLAIM_TTL_MS);
  await db.mirrorCursor.upsert({
    where: { id },
    create: { id, system, entity },
    update: {},
  });
  const res = await db.mirrorCursor.updateMany({
    where: { id, OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }] },
    data: { claimedAt: now, claimedBy: WORKER_ID, lastRunAt: now },
  });
  if (res.count !== 1) return null;
  return db.mirrorCursor.findUnique({ where: { id } });
}

export async function releaseCursor(db, { system, entity, cursorKey = null }, { cursor, error = null } = {}) {
  const id = cursorIdFor({ system, entity, cursorKey });
  const now = new Date();
  return db.mirrorCursor.update({
    where: { id },
    data: error
      ? { claimedAt: null, claimedBy: null, lastError: String(error).slice(0, 500), failureStreak: { increment: 1 } }
      : { claimedAt: null, claimedBy: null, cursor: cursor ?? undefined, lastSuccessAt: now, lastError: null, failureStreak: 0 },
  });
}

/**
 * One polling pass for a (system, entity).
 *
 * `source.fetchChanges(cursor)` returns { records, nextCursor }; each record is
 * { externalId, version, payload }. The poller does no interpretation — it
 * feeds the same pipeline the webhook does.
 */
export async function runPollTick(db, { system, entity, cursorKey = null, source, adapter, ingest }) {
  const claim = await claimCursor(db, { system, entity, cursorKey });
  if (!claim) return { skipped: 'not_claimed' };

  const stats = { fetched: 0, processed: 0, duplicates: 0, conflicts: 0 };
  try {
    const { records, nextCursor } = await source.fetchChanges(claim.cursor);
    stats.fetched = records.length;
    for (const rec of records) {
      const res = await ingest(db, {
        system, entity, externalId: rec.externalId, changeKind: 'poll', transport: 'poll',
        version: rec.version, rawPayload: rec.payload,
      }, adapter);
      if (res.duplicate) stats.duplicates++;
      else stats.processed++;
      if (res.outcome === 'conflict') stats.conflicts++;
    }
    await releaseCursor(db, { system, entity, cursorKey }, { cursor: nextCursor });
    return stats;
  } catch (e) {
    await releaseCursor(db, { system, entity, cursorKey }, { error: e?.message || String(e) });
    throw e;
  }
}

// ── health ───────────────────────────────────────────────────────────────────

/**
 * A poller that has silently stopped is worse than one that never ran, because
 * the mirror keeps *looking* live. This makes that state visible.
 */
export async function mirrorHealth(db, { staleAfterMs = 30 * 60 * 1000, env = process.env } = {}) {
  const rawCursors = await db.mirrorCursor.findMany({ orderBy: { id: 'asc' } });
  const now = Date.now();
  const problems = [];
  // A RETIRED poller's cursor is left in place as evidence of where it stopped —
  // deleting it would erase the record of how far the mirror got. But it must not
  // be judged against liveness rules any more: a cursor that has not polled since
  // the cutover is not "stale", it is finished. Reporting it as a problem forever
  // would train everyone to ignore this screen, which is the one failure mode a
  // health report cannot survive.
  //
  // A row must NAME the source it belongs to before it can claim retirement.
  // Without that check a malformed cursor — no system, no entity — would look
  // up an undeclared pair, get "no permissions", and be waved through as
  // retired: the one row most likely to be genuinely broken would become the one
  // row nobody is told about.
  const cursors = rawCursors.map((c) => ({
    ...c,
    retired: Boolean(c.system && c.entity) && isRetired(c.system, c.entity, env),
  }));
  for (const c of cursors) {
    if (c.retired) continue;
    if (c.failureStreak >= 3) {
      problems.push({ cursor: c.id, problem: 'failing', detail: `${c.failureStreak} consecutive failures: ${c.lastError || 'unknown'}` });
    } else if (c.lastSuccessAt && now - new Date(c.lastSuccessAt).getTime() > staleAfterMs) {
      problems.push({ cursor: c.id, problem: 'stale', detail: `no successful poll since ${new Date(c.lastSuccessAt).toISOString()}` });
    } else if (!c.lastSuccessAt && c.lastRunAt) {
      problems.push({ cursor: c.id, problem: 'never_succeeded', detail: c.lastError || 'no successful poll yet' });
    }
  }
  const dead = await db.mirrorEvent.count({ where: { status: 'dead' } });
  const pending = await db.mirrorEvent.count({ where: { status: 'pending' } });
  const conflicts = await db.mirrorEvent.count({ where: { outcome: 'conflict' } });
  if (dead > 0) problems.push({ cursor: null, problem: 'dead_events', detail: `${dead} event(s) exhausted their retries and need a human` });
  return { ok: problems.length === 0, cursors, pending, dead, conflicts, problems };
}

// ── loop ─────────────────────────────────────────────────────────────────────

let _timers = [];

/**
 * Start the workers.
 *
 * Gated on CAPTURE, not apply: during Phase A the workers must run so events
 * are polled and buffered, while processEvent independently refuses to write.
 * Both flags default off — the mirror touches production CRM records and must
 * never start because someone forgot a variable.
 */
export function startMirrorWorkers({ adapterFactory, pollTargets = [], db = prisma } = {}) {
  const mode = mirrorMode();
  if (mode.incoherent) {
    console.error('[mirror] REFUSING TO START — apply is enabled but capture is not. That would write whatever happened to be buffered and then go blind.');
    return () => {};
  }
  if (!mode.capture) {
    console.log('[mirror] workers DISABLED (set MIRROR_CAPTURE_ENABLED=true to start capture)');
    return () => {};
  }
  console.log(`[mirror] mode: capture=${mode.capture} apply=${mode.apply}${mode.legacy ? ' (via legacy MIRROR_ENABLED)' : ''}`);
  console.log(`[mirror] workers starting — retry ${RETRY_TICK_MS}ms, poll ${pollIntervalMs()}ms, ${pollTargets.length} target(s)`);

  const retryTimer = setInterval(() => {
    runRetryTick(db, adapterFactory).catch((e) => console.error('[mirror] retry tick failed:', e?.message || e));
  }, RETRY_TICK_MS);
  retryTimer.unref?.();
  _timers.push(retryTimer);

  for (const t of pollTargets) {
    const timer = setInterval(() => {
      runPollTick(db, t).catch((e) => console.error(`[mirror] poll ${t.system}:${t.entity} failed:`, e?.message || e));
    }, pollIntervalMs());
    timer.unref?.();
    _timers.push(timer);
  }

  return () => { for (const t of _timers) clearInterval(t); _timers = []; };
}
