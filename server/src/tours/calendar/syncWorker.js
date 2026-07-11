import { prisma } from '../../db.js';
import { emailIntegrationConfigured, accountHasCalendarScope } from '../../email/googleClient.js';
import { getSendAccount } from '../../email/simpleSend.js';
import { gcal } from './googleCalendar.js';
import { buildDesiredEvent, diffEvent, epochToWallTime } from './desiredState.js';

// Tours → Google Calendar reconciler. Same conventions as the other GOS
// workers: 60s tick inside the server process, budgeted, every step
// idempotent. TourEvent is the SSOT — each pass derives the ENTIRE desired
// event from the row and converges the Google side to it:
//   scheduled            → insert or minimal patch (null diff = no API write)
//   cancelled            → delete the event (Google emails the cancellations)
//   completed            → leave the calendar alone (history, not a cancel)
//   deleted (tombstone)  → delete the event; 404/410 counts as done
//
// Google being down NEVER blocks business operations: mutations only mark the
// tour 'pending' and this worker retries with backoff. After MAX_ATTEMPTS the
// row shows 'failed' (red chip in the Tour modal); any later mutation resets
// the ladder.

const TICK_MS = 60_000;
const MAX_TOURS_PER_TICK = 5;
const MAX_TOMBSTONES_PER_TICK = 5;
const MAX_ATTEMPTS = 8;
// Not-a-real-failure waits (org account missing or not yet reconnected with
// the calendar scope): retry quietly without consuming attempts.
const CONFIG_RETRY_MS = 15 * 60 * 1000;

const BACKOFF_MIN = [1, 2, 5, 15, 30, 60, 120, 240];
function backoffMs(attempts) {
  return BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] * 60 * 1000;
}

const TOUR_SYNC_INCLUDE = {
  product: { select: { nameHe: true, nameEn: true } },
  productVariant: { select: { durationHours: true } },
  assignments: {
    orderBy: { createdAt: 'asc' },
    include: { personRef: { select: { email: true } } },
  },
  activityComponents: {
    orderBy: { sortOrder: 'asc' },
    include: { workshopLocation: { select: { nameHe: true, address: true } } },
  },
};

const isGone = (e) => e?.status === 404 || e?.status === 410;

// ── One tour ──────────────────────────────────────────────────────────────────

// deps = { db, log, cal } — cal defaults to the real Google client and is
// injectable for tests (same convention as the gallery worker's storage).
export async function reconcileTour(deps, account, tourId) {
  const { db, log, cal = gcal } = deps;
  const tour = await db.tourEvent.findUnique({
    where: { id: tourId },
    include: TOUR_SYNC_INCLUDE,
  });
  if (!tour || tour.gcalSyncStatus !== 'pending') return 'skipped';
  const loadedUpdatedAt = tour.updatedAt;

  // Guarded success write: if the tour mutated while we were talking to
  // Google, leave it 'pending' — the next tick re-reconciles (diff → no-op if
  // nothing visible changed). This is what makes the worker lost-update-safe.
  const markSynced = async (patch, warnings) => {
    const res = await db.tourEvent.updateMany({
      where: { id: tour.id, updatedAt: loadedUpdatedAt },
      data: {
        ...patch,
        gcalSyncStatus: 'synced',
        gcalSyncedAt: new Date(),
        gcalSyncError: null,
        gcalSyncWarning: warnings?.length ? warnings.join('\n') : null,
        gcalAttempts: 0,
        gcalNextRetryAt: null,
      },
    });
    return res.count ? 'synced' : 'requeued';
  };

  try {
    // Cancelled → the Google event goes away; guests get Google's
    // cancellation email. Clearing gcalEventId means a later restore
    // (scheduled again) creates a brand-new event, per spec.
    if (tour.status === 'cancelled') {
      if (tour.gcalEventId) {
        try {
          await cal.deleteEvent(db, account, tour.gcalEventId);
        } catch (e) {
          if (!isGone(e)) throw e;
        }
      }
      return await markSynced({ gcalEventId: null, gcalAccountId: null });
    }

    // Completed (or a scheduled row missing its date/time — group slots can't,
    // deal tours shouldn't): nothing to converge; never cancel history.
    if (tour.status !== 'scheduled' || !tour.date || !tour.startTime) {
      return await markSynced({});
    }

    const { event: desired, warnings } = buildDesiredEvent(tour);

    let eventId = tour.gcalEventId;
    let existing = null;
    if (eventId) {
      try {
        existing = await cal.getEvent(db, account, eventId);
      } catch (e) {
        if (!isGone(e)) throw e;
        eventId = null; // deleted on the Google side — recreate below
      }
    }
    if (!eventId) {
      // Idempotency: adopt an event whose id write was lost before inserting a
      // second one (unique gosTourEventId stamp on every event we create).
      const adopted = await cal.findByTourEventId(db, account, tour.id);
      if (adopted && adopted.status !== 'cancelled') {
        eventId = adopted.id;
        existing = adopted;
      }
    }

    if (!existing || existing.status === 'cancelled') {
      let created;
      if (existing && existing.status === 'cancelled') {
        // Restoring a Google-side-cancelled event: PATCH it back to confirmed
        // with the full desired state — keeps the stable event id.
        created = await cal.patchEvent(db, account, existing.id, {
          ...desired,
          status: 'confirmed',
        });
      } else {
        created = await cal.insertEvent(db, account, desired);
      }
      return await markSynced({ gcalEventId: created.id, gcalAccountId: account.id }, warnings);
    }

    const patch = diffEvent(existing, desired);
    if (patch) await cal.patchEvent(db, account, eventId, patch);
    return await markSynced({ gcalEventId: eventId, gcalAccountId: account.id }, warnings);
  } catch (e) {
    const attempts = (tour.gcalAttempts || 0) + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await db.tourEvent.updateMany({
      where: { id: tour.id },
      data: {
        gcalSyncStatus: exhausted ? 'failed' : 'pending',
        gcalSyncError: String(e?.message || e).slice(0, 500),
        gcalAttempts: attempts,
        gcalNextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
      },
    });
    log?.warn?.('[tour-calendar] sync failed for', tour.id, e?.message);
    return 'failed';
  }
}

