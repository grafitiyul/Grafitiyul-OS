import { api } from '../../lib/api.js';

// The ONE product↔variant↔city derivation used by every commercial-context
// surface (Deal "פרטי הסיור" card AND the parallel-offer dialog). Extracted so
// the two can never disagree.
//
// Rules (unchanged from the original Tour Details behavior):
//   * Choosing a PRODUCT auto-fills the variant + city from its first
//     (recommended) variant; no variants → both empty.
//   * Choosing a CITY resolves the matching Product×Location variant when one
//     exists; otherwise the variant is empty (a non-variant "other" city —
//     pricing resolves without a variant).

export async function productContextFor(productId) {
  if (!productId) return { variants: [], productVariantId: '', locationId: '' };
  const p = await api.products.get(productId);
  const variants = p.variants || [];
  const first = variants[0];
  return {
    variants,
    productVariantId: first ? first.id : '',
    locationId: first ? first.location?.id || first.locationId || '' : '',
  };
}

export function locationContextFor(variants, locationId) {
  const v = (variants || []).find((x) => (x.location?.id || x.locationId) === locationId);
  return { locationId: locationId || '', productVariantId: v ? v.id : '' };
}

// The pricing context handed to the Price Builder — EXACTLY the Deal card's
// shape, shared so no surface can drift:
//   * activityTypeId maps 'group' → 'public' (the catalog's public row) and is
//     resolved from a LOADED catalog. A null activityTypeId silently filters
//     activity-scoped price rules out of the engine and lets a generic
//     fixed-total rule land as the row price (the ₪95 → ₪5,900 QA bug) —
//     callers must not price before the catalog is available.
//   * NO locationId key: the engine ignores it, and the builder's save carries
//     a city only when a product change inside the builder set one.
export function priceContextFor({ productId, productVariantId, participants, activityType, organizationTypeId, organizationSubtypeId }, activityTypes) {
  const mapped = activityType === 'group' ? 'public' : activityType;
  return {
    productId: productId || null,
    productVariantId: productVariantId || null,
    activityTypeId: (activityTypes || []).find((a) => a.key === mapped)?.id || null,
    organizationTypeId: organizationTypeId || null,
    organizationSubtypeId: organizationSubtypeId || null,
    participantCount: participants === '' || participants == null ? 0 : Number(participants),
  };
}
