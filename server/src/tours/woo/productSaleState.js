// PRODUCT-level public sale gate — the canonical invariant.
//
//   GOS explicitly enabled for public sale
//   AND at least one valid current/future sellable instance
//   → the Woo product/variation MAY be purchasable.
//   Otherwise → not purchasable and NO customer-facing price.
//
// The storefront must never infer sale availability from a high placeholder
// price, from the mere existence of a Woo product, from leftover variations, or
// from stock alone. Production showed all four failure modes at once on Woo
// product 171 ("סיור גרפיטי בחיפה"): no GOS mapping at all, yet published,
// catalog-visible and purchasable, with a single leftover variation carrying
// regular_price 100000 that the public Store API served as "100,000.00 ₪".
//
// "GOS explicitly enabled" = an ACTIVE WooProductMapping. That is the existing
// configuration field; nothing new was invented and nothing is hardcoded per
// product.
//
// Scope note: the automatic reconciler below only ever acts on products GOS
// MAPS. It deliberately does not roam the catalog hiding products GOS does not
// own — that correction is an explicit, recorded, reviewable operation
// (maintenance/repairWooCatalogSaleGate.js), never a silent background sweep.

import { isSentinelWooPrice } from './sellability.js';

export const HIDDEN_VISIBILITY = 'hidden';
export const VISIBLE_VISIBILITY = 'visible';

/**
 * PURE. The public sale state a Woo product MUST be in.
 *   governed:              GOS has an active mapping for it
 *   sellableVariationCount: published variations backed by a sellable occurrence
 */
export function deriveProductSaleState({ governed, sellableVariationCount = 0 } = {}) {
  if (!governed) {
    return { catalogVisibility: HIDDEN_VISIBILITY, purchasable: false, reason: 'not_governed_by_gos' };
  }
  if (!sellableVariationCount) {
    return { catalogVisibility: HIDDEN_VISIBILITY, purchasable: false, reason: 'no_sellable_occurrence' };
  }
  return { catalogVisibility: VISIBLE_VISIBILITY, purchasable: true, reason: 'sellable' };
}

/**
 * PURE. Variations that are genuinely offered to a customer right now.
 *
 * Three conditions, and all three are load-bearing:
 *   * published — a draft child is off the storefront;
 *   * priced    — WooCommerce will not sell a variation with no price, so a
 *                 price-less child is not evidence of an open sale (Haifa's 48
 *                 leftover children are exactly this shape);
 *   * REAL price — a sentinel is the defect, never proof of a sale.
 */
export function countSellableVariations(variations) {
  return (variations || []).filter((v) => {
    if (v.status !== 'publish') return false;
    const price = v.regular_price ?? v.price;
    if (price == null || String(price).trim() === '') return false;
    return !isSentinelWooPrice(price);
  }).length;
}

/**
 * Converge ONE MAPPED product's catalog visibility to the canonical rule.
 * Idempotent — writes only when the visibility actually differs, so a store
 * curator's other product settings are never churned. deps: { db, woo, log }.
 *
 * Re-enabling is automatic and needs no special path: publish a sellable
 * occurrence and the next reconcile flips the product back to 'visible'.
 */
export async function reconcileProductSaleState(deps, productId) {
  const { db, woo, log } = deps;
  const mappings = await db.wooProductMapping.findMany({
    where: { wooProductId: productId, active: true },
  });
  // Not GOS-governed → this reconciler has no authority over it. (The catalog
  // audit reports such products; it does not silently hide them here.)
  if (!mappings.length) return { productId, governed: false, changed: false };

  const variations = await woo.listVariations(productId);
  const sellableVariationCount = countSellableVariations(variations);
  const desired = deriveProductSaleState({ governed: true, sellableVariationCount });

  const product = await woo.getProduct(productId);
  if (product.catalog_visibility === desired.catalogVisibility) {
    return { productId, governed: true, changed: false, sellableVariationCount, ...desired };
  }
  await woo.updateProduct(productId, { catalog_visibility: desired.catalogVisibility });
  log?.log?.(
    `[woo-sale-gate] product ${productId}: catalog_visibility ` +
      `${product.catalog_visibility} → ${desired.catalogVisibility} (${desired.reason}, ` +
      `${sellableVariationCount} sellable variation(s))`,
  );
  return { productId, governed: true, changed: true, sellableVariationCount, ...desired };
}