// ── Tombstones (tour rows already deleted) ────────────────────────────────────

export async function processTombstone(deps, account, stone) {
  const { db, log, cal = gcal } = deps;
  try {
    try {
      await cal.deleteEvent(db, account, stone.gcalEventId);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
    await db.tourCalendarTombstone.update({
      where: { id: stone.id },
      data: { status: 'done', lastError: null },
    });
    return 'done';
  } catch (e) {
    const attempts = (stone.attempts || 0) + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await db.tourCalendarTombstone.update({
      where: { id: stone.id },
      data: {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        lastError: String(e?.message || e).slice(0, 500),
        nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
    log?.warn?.('[tour-calendar] tombstone failed for event', stone.gcalEventId, e?.message);
    return 'failed';
  }
}

// ── Backfill sweep ────────────────────────────────────────────────────────────
// Continuous + idempotent: any scheduled tour from today onward that was never
// considered (gcalSyncStatus IS NULL) becomes pending — this covers the
// pre-feature backlog AND rule-generated slots with zero per-callsite code.
// Past/cancelled tours stay NULL on purpose: no invitations for history.

export async function sweepUnsyncedTours(db) {
  const today = epochToWallTime(Date.now()).slice(0, 10);
  const res = await db.tourEvent.updateMany({
    where: { gcalSyncStatus: null, status: 'scheduled', date: { gte: today } },
    data: { gcalSyncStatus: 'pending' },
  });
  return res.count;
}

// ── Worker loop ───────────────────────────────────────────────────────────────

// Waiting-on-config states keep the row pending with a readable reason and a
// quiet retry — attempts are NOT consumed (nothing is failing, we're waiting
// for a human to connect/reconnect the org Google account).
async function parkPending(db, where, reason) {
  await db.tourEvent.updateMany({
    where,
    data: {
      gcalSyncError: reason,
      gcalNextRetryAt: new Date(Date.now() + CONFIG_RETRY_MS),
    },
  });
}

let started = false;
let inFlight = false;

export function startTourCalendarSyncWorker(log = console) {
  if (started) return;
  started = true;
  const deps = { db: prisma, log };

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!emailIntegrationConfigured()) return;

      const swept = await sweepUnsyncedTours(prisma);
      if (swept) log?.log?.(`[tour-calendar] backfill: marked ${swept} tours pending`);

      const due = {
        gcalSyncStatus: 'pending',
        OR: [{ gcalNextRetryAt: null }, { gcalNextRetryAt: { lte: new Date() } }],
      };
      const hasWork =
        (await prisma.tourEvent.count({ where: due })) > 0 ||
        (await prisma.tourCalendarTombstone.count({
          where: { status: 'pending', nextRetryAt: { lte: new Date() } },
        })) > 0;
      if (!hasWork) return;

      const account = await getSendAccount();
      if (!account) {
        await parkPending(prisma, due, 'לא מחובר חשבון Google ארגוני');
        return;
      }
      if (!accountHasCalendarScope(account)) {
        await parkPending(
          prisma,
          due,
          'לחשבון Google המחובר אין הרשאת יומן — יש להתחבר מחדש דרך מודול המייל',
        );
        return;
      }

      const tours = await prisma.tourEvent.findMany({
        where: due,
        orderBy: { updatedAt: 'asc' },
        take: MAX_TOURS_PER_TICK,
        select: { id: true },
      });
      for (const t of tours) await reconcileTour(deps, account, t.id);

      const stones = await prisma.tourCalendarTombstone.findMany({
        where: { status: 'pending', nextRetryAt: { lte: new Date() } },
        orderBy: { nextRetryAt: 'asc' },
        take: MAX_TOMBSTONES_PER_TICK,
      });
      for (const s of stones) await processTombstone(deps, account, s);
    } catch (e) {
      log?.warn?.('[tour-calendar] worker tick failed:', e?.message);
    } finally {
      inFlight = false;
    }
  };

  setInterval(tick, TICK_MS).unref?.();
  log?.log?.('[tour-calendar] sync worker started');
}
