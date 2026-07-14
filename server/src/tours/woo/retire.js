import { DISABLED_VARIATION_STATUS } from './desiredState.js';
import { reconcileProductOptions } from './productOptions.js';

// Canonical retirement of a Woo mapping. GOS is the source of truth: once a
// card→product mapping is removed, Woo has no valid source for those managed
// variations, so they MUST NOT stay purchasable. This drafts every variation the
// mapping manages (tracked via WooVariationLink), zeroes stock, marks the links
// disabled (history preserved — NEVER deleted), then reconciles the product's
// public attribute options so now-unused dates/times disappear from the
// storefront selector.
//
// Scope is exact: only variations that have a WooVariationLink for THIS
// cardGroupId on the mapping's product are touched. Legacy/manual variations (no
// link) are never touched, and a sibling card sharing the same product keeps its
// own variations published — reconcileProductOptions derives the option list from
// the still-published set, so a date used by the sibling survives.
//
// Restore: the disabled links keep their wooVariationId, so re-creating the
// mapping (PUT /woo/mappings → markCardSlotsPending → worker) re-adopts and
// republishes the SAME variations via the normal reconcile path — no duplicates.
export async function retireMapping(client, woo, cardGroupId, { log = console } = {}) {
  const mapping = await client.wooProductMapping.findUnique({ where: { cardGroupId } });
  if (!mapping) return { ok: false, error: 'mapping_not_found' };
  const productId = mapping.wooProductId;

  // Every live (non-disabled) variation this mapping manages on its product.
  const links = await client.wooVariationLink.findMany({
    where: { cardGroupId, wooProductId: productId, wooVariationId: { not: null }, status: { not: 'disabled' } },
    select: { id: true, wooVariationId: true, tourEventId: true, variantKey: true },
  });

  const disabledIds = [];
  for (const link of links) {
    try {
      // draft + 0 stock + outofstock → off the storefront, unpurchasable.
      await woo.updateVariation(productId, link.wooVariationId, {
        status: DISABLED_VARIATION_STATUS,
        manage_stock: true,
        stock_quantity: 0,
        stock_status: 'outofstock',
      });
      disabledIds.push(link.wooVariationId);
    } catch (e) {
      // A variation already gone on Woo (404) is fine — the link is still marked
      // disabled below so the record stays truthful.
      log?.warn?.(`[woo-retire] draft variation ${link.wooVariationId} failed: ${e?.message}`);
    }
  }

  // Mark the links disabled — keep wooVariationId + all history so a later
  // restore can re-adopt and republish the exact same variations.
  const marked = await client.wooVariationLink.updateMany({
    where: { cardGroupId, wooProductId: productId, status: { not: 'disabled' } },
    data: { status: 'disabled', lastError: null },
  });

  // Prune the product's public options to the still-published variation set (runs
  // while the mapping still exists, so its managed attributes are known; a sibling
  // card's published variations keep shared dates alive).
  let optionsResult = null;
  try {
    optionsResult = await reconcileProductOptions({ db: client, woo, log }, productId);
  } catch (e) {
    log?.warn?.(`[woo-retire] product-options reconcile failed for ${productId}: ${e?.message}`);
  }

  log?.log?.(
    `[woo-retire] card ${cardGroupId} product ${productId}: drafted ${disabledIds.length} variation(s), ` +
      `${marked.count} link(s) disabled, options changed=${optionsResult?.changed || false}`,
  );
  return {
    ok: true,
    productId,
    drafted: disabledIds.length,
    disabledIds,
    linksDisabled: marked.count,
    optionsChanged: optionsResult?.changed || false,
    optionsRemoved: optionsResult?.removed || {},
  };
}
