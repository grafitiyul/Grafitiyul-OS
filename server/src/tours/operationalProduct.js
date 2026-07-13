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

// Recompute and apply a group-slot tour's operational product from its active
// registrations. No-op for non-open tours, cancelled/completed tours, or when
// the operator has manually pinned the product (productManualOverride). Runs in
// the caller's transaction; a product change marks the calendar pending and
// kicks the sync worker (post-commit). Returns the derived result or null.
export async function recomputeTourOperationalProduct(client, tourEventId) {
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
  if (tour.productManualOverride) return null;
  if (tour.status === 'cancelled' || tour.status === 'completed') return null;

  const regs = await client.ticketRegistration.findMany({
    where: { tourEventId, status: 'active', productVariantId: { not: null } },
    select: { productVariantId: true },
  });
  let variantIds = [...new Set(regs.map((r) => r.productVariantId))];

  // Zero active registrations → revert to the template's base (isDefault)
  // product, so a slot that briefly carried a workshop ticket returns to plain.
  if (!variantIds.length && tour.openTourTemplateId) {
    const base =
      (await client.openTourTemplateProduct.findFirst({
        where: { templateId: tour.openTourTemplateId, isDefault: true, productVariantId: { not: null } },
        select: { productVariantId: true },
      })) ||
      (await client.openTourTemplateProduct.findFirst({
        where: { templateId: tour.openTourTemplateId, productVariantId: { not: null } },
        orderBy: { sortOrder: 'asc' },
        select: { productVariantId: true },
      }));
    if (base?.productVariantId) variantIds = [base.productVariantId];
  }
  if (!variantIds.length) return null; // nothing to derive from — leave as-is

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
  if (!derived) return null;

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
  const compChanged = await reconcileComponents(client, tourEventId, derived.componentIds);
  if (changed) kickTourCalendarSync();

  return { ...derived, changed: changed || compChanged };
}
