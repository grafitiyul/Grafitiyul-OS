import { effectiveLineVatMode, normalizeBuilderVatMode } from '../../../shared/vatMode.mjs';

// THE deal-level "is this deal VAT-exempt?" resolution for payment surfaces
// (iCount payment links, Cardcom tourist requests). It answers ONE question:
// does the working Builder price this deal with zero VAT — i.e. is
// Deal.valueMinor an exempt total rather than a VAT-inclusive gross?
//
// Resolution is the canonical order-level model (shared/vatMode.mjs):
// QuoteVersion.vatMode governs, a line's explicit mode overrides, 'inherit'
// follows the order. A deal is exempt only when EVERY active working line
// resolves exempt (a mixed order still owes VAT on some lines, and a single
// payment link cannot split it), or — for a line-less Builder — when the
// order-level mode itself is exempt.
//
// This intentionally does NOT consult the PriceList default or a pricing
// card's own VAT terms (both need extra loads and can only matter when the
// order never chose a mode — where 'not exempt' is the safe status quo).
//
// `deal.quoteVersions` must be the working version with its ACTIVE lines
// (PAYMENT_DEAL_INCLUDE / ICOUNT_DEAL_INCLUDE both load exactly that).
export function dealVatExempt(deal) {
  const version = deal?.quoteVersions?.[0] || null;
  const lines = version?.lines || [];
  if (!lines.length) return normalizeBuilderVatMode(version?.vatMode) === 'exempt';
  return lines.every((l) => effectiveLineVatMode(l.vatMode, version?.vatMode) === 'exempt');
}
