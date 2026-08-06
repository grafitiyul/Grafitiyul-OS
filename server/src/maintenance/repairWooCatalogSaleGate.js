import { woo as realWoo, wooConfigured } from '../tours/woo/wooClient.js';
import { isSentinelWooPrice } from '../tours/woo/sellability.js';
import { HIDDEN_VISIBILITY } from '../tours/woo/productSaleState.js';
import { DISABLED_VARIATION_STATUS } from '../tours/woo/desiredState.js';

// Enforce the canonical sale-enable invariant across the LIVE catalog, ONCE:
//
//   GOS explicitly enabled for public sale (an ACTIVE WooProductMapping)
//   AND at least one valid sellable instance
//   → may be purchasable.  Otherwise → not purchasable, no customer price.
//
// Found in production on 06.08.2026: Woo product 171 "סיור גרפיטי בחיפה" was
// published, catalog-visible and PURCHASABLE with zero GOS mappings and zero
// GOS variation links — a product GOS never approved for sale. Its single
// purchasable child (variation 1064) carried regular_price 100000, which the
// PUBLIC Store API served to every visitor as "100,000.00 ₪".
//
// SCOPE IS DELIBERATELY NARROW. This does not roam the catalog hiding every
// product GOS does not map — an ungoverned product that is already unpurchasable
// and price-less harms nobody, and silently hiding it would be GOS seizing
// control of a store surface it does not own. A product is corrected ONLY when
// it is ungoverned AND actually violating: purchasable, or publicly showing a
// placeholder price. (Products 169 + 170 are ungoverned, unpurchasable and
// price-less — deliberately left exactly as they are.)
//
// NOTHING IS DELETED. Products, variations, attributes, WooProductMapping and
// WooVariationLink rows all survive untouched; the correction is two reversible
// Woo flags (catalog_visibility, variation status). Re-activation is the normal
// path: map the product in GOS, publish a sellable occurrence, and the standard
// reconciler puts it back.

const KEY = 'woo_catalog_sale_gate_v1';
const STALE_MS = 15 * 60 * 1000;

/** PURE. Is this ungoverned product actually violating the invariant? */
export function catalogViolation({ product, variations }) {
  const sentinelVariations = (variations || []).filter(
    (v) => v.status === 'publish' && isSentinelWooPrice(v.regular_price ?? v.price),
  );
  const purchasable = product.purchasable === true;
  const showsSentinelPrice = sentinelVariations.length > 0 || isSentinelWooPrice(product.price);
  if (!purchasable && !showsSentinelPrice) return null;
  return {
    productId: product.id,
    name: product.name,
    purchasable,
    price: product.price ?? null,
    catalogVisibility: product.catalog_visibility,
    sentinelVariationIds: sentinelVariations.map((v) => v.id),
    reasons: [
      ...(purchasable ? ['purchasable_without_gos_approval'] : []),
      ...(showsSentinelPrice ? ['placeholder_price_visible_to_customers'] : []),
    ],
  };
}

/** The core. deps: { woo, log, dryRun }. Returns a full, auditable summary. */
export async function repairWooCatalogSaleGate(client, woo, { log = console, dryRun = false } = {}) {
  const mappings = await client.wooProductMapping.findMany({ where: { active: true } });
  const governedProductIds = new Set(mappings.map((m) => m.wooProductId));

  const products = [];
  for (let page = 1; ; page += 1) {
    const batch = await woo.listProducts({ per_page: 100, page, status: 'any' });
    products.push(...batch);
    if (batch.length < 100) break;
  }

  const inspected = [];
  const corrected = [];
  for (const product of products) {
    const governed = governedProductIds.has(product.id);
    if (governed) {
      inspected.push({ productId: product.id, name: product.name, governed: true, action: 'none' });
      continue;
    }
    const variations = product.type === 'variable' ? await woo.listVariations(product.id) : [];
    const violation = catalogViolation({ product, variations });
    if (!violation) {
      inspected.push({ productId: product.id, name: product.name, governed: false, action: 'none' });
      continue;
    }

    // 1. Kill the customer-facing placeholder price at its source: draft the
    //    variation(s) carrying it. Drafting (not deleting, not re-pricing)
    //    preserves the row and every order reference, and invents no price.
    const draftedVariationIds = [];
    for (const variationId of violation.sentinelVariationIds) {
      if (!dryRun) {
        await woo.updateVariation(product.id, variationId, {
          status: DISABLED_VARIATION_STATUS,
          manage_stock: true,
          stock_quantity: 0,
          stock_status: 'outofstock',
        });
      }
      draftedVariationIds.push(variationId);
    }

    // 2. Remove it from the public catalog and shop listings. The product and
    //    its page survive; it simply is not offered for sale.
    if (!dryRun) await woo.updateProduct(product.id, { catalog_visibility: HIDDEN_VISIBILITY });

    corrected.push({ ...violation, draftedVariationIds, catalogVisibilityAfter: HIDDEN_VISIBILITY });
    log?.log?.(
      `[maintenance:${KEY}]${dryRun ? ' DRY-RUN' : ''} product ${product.id} "${product.name}": ` +
        `${violation.reasons.join('+')} → catalog_visibility=hidden, ` +
        `drafted variation(s) [${draftedVariationIds.join(', ')}]`,
    );
    inspected.push({ productId: product.id, name: product.name, governed: false, action: 'corrected' });
  }

  return { ok: true, dryRun, governed: [...governedProductIds], inspected, corrected };
}

export async function runWooCatalogSaleGateOnce(client, deps = {}, log = console) {
  const woo = deps.woo || realWoo;
  const configured = deps.wooConfigured ? deps.wooConfigured() : wooConfigured();
  if (!configured) {
    log?.warn?.(`[maintenance:${KEY}] skipped — Woo not configured`);
    return { skipped: true, reason: 'woo_not_configured' };
  }
  await client.maintenanceJob.upsert({ where: { key: KEY }, create: { key: KEY }, update: {} });
  const staleBefore = new Date(Date.now() - STALE_MS);
  const claimed = await client.maintenanceJob.updateMany({
    where: {
      key: KEY,
      OR: [{ status: 'pending' }, { status: 'failed' }, { status: 'running', startedAt: { lt: staleBefore } }],
    },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!claimed.count) return { skipped: true };

  try {
    const summary = await repairWooCatalogSaleGate(client, woo, { log });
    await client.maintenanceJob.update({
      where: { key: KEY },
      data: { status: 'done', finishedAt: new Date(), summary, error: null },
    });
    log?.log?.(
      `[maintenance:${KEY}] done — corrected ${summary.corrected.length} product(s): ` +
        JSON.stringify(summary.corrected.map((c) => ({ id: c.productId, reasons: c.reasons }))),
    );
    return { done: true, summary };
  } catch (e) {
    await client.maintenanceJob
      .update({ where: { key: KEY }, data: { status: 'failed', error: String(e?.message || e) } })
      .catch(() => {});
    log?.warn?.(`[maintenance:${KEY}] FAILED: ${e?.message || e}`);
    return { failed: true };
  }
}

export function startWooCatalogSaleGate(client, log = console) {
  runWooCatalogSaleGateOnce(client, {}, log).catch((e) =>
    log?.warn?.(`[maintenance:${KEY}] runner error: ${e?.message || e}`),
  );
}
