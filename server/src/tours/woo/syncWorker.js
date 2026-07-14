import { prisma } from '../../db.js';
import { israelToday } from '../slotGeneration.js';
import { occupancyFor } from '../occupancy.js';
import { woo as realWoo, wooSyncActive, wooSyncBulkEnabled, WOO_DATE_ATTRIBUTE } from './wooClient.js';
import {
  buildVariationPayload,
  buildOccurrenceVariations,
  findVariationForVariant,
  dateTermName,
  dateTermSlug,
  timeTermName,
  timeTermSlug,
  durationKey,
  DISABLED_VARIATION_STATUS,
} from './desiredState.js';
import { readableSlug } from './suggestConfig.js';
import { resolveSellableCards, mappedTemplateIds } from './mapping.js';
import { reconcileProductOptions, dateMenuOrder, timeMenuOrder } from './productOptions.js';

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

// The desired variation SET for one (occurrence × card): the global model when
// the mapping carries a config, else the legacy single-variation local path.
function desiredVariationSet(tour, card, ctx) {
  if (card.config) {
    return buildOccurrenceVariations({
      tour,
      cardGroupId: card.cardGroupId,
      ticketRows: card.ticketRows || [],
      config: card.config,
      capacity: ctx.capacity,
      remaining: ctx.remaining,
      registrationClosed: ctx.registrationClosed,
      durationHours: ctx.durationHours,
    });
  }
  // Legacy/local fallback — ONE variation, one local Date attribute. It REFUSES
  // to collapse several ticket types into a single price (that would mis-sell):
  // such a card must be given a global config with a pa_גיל age split.
  const rows = card.ticketRows || [];
  if (rows.length > 1) {
    throw new Error(
      `card ${card.cardGroupId}: ${rows.length} ticket types but no Woo config to split them (age attribute)`,
    );
  }
  const payload = buildVariationPayload({
    tour,
    cardGroupId: card.cardGroupId,
    capacity: ctx.capacity,
    remaining: ctx.remaining,
    priceMinor: rows[0]?.unitPriceMinor ?? null,
    dateAttribute: card.dateAttribute || WOO_DATE_ATTRIBUTE(),
    registrationClosed: ctx.registrationClosed,
  });
  return [
    { variantKey: 'default', ticketTypeId: rows[0]?.ticketTypeId || null, priceMinor: rows[0]?.unitPriceMinor ?? null, payload },
  ];
}

// Ensure the GLOBAL-taxonomy occurrence terms exist (GOS owns the dates; Woo
// won't auto-create terms) and that the date term is selectable on the product.
// New date/time terms are created WITH a chronological menu_order (yyyymmdd /
// hhmm) — the storefront orders every attribute by term menu_order, so a fresh
// occurrence lands in its chronological slot instead of lexicographic name order.
async function ensureOccurrenceTerms(woo, card, tour, durationHours = null) {
  const cfg = card.config;
  if (!cfg || !tour.date || !tour.startTime) return;
  const wants = [];
  if (cfg.date?.attrId != null) {
    wants.push({
      node: cfg.date,
      name: dateTermName(tour.date),
      slug: dateTermSlug(tour.date),
      menuOrder: dateMenuOrder(dateTermName(tour.date)),
      attach: true,
    });
  }
  if (cfg.time?.attrId != null) {
    wants.push({
      node: cfg.time,
      name: timeTermName(tour.startTime),
      slug: timeTermSlug(tour.startTime),
      menuOrder: timeMenuOrder(timeTermName(tour.startTime)),
      attach: false,
    });
  }
  // Duration term (pa_משך): the option is the readable slug; find the real term
  // by that slug so the product-option attach uses the correct NAME.
  if (cfg.duration?.attrId != null && durationHours != null) {
    const option = cfg.duration.map?.[durationKey(durationHours)];
    if (option) wants.push({ node: cfg.duration, name: option, slug: option, attach: true, byOption: true });
  }
  for (const w of wants) {
    const terms = await woo.listAttributeTerms(w.node.attrId);
    let term = (terms || []).find(
      (t) => t.slug === w.slug || t.name === w.name || (w.byOption && readableSlug(t.name) === w.slug),
    );
    if (!term) {
      term = await woo.createAttributeTerm(w.node.attrId, {
        name: w.name,
        slug: w.slug,
        ...(w.menuOrder != null ? { menu_order: w.menuOrder } : {}),
      });
    }
    if (w.attach) await ensureProductHasOption(woo, card.wooProductId, w.node, term?.name || w.name);
  }
}

