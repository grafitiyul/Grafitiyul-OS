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
