// Operational product derivation — a TourEvent's real operational product is a
// FUNCTION of its active ticket registrations, never a manual selection. The
// rule is generic and capability-based: each registered product contributes its
// ProductVariant's activity components; the tour delivers their UNION. There is
// NO product name/id anywhere here — "workshop vs plain" falls out only because
// the workshop product's variant carries an isWorkshop component the plain one
// does not. A future sellable product with a new capability needs zero code.
//
// Display product (title / calendar / duration): the registered variant whose
// component set COVERS the union (the richest offering) — the common case where
// base ⊂ base+workshop, so its own duration and components are authoritative.
// When offerings are genuinely divergent (no single superset), we fall back to
// the variant with the most components (then longest duration) for the title,
// while still delivering the full union of components.

import { calendarPendingPatch, kickTourCalendarSync } from './calendar/service.js';
import { markTourWooPending } from './woo/service.js';
import { CAPACITY_STATUSES } from './registrationStatus.js';

// PURE. variants: [{ id, productId, durationHours, activityComponents: [{ activityComponentId }] }]
// (one entry per DISTINCT active-registration variant). Returns
//   { displayVariantId, displayProductId, componentIds, durationHours }
// or null when there is nothing to derive from.
export function deriveOperational(variants) {
  const list = (variants || []).filter((v) => v && v.id);
  if (!list.length) return null;

  const compsOf = (v) => (v.activityComponents || []).map((c) => c.activityComponentId);
  const dur = (v) => (v.durationHours == null ? -1 : v.durationHours);

  // Union of component ids, first-seen order across the variants.
  const union = [];
  const unionSet = new Set();
  for (const v of list) {
    for (const c of compsOf(v)) {
      if (!unionSet.has(c)) {
        unionSet.add(c);
        union.push(c);
      }
    }
  }

  // A variant "covers" the union when every union component is in its own set.
  const coversUnion = (v) => {
    const s = new Set(compsOf(v));
    return [...unionSet].every((c) => s.has(c));
  };

  let display;
  const supersets = list.filter(coversUnion);
  if (supersets.length) {
    // Richest offering — longest duration breaks ties (deterministic on id).
    display = supersets.reduce((a, b) => (dur(b) > dur(a) || (dur(b) === dur(a) && b.id < a.id) ? b : a));
  } else {
    display = list.reduce((a, b) => {
      const ca = compsOf(a).length;
      const cb = compsOf(b).length;
      if (cb !== ca) return cb > ca ? b : a;
      if (dur(b) !== dur(a)) return dur(b) > dur(a) ? b : a;
      return b.id < a.id ? b : a;
    });
  }

  // Order the union with the display variant's own components first (their
  // authored order), then any extra components from divergent offerings.
  const ordered = [];
  for (const c of compsOf(display)) if (unionSet.has(c) && !ordered.includes(c)) ordered.push(c);
  for (const c of union) if (!ordered.includes(c)) ordered.push(c);

  const durationHours =
    display.durationHours != null
      ? display.durationHours
      : list.reduce((m, v) => (v.durationHours != null && v.durationHours > m ? v.durationHours : m), 0) || null;

  return {
    displayVariantId: display.id,
    displayProductId: display.productId || null,
    componentIds: ordered,
    durationHours,
  };
}

// The template's PLAIN BASE variant — the operational product of a slot with no
// workshop (0 workshop tickets → Graffiti Tour). It is the offered product whose
// variant carries NO isWorkshop component, preferring the isDefault among those.
// Falls back to isDefault/first only if EVERY offered product is a workshop one.
// This is the fix for the "empty/plain slot shows Workshop" bug: `isDefault` is
// merely "the first/flagged product" and can be the workshop variant, so the
// base must be chosen by CAPABILITY (no workshop), not by the flag alone.
export async function resolveBaseVariantId(client, templateId) {
  if (!templateId) return null;
  const products = await client.openTourTemplateProduct.findMany({
    where: { templateId, productVariantId: { not: null } },
    orderBy: { sortOrder: 'asc' },
    select: {
      isDefault: true,
      productVariantId: true,
      productVariant: {
        select: {
          activityComponents: { select: { activityComponent: { select: { isWorkshop: true } } } },
        },
      },
    },
  });
  if (!products.length) return null;
  const hasWorkshop = (p) =>
    (p.productVariant?.activityComponents || []).some((c) => c.activityComponent?.isWorkshop);
  const plain = products.filter((p) => !hasWorkshop(p));
  const pool = plain.length ? plain : products;
  return (pool.find((p) => p.isDefault) || pool[0]).productVariantId;
}

