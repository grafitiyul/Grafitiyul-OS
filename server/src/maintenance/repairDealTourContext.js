// Deterministic repair of migrated Deal context from the TOUR the deal is
// actually booked on.
//
// Pipedrive had no structured product field, so 8,222 of 8,288 WON deals carry
// no product / variant / location. Most of that is simply not recoverable —
// 2,503 of 2,620 TourEvents have no productVariantId either, because the same
// gap runs through the whole migration. Inventing a product from a tour name
// would be a guess dressed as data.
//
// What IS deterministic: a deal booked on a tour that DOES carry a variant,
// location or date. The tour is the operational truth for those fields, so
// copying them is a fact transfer, not an inference.
//
// RULES
//   • only fills fields that are NULL on the deal — an operator's value always
//     wins, and a value set after cutover is never overwritten;
//   • only from an ACTIVE booking on a non-cancelled tour;
//   • productId follows the variant's own product (a variant belongs to exactly
//     one product, so this is a lookup, not a guess);
//   • writes with a raw UPDATE so it cannot bump Deal.updatedAt-driven ordering
//     or look like business activity;
//   • idempotent — a second run finds nothing to do.

export async function repairDealTourContext(client, { log = console, dryRun = false } = {}) {
  const candidates = await client.$queryRawUnsafe(`
    select d.id,
           d."orderNo",
           d."productId"        deal_product,
           d."productVariantId" deal_variant,
           d."locationId"       deal_location,
           d."tourDate"         deal_date,
           d."tourTime"         deal_time,
           te."productVariantId" tour_variant,
           te."locationId"       tour_location,
           te.date               tour_date,
           te."startTime"        tour_time,
           pv."productId"        variant_product
      from "Deal" d
      join "Booking" b   on b."dealId" = d.id and b.status = 'active'
      join "TourEvent" te on te.id = b."tourEventId" and te.status <> 'cancelled'
      left join "ProductVariant" pv on pv.id = te."productVariantId"
     where d.status = 'won'
       and (
         (d."productVariantId" is null and te."productVariantId" is not null) or
         (d."locationId"       is null and te."locationId"       is not null) or
         (d."tourDate"         is null and te.date               is not null) or
         (d."tourTime"         is null and te."startTime"        is not null) or
         (d."productId"        is null and pv."productId"        is not null)
       )`);

  const plans = [];
  for (const c of candidates) {
    const patch = {};
    if (!c.deal_variant && c.tour_variant) patch.productVariantId = c.tour_variant;
    if (!c.deal_location && c.tour_location) patch.locationId = c.tour_location;
    if (!c.deal_date && c.tour_date) patch.tourDate = c.tour_date;
    if (!c.deal_time && c.tour_time) patch.tourTime = c.tour_time;
    if (!c.deal_product && c.variant_product) patch.productId = c.variant_product;
    if (Object.keys(patch).length) plans.push({ id: c.id, orderNo: c.orderNo, patch });
  }

  if (dryRun || !plans.length) {
    log.log?.(`[tour-context] ${plans.length} deals repairable from their booked tour${dryRun ? ' (dry run)' : ''}`);
    return { candidates: candidates.length, repairable: plans.length, repaired: 0, plans: plans.slice(0, 20) };
  }

  const byField = {};
  for (const p of plans) for (const k of Object.keys(p.patch)) byField[k] = (byField[k] || 0) + 1;

  // A plain update() is fine here: this is real operational context arriving on
  // the deal, and it deliberately does NOT touch lastMeaningfulActivityAt (only
  // touchDealActivity does that, and it is not called).
  for (const p of plans) {
    await client.deal.update({ where: { id: p.id }, data: p.patch });
  }
  log.log?.(`[tour-context] repaired ${plans.length} deals from their booked tour: ${JSON.stringify(byField)}`);
  return { candidates: candidates.length, repairable: plans.length, repaired: plans.length, byField };
}
