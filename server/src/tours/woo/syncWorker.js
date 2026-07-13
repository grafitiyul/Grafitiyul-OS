import { prisma } from '../../db.js';
import { israelToday } from '../slotGeneration.js';
import { occupancyFor } from '../occupancy.js';
import { woo as realWoo, wooConfigured, WOO_DATE_ATTRIBUTE } from './wooClient.js';
import { buildVariationPayload, findVariationForTour } from './desiredState.js';
import { resolveSellableCards, mappedTemplateIds } from './mapping.js';

// GOS → WooCommerce sync worker. For every sellable TourEvent (a group slot whose
// template has a mapped Pricing Card) it mirrors the concrete occurrence to a
// WooCommerce Variation — one per (TourEvent × card) — idempotently. TourEvent
// stays the SSOT; WooCommerce only reflects it. Same dirty-flag reconciler shape
// as the Google Calendar worker: a mutation marks wooSyncStatus='pending', this
// derives the whole desired state from canonical rows. Order ingestion is a
// later slice.

const TICK_MS = 60_000;
const MAX_TOURS_PER_TICK = 5;
const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = [1, 2, 5, 10, 20, 40, 60, 120]; // minutes, indexed by attempts

function backoffMs(attempts) {
  return BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] * 60_000;
}

// Registration cutoff: hidden once now ≥ occurrence − closeMinutes. IL wall time
// with a month-based DST approximation (a booking cutoff tolerates the twice-a-
// year edge; exactness is immaterial). closeMinutes null → never auto-closes.
export function occurrenceClosed(date, startTime, closeMinutes, nowMs) {
  if (closeMinutes == null || !date || !startTime) return false;
  const month = Number(String(date).slice(5, 7));
  const offsetH = month >= 4 && month <= 9 ? 3 : 2; // Asia/Jerusalem DST approx
  const wallAsUtc = Date.parse(`${date}T${startTime}:00Z`);
  const occMs = wallAsUtc - offsetH * 3_600_000;
  return nowMs >= occMs - closeMinutes * 60_000;
}

// Converge ONE (tour × card) variation. Idempotent: update the stored variation,
// else adopt one matched by our _gos_tourevent_id meta, else create. NEVER
// deletes (a disabled variation is preserved for order history).
async function reconcileCardVariation(deps, tour, card, ctx) {
  const { db, woo } = deps;
  const dateAttribute = card.dateAttribute || WOO_DATE_ATTRIBUTE();
  const desired = buildVariationPayload({
    tour,
    cardGroupId: card.cardGroupId,
    capacity: ctx.capacity,
    remaining: ctx.remaining,
    priceMinor: card.priceMinor,
    dateAttribute,
    registrationClosed: ctx.registrationClosed,
  });

  const key = { tourEventId_cardGroupId: { tourEventId: tour.id, cardGroupId: card.cardGroupId } };
  const link = await db.wooVariationLink.findUnique({ where: key });
  let variationId = link?.wooVariationId || null;

  // Adoption path — recover the id from Woo by our stable meta link.
  if (!variationId) {
    const existing = await woo.listVariations(card.wooProductId);
    const found = findVariationForTour(existing, tour.id);
    if (found) variationId = found.id;
  }

  let resultId;
  if (variationId) {
    const res = await woo.updateVariation(card.wooProductId, variationId, desired);
    resultId = res?.id ?? variationId;
  } else {
    const res = await woo.createVariation(card.wooProductId, desired);
    resultId = res?.id ?? null;
  }

  await db.wooVariationLink.upsert({
    where: key,
    create: {
      tourEventId: tour.id,
      cardGroupId: card.cardGroupId,
      wooProductId: card.wooProductId,
      wooVariationId: resultId,
      status: 'synced',
      lastError: null,
    },
    update: {
      wooProductId: card.wooProductId,
      wooVariationId: resultId ?? variationId ?? null,
      status: 'synced',
      lastError: null,
    },
  });
}