// Reconcile a tour's delivered components to `componentIds`, PRESERVING the
// workshopLocationId (operator-assigned) on components that stay. Returns true
// when the row set changed.
async function reconcileComponents(client, tourEventId, componentIds) {
  const existing = await client.tourEventActivityComponent.findMany({
    where: { tourEventId },
    select: { id: true, activityComponentId: true },
  });
  const existingIds = new Set(existing.map((e) => e.activityComponentId));
  const desiredSet = new Set(componentIds);
  const toDelete = existing.filter((e) => !desiredSet.has(e.activityComponentId));
  const toAdd = componentIds.filter((c) => !existingIds.has(c));
  let changed = false;
  if (toDelete.length) {
    await client.tourEventActivityComponent.deleteMany({ where: { id: { in: toDelete.map((d) => d.id) } } });
    changed = true;
  }
  if (toAdd.length) {
    await client.tourEventActivityComponent.createMany({
      data: toAdd.map((c) => ({ tourEventId, activityComponentId: c, sortOrder: componentIds.indexOf(c) })),
      skipDuplicates: true,
    });
    changed = true;
  }
  return changed;
}

// A manual product pin is honored ONLY when explicitly valid: the pinned variant
// must still be OFFERED by the tour's template. A stale/invalid pin (null variant
// or a variant no longer offered) is NOT silently preserved — it is cleared and
// the tour recomputed. When the tour has no template we cannot validate, so a
// pin is trusted (an operator explicitly set it on a standalone slot).
async function isPinValid(client, tour) {
  if (!tour.productVariantId) return false;
  if (!tour.openTourTemplateId) return true;
  const offered = await client.openTourTemplateProduct.findFirst({
    where: { templateId: tour.openTourTemplateId, productVariantId: tour.productVariantId },
    select: { id: true },
  });
  return Boolean(offered);
}

