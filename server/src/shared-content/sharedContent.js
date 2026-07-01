// Shared Content Library — Slice 1 backend foundation.
//
// Two concerns, kept separate the same way composer.js does it:
//   * PURE logic (no DB) — resolution precedence + "where used" shaping. Fully
//     unit-tested without a database.
//   * Thin client-injected loaders — read rows and delegate to the pure logic.
//
// This slice wires NOTHING into runtime (no routes, no composer change). It is the
// tested foundation the next slices build on. Nothing here copies content: every
// consumer references a SharedContent row by id (SSOT).

import { isValidSharedContentType } from './sharedContentTypes.js';

// ── PURE: resolution ─────────────────────────────────────────────────────────

// Resolve the SharedContent a variant should use for one `type`, with EXPLICIT,
// documented precedence (no hidden `||` on strings — the whole point of the audit):
//   1. an explicit variant link whose row.type === type     → via: 'variant'
//   2. the location default for that (location, type)        → via: 'location_default'
//   3. nothing                                               → via: null (caller warns)
//
// Inputs are plain arrays of SharedContent rows so this is trivially testable:
//   linkedRows        — SharedContent rows the variant links (from its join rows)
//   locationDefaults  — SharedContent rows anchored to the variant's location
// For a single-cardinality type the first match wins; callers pass rows already
// scoped to the variant / its location.
export function resolveForVariant({ linkedRows = [], locationDefaults = [] }, type) {
  const active = (r) => r && r.active !== false && r.type === type;

  const linked = linkedRows.find(active);
  if (linked) return { block: linked, via: 'variant' };

  const def = locationDefaults.find((r) => active(r) && r.isLocationDefault);
  if (def) return { block: def, via: 'location_default' };

  return { block: null, via: null };
}

// ── PURE: "where used" ───────────────────────────────────────────────────────

// Shape a "used by X variants" report from raw variant-link rows. This is a SAFETY
// mechanism: before editing shared content the admin must see every impacted
// consumer. Structured as a list of typed consumer groups so future consumers
// (deals, documents, …) slot in without changing the shape.
//
// `linkRows` = ProductVariantSharedContent rows, each including productVariant →
// product + location. `lang` picks the display side of bilingual names.
export function buildWhereUsed(linkRows = [], lang = 'he') {
  const pick = (he, en) => (lang === 'en' ? en || he : he) || null;

  const variants = linkRows
    .map((row) => {
      const v = row.productVariant;
      if (!v) return null;
      return {
        productVariantId: v.id,
        productId: v.productId ?? v.product?.id ?? null,
        productName: pick(v.product?.nameHe, v.product?.nameEn),
        locationId: v.locationId ?? v.location?.id ?? null,
        locationName: pick(v.location?.nameHe, v.location?.nameEn),
        active: v.active !== false,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        String(a.productName || '').localeCompare(String(b.productName || '')) ||
        String(a.locationName || '').localeCompare(String(b.locationName || '')),
    );

  return {
    count: variants.length,
    consumers: [{ kind: 'product_variant', items: variants }],
  };
}

// ── Client-injected loaders (thin; DB shape lives here so callers agree) ──────

const VARIANT_LINK_INCLUDE = {
  productVariant: { include: { product: true, location: true } },
};

// "Where used" for one SharedContent id. Read-only.
export async function getWhereUsed(client, sharedContentId, lang = 'he') {
  const rows = await client.productVariantSharedContent.findMany({
    where: { sharedContentId },
    include: VARIANT_LINK_INCLUDE,
  });
  return buildWhereUsed(rows, lang);
}

// Resolve one variant's Shared Content for a given type (variant link → location
// default → null). Read-only; used by the composer in a later slice.
export async function resolveVariantSharedContent(client, variantId, type) {
  if (!isValidSharedContentType(type)) return { block: null, via: null };

  const variant = await client.productVariant.findUnique({
    where: { id: variantId },
    select: { locationId: true },
  });
  if (!variant) return { block: null, via: null };

  const links = await client.productVariantSharedContent.findMany({
    where: { productVariantId: variantId, sharedContent: { type, active: true } },
    include: { sharedContent: true },
  });
  const linkedRows = links.map((l) => l.sharedContent);

  const locationDefaults = variant.locationId
    ? await client.sharedContent.findMany({
        where: { locationId: variant.locationId, type, active: true, isLocationDefault: true },
      })
    : [];

  return resolveForVariant({ linkedRows, locationDefaults }, type);
}
