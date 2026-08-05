// Builder line arithmetic shared by server and client — ONE home for the
// discount/credit sign rule so a discount line can never display positive on
// one surface while totalling negative on another.
//
// Consumers: pricing/builderCompose.js (the canonical composition),
// quote/importedBuilderSeed.js (migration replica of the compose loop),
// icountDocs.js (document rows), quote/composer.js (customer-facing quote
// rows), and the client Builder row display (PriceBuilderDialog).

export function lineSign(kind) {
  return kind === 'discount' || kind === 'credit' ? -1 : 1;
}

// The row's display/total amount: sign × unit × quantity. NOT a price
// calculation (no VAT) — the same frozen echo every surface shows.
export function signedLineAmountMinor({ kind, unitPriceMinor, quantity }) {
  let qty = parseInt(quantity, 10);
  if (!Number.isFinite(qty) || qty < 0) qty = 1;
  return lineSign(kind) * (Number(unitPriceMinor) || 0) * qty;
}
