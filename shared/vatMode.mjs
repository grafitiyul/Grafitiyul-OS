// THE canonical VAT-mode resolver — shared by the server (pricing engine,
// builder route, persistence) and the client (Price Builder UI).
//
// ── The model ────────────────────────────────────────────────────────────────
// VAT is an ORDER-level decision ("מחירים כולל מע״מ" / "לפני מע״מ" / "פטור"):
// it says how the amounts an operator TYPES are to be read. It is stored ONCE,
// on QuoteVersion.vatMode. A QuoteLine may still carry its own mode as an
// explicit per-line override; 'inherit' (or null) means "follow the order".
//
// Resolution order, and there is only one:
//     line override  →  order (QuoteVersion.vatMode)  →  fallback
// where `fallback` is the winning Pricing Card's own VAT terms for an
// engine-priced product line, and the PriceList default everywhere else.
//
// ── Why this file exists ─────────────────────────────────────────────────────
// Before it, the order-level mode was not stored anywhere. The Builder DERIVED
// it for display from the first line that happened to carry an explicit mode
// (`lines.find(l => l.vatMode !== 'inherit')`), and the VAT picker wrote that
// mode onto every existing line. A line added AFTERWARDS was created with
// 'inherit', which resolved to the PriceList default — 'included'. So a Builder
// configured "מחיר לפני מע״מ" silently read the next amount the operator typed
// as VAT-INCLUSIVE, mixing two VAT semantics inside one quote. Deriving state
// from the data it is supposed to govern is what made that possible; an order
// with no lines could not even hold the operator's choice.
//
// This module does not calculate anything. splitVat() in pricing/engine.js
// stays the ONE VAT calculation, and builderCompose.js stays the ONE
// composition path — they are simply told the right mode.

export const BUILDER_VAT_MODES = Object.freeze(['included', 'excluded', 'exempt']);
export const LINE_VAT_MODES = Object.freeze(['inherit', ...BUILDER_VAT_MODES]);

// 'inherit' and null both mean "no opinion of my own".
const explicit = (mode) => (BUILDER_VAT_MODES.includes(mode) ? mode : null);

/** A stored/incoming order-level mode, or null when the order has no opinion. */
export function normalizeBuilderVatMode(mode) {
  return explicit(mode);
}

/**
 * The order's canonical VAT mode — what the picker shows and what every new
 * line means. `priceListDefault` is the fallback for an order that has never
 * had a mode chosen (every version predating QuoteVersion.vatMode).
 */
export function resolveBuilderVatMode(versionVatMode, priceListDefault) {
  return explicit(versionVatMode) || explicit(priceListDefault) || 'included';
}

/**
 * The effective VAT mode of ONE line — the single decision point for "is this
 * amount net, gross, or exempt?".
 *
 * @param lineVatMode   the line's own override ('inherit' / null = none)
 * @param builderVatMode the resolved order mode (see resolveBuilderVatMode)
 * @param fallback      the engine/card mode for an engine-priced product line;
 *                      omit for every other line
 */
export function effectiveLineVatMode(lineVatMode, builderVatMode, fallback = null) {
  return explicit(lineVatMode) || explicit(builderVatMode) || explicit(fallback) || 'included';
}

/**
 * The VAT fields a NEWLY CREATED line must carry, whatever creates it (manual
 * row, product line, add-on, discount, credit, duplicate, engine regeneration).
 *
 * It is deliberately 'inherit' rather than the resolved mode: the order owns
 * the decision, so a later change of the order mode moves this line with it.
 * A creation path that needs a genuine per-line override passes it explicitly.
 */
export function newLineVat(override = null) {
  const mode = explicit(override);
  return { vatMode: mode || 'inherit', vatRate: null };
}

/** Duplicating a line must preserve its VAT meaning exactly — never re-derive it. */
export function duplicateLineVat(line) {
  return {
    vatMode: LINE_VAT_MODES.includes(line?.vatMode) ? line.vatMode : 'inherit',
    vatRate: line?.vatRate ?? null,
  };
}
