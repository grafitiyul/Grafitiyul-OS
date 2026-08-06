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
import { effectiveLineVatMode } from '../../../shared/vatMode.mjs';
import { lineSign as SIGN } from '../../../shared/lineMath.mjs';

export function composeBuilderLines({
  inputLines,
  productResolution,
  vatDefault,
  applyCardNotes = false,
  noteByCard = new Map(),
  // Deal-level discount INTENT from the Builder summary row:
  // { percent } (e.g. 10 / 7.5) or { fixedMinor } (builder-basis minor units).
  // Resolved HERE — the one calculation — into a synthetic kind:'discount'
  // line (sourceKind 'deal_discount') appended before the totals reduce. The
  // client persists that resolved line with the others on save, so documents/
  // iCount/payments keep reading stored lines untouched.
  dealDiscount = null,
}) {
  // Compose every line into net/vat/gross. The product line uses the engine's
  // own split when resolved & not overridden; otherwise splitVat the line amount.
  // Incoming deal_discount / line_discount rows are dropped first — they are
  // OUTPUT of this function (regenerated fresh from their intents below),
  // never input; keeping them would double-count when a stored row round-trips.
  let lines = (inputLines || [])
    .filter((ln) => ln.sourceKind !== 'deal_discount' && ln.sourceKind !== 'line_discount')
    .map((ln) => {
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
      // Breakdown-generated base lines (sourceKind 'price_rule_base') price at
      // the PER-UNIT base (per group / per participant) with their generated
      // quantity; legacy single-line product lines keep the full engine amount
      // at qty 1 — existing deals never change totals until regenerated.
      unitPriceMinor =
        ln.sourceKind === 'price_rule_base' && productResolution.unitBaseMinor != null
          ? Number(productResolution.unitBaseMinor) || 0
          : Number(productResolution.baseAmountMinor) || 0;
      // line override → the ORDER's mode → the winning card's own VAT terms.
      effMode = effectiveLineVatMode(ln.vatMode, vatDefault.mode, productResolution.vatMode);
      effRate = effMode === 'exempt' ? 0 : productResolution.vatRate != null ? productResolution.vatRate : vatDefault.rate;
    } else {
      unitPriceMinor = Number(ln.unitPriceMinor) || 0;
      // line override → the ORDER's mode. THE single place an entered amount is
      // decided to be net / gross / exempt (shared/vatMode.mjs).
      effMode = effectiveLineVatMode(ln.vatMode, vatDefault.mode);
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
      // Per-line discount INTENT — echoed for the client round-trip; the
      // resolved money row is synthesized below, the line itself never changes.
      discountPercent: ln.discountPercent != null ? Number(ln.discountPercent) : null,
      discountFixedMinor: ln.discountFixedMinor != null ? Number(ln.discountFixedMinor) : null,
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
        ? ln.sourceKind === 'price_rule_base'
          ? 'price_rule_base' // breakdown marker MUST survive the echo — it selects per-unit pricing
          : 'price_rule'
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

  // Per-LINE discount resolution: a line carrying an intent gets its resolved
  // kind:'discount' row synthesized DIRECTLY UNDER it (document row order),
  // split with the line's own effective VAT so proportions always hold. The
  // target line's price is untouched — clearing the intent restores it exactly.
  lines = lines.flatMap((l) => {
    const pct = Number(l.discountPercent);
    const fixed = Number(l.discountFixedMinor);
    const usePct = Number.isFinite(pct) && pct > 0;
    const base = SIGN(l.kind) * l.unitPriceMinor * l.quantity;
    const amount = usePct
      ? Math.round((base * pct) / 100)
      : Number.isFinite(fixed) && fixed > 0
        ? Math.round(fixed)
        : 0;
    if (!l.active || amount <= 0) return [l];
    const s = splitVat(-amount, l.effectiveVatMode, l.effectiveVatRate);
    return [
      l,
      {
        id: `${l.id}:discount`,
        kind: 'discount',
        label: `הנחה — ${l.label || 'שורה'}${usePct ? ` (${pct}%)` : ''}`,
        refId: null,
        note: '',
        active: true,
        overridden: false,
        quantity: 1,
        unitPriceMinor: amount,
        discountPercent: null,
        discountFixedMinor: null,
        vatMode: l.vatMode || 'inherit',
        vatRate: l.vatRate != null ? l.vatRate : null,
        effectiveVatMode: l.effectiveVatMode,
        effectiveVatRate: l.effectiveVatRate,
        netMinor: s.netMinor,
        vatMinor: s.vatMinor,
        grossMinor: s.grossMinor,
        sourceKind: 'line_discount',
        sourceCardGroupId: null,
        ticketTypeId: null,
        pinnedCardGroupId: null,
      },
    ];
  });

  // Deal-level discount resolution. Percent applies to the SIGNED builder-basis
  // sum of the active lines (engine-resolved unit prices included), so its
  // net/vat/gross are exactly percent% of theirs under a uniform VAT mode; a
  // fixed amount is taken in the same basis operators type every other price
  // in. VAT 'inherit' — the discount follows the order like any other line.
  if (dealDiscount) {
    const pct = Number(dealDiscount.percent);
    const fixed = Number(dealDiscount.fixedMinor);
    const usePct = Number.isFinite(pct) && pct > 0;
    const base = lines.reduce(
      (s, l) => (l.active ? s + SIGN(l.kind) * l.unitPriceMinor * l.quantity : s),
      0,
    );
    const amount = usePct
      ? Math.round((base * pct) / 100)
      : Number.isFinite(fixed) && fixed > 0
        ? Math.round(fixed)
        : 0;
    if (amount > 0) {
      const effMode = effectiveLineVatMode('inherit', vatDefault.mode);
      const effRate = effMode === 'exempt' ? 0 : vatDefault.rate;
      const s = splitVat(-amount, effMode, effRate);
      lines.push({
        id: 'deal_discount',
        kind: 'discount',
        label: usePct ? `הנחה ${pct}%` : 'הנחה',
        refId: null,
        note: '',
        active: true,
        overridden: false,
        quantity: 1,
        unitPriceMinor: amount,
        discountPercent: null,
        discountFixedMinor: null,
        vatMode: 'inherit',
        vatRate: null,
        effectiveVatMode: effMode,
        effectiveVatRate: effRate,
        netMinor: s.netMinor,
        vatMinor: s.vatMinor,
        grossMinor: s.grossMinor,
        sourceKind: 'deal_discount',
        sourceCardGroupId: null,
        ticketTypeId: null,
        pinnedCardGroupId: null,
      });
    }
  }

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