// Converge ALL of a pending tour's variations. Lost-update-safe: the final
// success/failure write is guarded on the loaded updatedAt, so a mutation during
// the Woo round-trip leaves the row pending for the next tick.
export async function reconcileTourWoo(deps, tourId) {
  const { db, woo, now = Date.now() } = deps;
  const tour = await db.tourEvent.findUnique({
    where: { id: tourId },
    select: {
      id: true,
      status: true,
      date: true,
      startTime: true,
      capacity: true,
      openTourTemplateId: true,
      updatedAt: true,
      wooSyncStatus: true,
      wooAttempts: true,
    },
  });
  if (!tour || tour.wooSyncStatus !== 'pending') return 'skipped';
  const loadedUpdatedAt = tour.updatedAt;

  const markGuarded = async (data) => {
    const res = await db.tourEvent.updateMany({ where: { id: tour.id, updatedAt: loadedUpdatedAt }, data });
    return res.count ? 'ok' : 'requeued';
  };

  const cards = await resolveSellableCards(db, tour.openTourTemplateId);
  if (!cards.length) {
    // Not sold on Woo — park as 'skipped' (a resolved, non-error terminal state).
    await markGuarded({
      wooSyncStatus: 'skipped',
      wooSyncError: null,
      wooSyncedAt: new Date(),
      wooAttempts: 0,
      wooNextRetryAt: null,
    });
    return 'skipped';
  }

  // ONE canonical capacity + remaining, shared across EVERY card on this tour
  // (so sibling ticket products can never advertise divergent stock).
  const occ = await occupancyFor(db, [tour.id]);
  const activeSeats = occ[tour.id]?.activeSeats || 0;
  const remaining = tour.capacity == null ? null : Math.max(0, tour.capacity - activeSeats);

  let closeMinutes = null;
  if (tour.openTourTemplateId) {
    const tpl = await db.openTourTemplate.findUnique({
      where: { id: tour.openTourTemplateId },
      select: { registrationCloseMinutes: true },
    });
    closeMinutes = tpl?.registrationCloseMinutes ?? null;
  }
  const registrationClosed = occurrenceClosed(tour.date, tour.startTime, closeMinutes, now);
  const ctx = { capacity: tour.capacity, remaining, registrationClosed };

  const errors = [];
  for (const card of cards) {
    try {
      await reconcileCardVariation(deps, tour, card, ctx);
    } catch (e) {
      errors.push(`${card.cardGroupId}: ${e.message}`);
      await db.wooVariationLink
        .updateMany({
          where: { tourEventId: tour.id, cardGroupId: card.cardGroupId },
          data: { status: 'failed', lastError: e.message },
        })
        .catch(() => {});
    }
  }

  if (!errors.length) {
    return markGuarded({
      wooSyncStatus: 'synced',
      wooSyncedAt: new Date(),
      wooSyncError: null,
      wooAttempts: 0,
      wooNextRetryAt: null,
    });
  }

  const attempts = (tour.wooAttempts || 0) + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  return markGuarded({
    wooSyncStatus: exhausted ? 'failed' : 'pending',
    wooSyncError: errors.join('\n'),
    wooAttempts: attempts,
    wooNextRetryAt: exhausted ? null : new Date(now + backoffMs(attempts)),
  });
}

// Backfill: any never-considered sellable slot (wooSyncStatus IS NULL) from today
// on becomes pending — covers generation with zero per-callsite code. Only slots
// whose template has a mapped card are touched.
export async function sweepUnsyncedWooTours(db, { today = israelToday() } = {}) {
  const templateIds = await mappedTemplateIds(db);
  if (!templateIds.length) return 0;
  const res = await db.tourEvent.updateMany({
    where: {
      wooSyncStatus: null,
      kind: 'group_slot',
      status: 'scheduled',
      date: { gte: today },
      openTourTemplateId: { in: templateIds },
    },
    data: { wooSyncStatus: 'pending' },
  });
  return res.count;
}

// ── Worker loop (mirrors the calendar worker) ────────────────────────────────

let started = false;
let inFlight = false;
let runTick = null;
let kickTimer = null;
let kickAgain = false;

export function kickWooSync(delayMs = 1500) {
  if (!runTick) return; // worker not started (tests / one-off scripts)
  if (inFlight) {
    kickAgain = true;
    return;
  }
  if (kickTimer) return; // already armed — debounce a burst
  kickTimer = setTimeout(() => {
    kickTimer = null;
    runTick();
  }, delayMs);
  kickTimer.unref?.();
}

export function startWooSyncWorker(log = console) {
  if (started) return;
  started = true;
  const deps = { db: prisma, woo: realWoo, log };

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!wooConfigured()) return; // no-op until WOO_* env is set

      const swept = await sweepUnsyncedWooTours(prisma);
      if (swept) log?.log?.(`[woo-sync] backfill: marked ${swept} tours pending`);

      const due = {
        wooSyncStatus: 'pending',
        OR: [{ wooNextRetryAt: null }, { wooNextRetryAt: { lte: new Date() } }],
      };
      if ((await prisma.tourEvent.count({ where: due })) === 0) return;

      const tours = await prisma.tourEvent.findMany({
        where: due,
        orderBy: { updatedAt: 'asc' },
        take: MAX_TOURS_PER_TICK,
        select: { id: true },
      });
      for (const t of tours) await reconcileTourWoo(deps, t.id);
    } catch (e) {
      log?.warn?.('[woo-sync] worker tick failed:', e?.message);
    } finally {
      inFlight = false;
      if (kickAgain) {
        kickAgain = false;
        kickWooSync(500);
      }
    }
  };

  runTick = tick;
  setInterval(tick, TICK_MS).unref?.();
}