// Append a term to the product's global-attribute options (product options carry
// term NAMES) so the frontend date picker offers it. Idempotent no-op if present.
async function ensureProductHasOption(woo, productId, dateCfg, termName) {
  const product = await woo.getProduct(productId);
  const attrs = product.attributes || [];
  const idx = attrs.findIndex((a) => a.id === dateCfg.attrId || a.name === dateCfg.attrName);
  if (idx === -1) return; // product doesn't expose this attribute — nothing to attach
  const options = attrs[idx].options || [];
  if (options.includes(termName)) return;
  const nextAttrs = attrs.map((a, i) => (i === idx ? { ...a, options: [...options, termName] } : a));
  await woo.updateProduct(productId, { attributes: nextAttrs });
}

// Disable (never delete) a variation: out of the storefront + zero stock,
// unpurchasable. Used for cancellation is handled by the desired payload; this
// is for RETIRING a variation we no longer produce (a dropped ticket type, or
// the old product after a mapping change) so no orphan stays sellable.
async function disableVariation(deps, productId, variationId) {
  await deps.woo.updateVariation(productId, variationId, {
    status: DISABLED_VARIATION_STATUS,
    manage_stock: true,
    stock_quantity: 0,
    stock_status: 'outofstock',
  });
}

// How a CREATED variation came to exist — recorded on the link (createdVia) and
// logged, so live variations are attributable: explicit sync-one, bulk
// generation, adoption of an existing Woo variation, or repair of an
// already-linked occurrence.
function creationProvenance(origin, adopted) {
  if (adopted) return 'adoption';
  if (origin === 'explicit') return 'sync_one';
  if (origin === 'bulk') return 'bulk';
  return 'repair';
}

// Converge ONE variant (one age/ticket type) of a card. Idempotent: update the
// stored variation, else adopt one matched by our stable per-variant meta, else
// create. NEVER deletes. On a mapping product change, the OLD-product variation
// is disabled first so an occurrence never has two active sellable variations.
async function reconcileVariant(deps, tour, card, desired, existing) {
  const { db, woo, log } = deps;
  const key = {
    tourEventId_cardGroupId_variantKey: {
      tourEventId: tour.id,
      cardGroupId: card.cardGroupId,
      variantKey: desired.variantKey,
    },
  };
  const link = await db.wooVariationLink.findUnique({ where: key });

  // Mapping moved to a different product → retire the old-product variation.
  if (link?.wooVariationId && link.wooProductId && link.wooProductId !== card.wooProductId) {
    await disableVariation(deps, link.wooProductId, link.wooVariationId).catch(() => {});
  }

  let variationId = link && link.wooProductId === card.wooProductId ? link.wooVariationId : null;
  let adopted = false;
  if (!variationId) {
    const found = findVariationForVariant(await existing(), tour.id, card.cardGroupId, desired.variantKey);
    if (found) {
      variationId = found.id;
      adopted = true;
    }
  }

  let resultId;
  let createdVia = null;
  if (variationId) {
    const res = await woo.updateVariation(card.wooProductId, variationId, desired.payload);
    resultId = res?.id ?? variationId;
    if (adopted) createdVia = 'adoption';
  } else {
    const res = await woo.createVariation(card.wooProductId, desired.payload);
    resultId = res?.id ?? null;
    createdVia = creationProvenance(tour.wooSyncOrigin, false);
    log?.log?.(
      `[woo-sync] created variation product=${card.wooProductId} variation=${resultId} ` +
        `tour=${tour.id} card=${card.cardGroupId} variant=${desired.variantKey} via=${createdVia}`,
    );
  }

  await db.wooVariationLink.upsert({
    where: key,
    create: {
      tourEventId: tour.id,
      cardGroupId: card.cardGroupId,
      variantKey: desired.variantKey,
      ticketTypeId: desired.ticketTypeId,
      wooProductId: card.wooProductId,
      wooVariationId: resultId,
      status: 'synced',
      // Adoption is also provenance when the LINK is new but the variation existed.
      createdVia: createdVia || creationProvenance(tour.wooSyncOrigin, adopted),
      lastError: null,
    },
    update: {
      ticketTypeId: desired.ticketTypeId,
      wooProductId: card.wooProductId,
      wooVariationId: resultId ?? variationId ?? null,
      status: 'synced',
      lastError: null,
      // createdVia deliberately NOT updated — creation provenance is immutable.
    },
  });
}

// Retire links whose variant is no longer produced (a removed ticket type). The
// variation is DISABLED (private/0), never deleted, and the link kept as a
// historical 'disabled' record.
async function retireStaleVariants(deps, tour, card, desiredKeys) {
  const { db } = deps;
  const links = await db.wooVariationLink.findMany({
    where: { tourEventId: tour.id, cardGroupId: card.cardGroupId },
  });
  for (const link of links || []) {
    if (desiredKeys.has(link.variantKey) || link.status === 'disabled') continue;
    if (link.wooVariationId) await disableVariation(deps, link.wooProductId, link.wooVariationId).catch(() => {});
    await db.wooVariationLink.updateMany({
      where: { tourEventId: tour.id, cardGroupId: card.cardGroupId, variantKey: link.variantKey },
      data: { status: 'disabled', lastError: null },
    });
  }
}