// FULL recomputation of a group-slot tour's operational product from CURRENT
// canonical state — not additive. It (1) reads only capacity/derivation-eligible
// active registrations, (2) unions ONLY their capabilities, (3) resolves the
// operational variant (plain base when none resolve), (4) PERSISTS the complete
// result — replacing product/variant AND the delivered components (stale workshop
// rows are removed), (5) marks the calendar + Woo mirrors dirty. No-op for
// non-open / cancelled / completed tours. A VALID manual pin short-circuits;
// `force:true` (backfill/admin) ignores the pin. Returns the result or null.
export async function recomputeTourOperationalProduct(client, tourEventId, { force = false } = {}) {
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: {
      id: true,
      kind: true,
      status: true,
      productId: true,
      productVariantId: true,
      productManualOverride: true,
      openTourTemplateId: true,
    },
  });
  if (!tour || tour.kind !== 'group_slot') return null;
  if (tour.status === 'cancelled' || tour.status === 'completed') return null;

  let pinCleared = false;
  if (tour.productManualOverride && !force) {
    if (await isPinValid(client, tour)) {
      return {
        pinned: true,
        displayVariantId: tour.productVariantId,
        displayProductId: tour.productId,
        changed: false,
      };
    }
    // Stale/invalid pin — never silently preserved. Clear it, then recompute.
    await client.tourEvent.update({ where: { id: tourEventId }, data: { productManualOverride: false } });
    pinCleared = true;
  } else if (tour.productManualOverride && force) {
    await client.tourEvent.update({ where: { id: tourEventId }, data: { productManualOverride: false } });
    pinCleared = true;
  }

  const regs = await client.ticketRegistration.findMany({
    // Held reservations participate in derivation (staff for probable arrivals).
    where: { tourEventId, status: { in: CAPACITY_STATUSES }, productVariantId: { not: null } },
    select: { productVariantId: true },
  });
  let variantIds = [...new Set(regs.map((r) => r.productVariantId))];

  // No active registration resolves to a variant (empty slot, OR the only
  // registrations are card-priced group deals with a null variant) → the slot is
  // its PLAIN base (0 workshop tickets). Resolved by capability, NOT by the
  // isDefault flag, so a plain-only slot never derives to Workshop.
  if (!variantIds.length && tour.openTourTemplateId) {
    const baseVariantId = await resolveBaseVariantId(client, tour.openTourTemplateId);
    if (baseVariantId) variantIds = [baseVariantId];
  }
  if (!variantIds.length) {
    // Nothing to derive from AND no base — leave the product, but a cleared pin
    // is still a change worth reporting.
    return pinCleared ? { pinned: false, changed: true, cleared: true } : null;
  }

  const variants = await client.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      productId: true,
      durationHours: true,
      activityComponents: { orderBy: { sortOrder: 'asc' }, select: { activityComponentId: true } },
    },
  });
  const derived = deriveOperational(variants);
  if (!derived) return pinCleared ? { pinned: false, changed: true, cleared: true } : null;

  const patch = {};
  if (derived.displayVariantId !== tour.productVariantId) patch.productVariantId = derived.displayVariantId;
  if (derived.displayProductId !== tour.productId) patch.productId = derived.displayProductId;

  let changed = false;
  if (Object.keys(patch).length) {
    // Product change is calendar-visible (title/duration) — mark pending + kick.
    Object.assign(patch, calendarPendingPatch());
    await client.tourEvent.update({ where: { id: tourEventId }, data: patch });
    changed = true;
  }
  // ALWAYS reconcile the delivered components to the derived set — this removes a
  // stale workshop component even when the product id happens to already match.
  const compChanged = await reconcileComponents(client, tourEventId, derived.componentIds);
  if (changed || compChanged || pinCleared) {
    kickTourCalendarSync();
    await markTourWooPending(client, tourEventId);
  }

  return { ...derived, pinned: false, cleared: pinCleared, changed: changed || compChanged || pinCleared };
}

// One-time SAFE reconciliation of already-materialized open-tour slots whose
// persisted operational product may be STALE (the previous fix corrected new
// derivations but never re-ran for existing rows). Recomputes each live (non-
// cancelled/completed) group_slot from CURRENT canonical state using the ONE
// canonical resolver — no business logic in raw SQL. `force:true` also recomputes
// manually pinned tours (clearing the pin). Cancelled/completed history is left
// untouched. Idempotent (a run with nothing stale changes nothing) and paged so
// it is bounded. Returns { scanned, changed, unchanged, pinnedSkipped,
// pinsCleared, failed, changedIds }.
export async function reconcileAllOpenTourProducts(
  client,
  { force = false, statuses = ['scheduled', 'postponed'], batchSize = 500, maxTours = 100000 } = {},
) {
  const summary = { scanned: 0, changed: 0, unchanged: 0, pinnedSkipped: 0, pinsCleared: 0, failed: 0, changedIds: [] };
  let cursor = null;
  for (;;) {
    const batch = await client.tourEvent.findMany({
      where: { kind: 'group_slot', status: { in: statuses } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) break;
    for (const t of batch) {
      summary.scanned += 1;
      let res;
      try {
        res = await recomputeTourOperationalProduct(client, t.id, { force });
      } catch {
        summary.failed += 1;
        continue;
      }
      if (res?.pinned) {
        summary.pinnedSkipped += 1;
        continue;
      }
      if (res?.cleared) summary.pinsCleared += 1;
      if (res?.changed) {
        summary.changed += 1;
        if (summary.changedIds.length < 200) summary.changedIds.push(t.id);
      } else {
        summary.unchanged += 1;
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize || summary.scanned >= maxTours) break;
  }
  return summary;
}
