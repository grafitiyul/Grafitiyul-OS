// One-time / on-demand reconciliation of already-materialized open-tour slots
// whose persisted operational product may be STALE, plus the realignment of
// stale deal-registration offerings that is the real root cause of a plain-only
// tour showing workshop.
//
// This lives OUTSIDE operationalProduct.js on purpose: it depends on
// resolveDealGroupOffering (deals/groupOffering.js), which itself imports
// deriveOperational from operationalProduct.js. Keeping the reconciler here
// breaks what would otherwise be an import cycle.

import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { CAPACITY_STATUSES } from './registrationStatus.js';
import { resolveDealGroupOffering } from '../deals/groupOffering.js';

// Re-align a tour's DEAL registrations to their deal's CANONICAL purchased
// offering. The invariant is that a registration's operational capability comes
// from the deal's Group Ticket Builder card selection (the quote lines), NOT from
// any TourEvent variant snapshot. Rows created before that invariant existed (or
// by pre-fix backfill) snapshotted the tour's THEN-current variant — so a plain
// "Graffiti Tour" deal can carry a stale WORKSHOP variant, which then makes
// derivation re-derive workshop.
//
// For each deal registration we resolve the deal's offering from its cards:
//   • has group-ticket cards → variant = dominant card variant, breakdown = cards
//   • no group-ticket cards  → fall back to deal.productVariantId (legacy single)
// and write both the variant and the ticketBreakdown. Realigning to the actual
// cards is what lets a plain-only tour finally resolve to plain even when the
// snapshot (and even deal.productVariantId) is stale workshop. Returns the count
// of registrations changed.
export async function realignDealRegistrationVariants(client, tourEventId) {
  const regs = await client.ticketRegistration.findMany({
    where: { tourEventId, status: { in: CAPACITY_STATUSES }, source: 'deal', dealId: { not: null } },
    select: { id: true, productVariantId: true, ticketBreakdown: true, dealId: true, deal: { select: { productVariantId: true } } },
  });
  let changed = 0;
  const offeringCache = new Map();
  for (const r of regs) {
    let offering = offeringCache.get(r.dealId);
    if (offering === undefined) {
      offering = await resolveDealGroupOffering(client, r.dealId);
      offeringCache.set(r.dealId, offering);
    }
    const wantVariant = offering ? (offering.productVariantId ?? null) : (r.deal?.productVariantId ?? null);
    const wantBreakdown = offering ? offering.ticketBreakdown : null;
    const variantDiffers = (r.productVariantId ?? null) !== wantVariant;
    const breakdownDiffers = offering ? !sameBreakdown(r.ticketBreakdown, wantBreakdown) : false;
    if (variantDiffers || breakdownDiffers) {
      await client.ticketRegistration.update({
        where: { id: r.id },
        data: {
          productVariantId: wantVariant,
          ...(offering ? { ticketBreakdown: wantBreakdown } : {}),
        },
      });
      changed += 1;
    }
  }
  return changed;
}

// Shallow structural comparison of two ticketBreakdown arrays (order-sensitive,
// which is fine: resolveDealGroupOffering emits a deterministic sortOrder).
function sameBreakdown(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) {
    const p = x[i] || {};
    const q = y[i] || {};
    if (
      (p.cardGroupId ?? null) !== (q.cardGroupId ?? null) ||
      (p.ticketTypeId ?? null) !== (q.ticketTypeId ?? null) ||
      (p.productVariantId ?? null) !== (q.productVariantId ?? null) ||
      (Number(p.quantity) || 0) !== (Number(q.quantity) || 0)
    ) {
      return false;
    }
  }
  return true;
}

// True when the tour's persisted product currently reads as a workshop (any
// delivered isWorkshop component). Used to LOG the tours that remain workshop
// after reconciliation (genuinely-workshop deals, or a valid manual pin), so
// production logs pinpoint them without any manual query.
async function tourShowsWorkshop(client, tourEventId) {
  const rows = await client.tourEventActivityComponent.findMany({
    where: { tourEventId },
    select: { activityComponent: { select: { isWorkshop: true } } },
  });
  return rows.some((r) => r.activityComponent?.isWorkshop);
}

// One-time SAFE reconciliation of already-materialized open-tour slots whose
// persisted operational product may be STALE (an earlier fix corrected new
// derivations but never re-ran for existing rows). Recomputes each live (non-
// cancelled/completed) group_slot from CURRENT canonical state using the ONE
// derivation path. Returns { scanned, changed, unchanged, pinnedSkipped,
// pinsCleared, regsRealigned, failed, changedIds, stillWorkshopIds }.
export async function reconcileAllOpenTourProducts(
  client,
  { force = false, realign = true, statuses = ['scheduled', 'postponed'], batchSize = 500, maxTours = 100000, log = null } = {},
) {
  const summary = {
    scanned: 0, changed: 0, unchanged: 0, pinnedSkipped: 0, pinsCleared: 0,
    regsRealigned: 0, failed: 0, changedIds: [], stillWorkshopIds: [],
  };
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
        // FIRST re-align stale deal-registration offerings (the real root cause of
        // a plain-only tour showing workshop), THEN recompute from the corrected
        // registrations.
        if (realign) summary.regsRealigned += await realignDealRegistrationVariants(client, t.id);
        res = await recomputeTourOperationalProduct(client, t.id, { force });
      } catch (e) {
        summary.failed += 1;
        log?.warn?.(`[reconcile] tour ${t.id} failed: ${e?.message || e}`);
        continue;
      }
      if (res?.pinned) {
        summary.pinnedSkipped += 1;
      } else {
        if (res?.cleared) summary.pinsCleared += 1;
        if (res?.changed) {
          summary.changed += 1;
          if (summary.changedIds.length < 200) summary.changedIds.push(t.id);
        } else {
          summary.unchanged += 1;
        }
      }
      // Observability: any tour still reading as workshop is either genuinely
      // workshop (a workshop-carded deal) or blocked by a valid pin — logged so
      // the exact ids surface in production logs.
      if (await tourShowsWorkshop(client, t.id)) {
        if (summary.stillWorkshopIds.length < 200) summary.stillWorkshopIds.push(t.id);
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize || summary.scanned >= maxTours) break;
  }
  return summary;
}