// Converge ALL variations of one card for a tour (one per ticket type/age).
async function reconcileCard(deps, tour, card, ctx) {
  const { woo } = deps;
  const desired = desiredVariationSet(tour, card, ctx);
  await ensureOccurrenceTerms(woo, card, tour, ctx.durationHours);

  // Lazily fetch the product's variations once for the adoption path.
  let cache = null;
  const existing = async () => (cache ||= await woo.listVariations(card.wooProductId));

  for (const d of desired) await reconcileVariant(deps, tour, card, d, existing);
  await retireStaleVariants(deps, tour, card, new Set(desired.map((d) => d.variantKey)));
}

// Converge ALL of a pending tour's variations. Lost-update-safe: the final
// success/failure write is guarded on the loaded updatedAt, so a mutation during
// the Woo round-trip leaves the row pending for the next tick.
export async function reconcileTourWoo(deps, tourId) {
  const { db, woo, log, now = Date.now() } = deps;
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
      wooSyncOrigin: true,
      wooAttempts: true,
      wooDesiredRevision: true,
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

  // FIRST-PUBLICATION GATE. WOO_SYNC_ENABLED alone allows converging occurrences
  // that are ALREADY linked (update/cancel/reopen/repair) and explicit sync-one.
  // Automatically publishing a NEVER-linked occurrence is BULK behaviour: it
  // requires WOO_SYNC_BULK_ENABLED, no matter who marked the tour pending — so a
  // maintenance/repair job that marks tours pending can never silently become a
  // bulk-publication mechanism. Blocked tours are parked back to NULL (with the
  // reason recorded), so enabling bulk later sweeps them in normally.
  const linkCount = await db.wooVariationLink.count({ where: { tourEventId: tour.id } });
  if (!linkCount && !wooSyncBulkEnabled() && tour.wooSyncOrigin !== 'explicit') {
    log?.log?.(
      `[woo-sync] BLOCKED first-time publication tour=${tour.id} date=${tour.date} ` +
        `(origin=${tour.wooSyncOrigin || 'auto'}, bulk off) — explicit sync-one or WOO_SYNC_BULK_ENABLED required`,
    );
    await markGuarded({
      wooSyncStatus: null,
      wooSyncError: 'first_publication_blocked: bulk sync off and not explicitly requested',
      wooAttempts: 0,
      wooNextRetryAt: null,
    });
    return 'blocked';
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
      // Customer-facing duration is PER CARD (the card's own product variant),
      // never the tour's operational duration: the same occurrence sells a
      // 1.5h tour-only card next to a 2.5h tour+workshop card.
      await reconcileCard(deps, tour, card, { ...ctx, durationHours: card.durationHours ?? null });
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
    // Stamp the revision we synced. The updateMany is GUARDED on the loaded
    // updatedAt, so if any mutation raced this sync (bumping wooDesiredRevision +
    // updatedAt) the guard fails and the tour stays pending — desired can never be
    // recorded as synced when it changed underneath us.
    return markGuarded({
      wooSyncStatus: 'synced',
      wooSyncedAt: new Date(),
      wooSyncError: null,
      wooAttempts: 0,
      wooNextRetryAt: null,
      wooSyncedRevision: tour.wooDesiredRevision,
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
    // 'bulk' provenance: the sweep only runs when WOO_SYNC_BULK_ENABLED is on,
    // and variations it creates are recorded as bulk-generated.
    data: { wooSyncStatus: 'pending', wooSyncOrigin: 'bulk' },
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
      if (!wooSyncActive()) return; // inert until creds AND WOO_SYNC_ENABLED are set

      // The backfill sweep is BULK behaviour — gated behind the second switch so a
      // controlled single-occurrence activation never fans out. Tours pending via
      // explicit sync-one or a single-tour edit are still processed below.
      if (wooSyncBulkEnabled()) {
        const swept = await sweepUnsyncedWooTours(prisma);
        if (swept) log?.log?.(`[woo-sync] backfill: marked ${swept} tours pending`);
      }

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

      // Keep each touched product's PUBLIC selector truthful: derive its
      // attribute options from the actual published variation set (a cancelled
      // occurrence's date disappears once no published variation uses it) and
      // keep date/time term order chronological.
      const touched = await prisma.wooVariationLink.findMany({
        where: { tourEventId: { in: tours.map((t) => t.id) } },
        select: { wooProductId: true },
        distinct: ['wooProductId'],
      });
      for (const { wooProductId } of touched) {
        await reconcileProductOptions(deps, wooProductId).catch((e) =>
          log?.warn?.(`[woo-sync] product-options reconcile failed for ${wooProductId}: ${e?.message}`),
        );
      }
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
