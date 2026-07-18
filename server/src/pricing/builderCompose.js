// Price Builder composition — pure, no Prisma/IO. Extracted from the /builder
// route so the ONE canonical calculation (used by the Deal builders AND the
// pricing simulator) is unit-testable: same inputs → byte-identical output.
//
// Composes every input line into net/vat/gross via splitVat, prices the product
// line from the engine's resolution when not overridden, echoes each line's
// structured provenance (sourceKind / sourceCardGroupId / ticketTypeId), and —
// when `applyCardNotes` is set — rebuilds card first-line notes from the
// canonical templates in `noteByCard` (see cardNotes.js for the contract).

import { splitVat } from './engine.js';
import { applyCardFirstLineNotes } from './cardNotes.js';

const SIGN = (kind) => (kind === 'discount' || kind === 'credit' ? -1 : 1);

export function composeBuilderLines({
  inputLines,
  productResolution,
  vatDefault,
  applyCardNotes = false,
  noteByCard = new Map(),
}) {
  // Compose every line into net/vat/gross. The product line uses the engine's
  // own split when resolved & not overridden; otherwise splitVat the line amount.
  let lines = (inputLines || []).map((ln) => {
    const kind = ln.kind || 'manual';
    const isProduct = kind === 'product';
    const active = ln.active !== false;
    const engineProduct = isProduct && !ln.overridden && productResolution.ok;
    // Quantity applies to EVERY line (the product line included — this was the
    // qty×price bug). Default 1 when unset.
    let quantity = parseInt(ln.quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 0) quantity = 1;

    // Per-unit price + effective VAT. The product line's unit is the engine's
    // per-unit base (rule VAT terms) unless overridden; an explicit (non-inherit)
    // VAT mode on the line wins so the toolbar VAT choice applies to it too.
    let unitPriceMinor;
    let effMode;
    let effRate;
    if (engineProduct) {
      unitPriceMinor = Number(productResolution.baseAmountMinor) || 0;
      effMode = ln.vatMode && ln.vatMode !== 'inherit' ? ln.vatMode : productResolution.vatMode;
      effRate = effMode === 'exempt' ? 0 : productResolution.vatRate != null ? productResolution.vatRate : vatDefault.rate;
    } else {
      unitPriceMinor = Number(ln.unitPriceMinor) || 0;
      effMode = !ln.vatMode || ln.vatMode === 'inherit' ? vatDefault.mode : ln.vatMode;
      effRate = effMode === 'exempt' ? 0 : ln.vatRate != null ? Number(ln.vatRate) : vatDefault.rate;
    }

    // Single, uniform calc for all lines: amount = sign × unit × quantity → VAT split.
    let net = 0;
    let vat = 0;
    let gross = 0;
    if (active) {
      const amount = SIGN(kind) * unitPriceMinor * quantity;
      const s = splitVat(amount, effMode, effRate);
      net = s.netMinor;
      vat = s.vatMinor;
      gross = s.grossMinor;
    }

    return {
      id: ln.id,
      kind,
      label: ln.label || '',
      refId: ln.refId || null,
      note: ln.note || '',
      active,
      overridden: !!ln.overridden,
      quantity,
      unitPriceMinor,
      vatMode: ln.vatMode || 'inherit',
      vatRate: ln.vatRate != null ? ln.vatRate : null,
      effectiveVatMode: effMode,
      effectiveVatRate: effRate,
      netMinor: net,
      vatMinor: vat,
      grossMinor: gross,
      // Structured provenance — which Pricing Card produced this line. The
      // engine-resolved product line is stamped with the WINNING rule's card so
      // the first-line note is assigned deterministically; other lines echo
      // whatever the caller sent (group-ticket lines carry their card already).
      sourceKind: engineProduct && productResolution.cardGroupId
        ? 'price_rule'
        : ln.sourceKind || null,
      sourceCardGroupId: engineProduct
        ? productResolution.cardGroupId || null
        : ln.sourceCardGroupId || null,
      ticketTypeId: ln.ticketTypeId || null,
      // The operator's manual card selection (input) echoes through so the
      // client round-trips it; resolution consumed it before composition.
      pinnedCardGroupId: ln.pinnedCardGroupId || null,
    };
  });

  // Canonical note rebuild — ONLY when the caller is (re)generating lines.
  // Plain recomputes (typing in the builder) echo user notes untouched.
  if (applyCardNotes) lines = applyCardFirstLineNotes(lines, noteByCard);

  const totals = lines.reduce(
    (t, l) => ({
      netMinor: t.netMinor + l.netMinor,
      vatMinor: t.vatMinor + l.vatMinor,
      grossMinor: t.grossMinor + l.grossMinor,
    }),
    { netMinor: 0, vatMinor: 0, grossMinor: 0 },
  );

  return { lines, totals };
}
