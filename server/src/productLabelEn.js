import { GENERIC_PRODUCT_LINE_EN } from './displayFallbacks.js';

// THE canonical ENGLISH-STRICT product/service label for a Deal.
//
// Why this is its own resolver rather than one of the existing ones: every
// other product-name resolver in GOS (communication/variables.js,
// confirmation/variables.js, quote/composer.js) deliberately falls back to the
// Hebrew name when English is missing — correct there, because a mixed-language
// message beats an empty one. It is WRONG for the surfaces this serves: the
// Cardcom tourist payment page and the English accounting document are read by
// foreign customers, where a Hebrew string is not a degraded label but an
// unreadable one. So this resolver returns null instead of Hebrew, and the
// caller decides what to do with "no English name exists".
//
// Precedence — most specific canonical English label first:
//   1. the variant's English commercial name (ProductVariant.agentDisplayNameEn)
//      — already the customer-facing English label on agent reservation
//      documents (reservations/intake.js → ReservationGroup.productLabelEn);
//   2. the product's English name (Product.nameEn);
//   3. nothing. NEVER the Hebrew name, and NEVER Deal.title (internal CRM
//      wording — the privacy invariant, see displayFallbacks.js).
//
// Deliberately NOT included: ProductVariant.agentDisplayName and
// Product.nameHe (Hebrew), and QuoteLine.label (operator-typed, Hebrew in
// practice, and per-line rather than a product identity).

// The deal shape this needs. Compose it into a module's include — never
// hand-roll the variant selection, or the precedence silently loses step 1.
export const PRODUCT_LABEL_EN_INCLUDE = {
  product: { select: { nameHe: true, nameEn: true } },
  productVariant: { select: { agentDisplayNameEn: true } },
};

/**
 * Resolve the English-strict product label for a deal.
 * @returns {{ label: string|null, source: 'variant'|'product'|null }}
 *   `label` is null when the deal has no English product identity at all.
 */
export function resolveProductLabelEn(deal) {
  const variant = String(deal?.productVariant?.agentDisplayNameEn || '').trim();
  if (variant) return { label: variant, source: 'variant' };
  const product = String(deal?.product?.nameEn || '').trim();
  if (product) return { label: product, source: 'product' };
  return { label: null, source: null };
}

/**
 * The same resolution for surfaces that MUST render something (an issued
 * document line cannot be blank) — falls back to the approved neutral English
 * wording, never to Hebrew and never to Deal.title.
 */
export function productLineEnOrGeneric(deal) {
  return resolveProductLabelEn(deal).label || GENERIC_PRODUCT_LINE_EN;
}
