// THE canonical accounting-document VAT calculation — shared by the server
// (iCount payload + recorded amount + allocation check) and the client
// (ProduceDocumentModal preview). One function pair produces the preview AND
// the payload, so what the operator sees is BY CONSTRUCTION what iCount gets.
//
// ── The model ────────────────────────────────────────────────────────────────
// A document is edited in ONE VAT mode (the canonical order-level enum from
// vatMode.mjs — 'included' | 'excluded' | 'exempt'), defaulting to the Deal's
// working Builder mode. The mode says how the ROW AMOUNTS the operator sees
// are to be read:
//   included — row amounts are gross (VAT inside; iCount extracts it)
//   excluded — row amounts are net (VAT added on top at the given rate)
//   exempt   — no VAT at all (net = gross)
// A row may additionally carry `vatExempt: true` — a per-line exemption
// inherited from the Deal pricing (e.g. export) or from a base document's
// tax_exempt item; it wins over an included/excluded document mode.
//
// iCount receives `unitprice_incl` (the PROVEN body-auth shape — do not switch
// to net unitprice), so an excluded-mode row converts at the UNIT level:
// incl-unit = round2(unit × (1 + rate/100)), row gross = qty × incl-unit.
// The preview uses the same unit-level rounding — zero drift vs the payload.

import { normalizeBuilderVatMode } from './vatMode.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

/** A document-level VAT mode, canonicalized ('included' when unknown/absent). */
export function normalizeDocumentVatMode(mode) {
  return normalizeBuilderVatMode(mode) || 'included';
}

/**
 * One row's money under a document VAT mode.
 * Row: { quantity, unitPriceIls, vatExempt? } — unitPriceIls may be negative
 * (discount/credit lines). Returns major-unit ILS values:
 *   { unitPriceInclIls, netIls, vatIls, grossIls, exempt }
 * `unitPriceInclIls` is exactly what the iCount item's unitprice_incl gets.
 */
export function documentRowCalc(row, vatMode, ratePct) {
  const mode = normalizeDocumentVatMode(vatMode);
  const quantity = Number(row?.quantity) || 0;
  const unit = Number(row?.unitPriceIls) || 0;
  const exempt = mode === 'exempt' || !!row?.vatExempt;
  const rate = Number(ratePct) || 0;
  const amount = round2(quantity * unit);
  if (exempt) {
    return { unitPriceInclIls: round2(unit), netIls: amount, vatIls: 0, grossIls: amount, exempt: true };
  }
  if (mode === 'excluded') {
    const unitPriceInclIls = round2(unit * (1 + rate / 100));
    const grossIls = round2(quantity * unitPriceInclIls);
    return { unitPriceInclIls, netIls: amount, vatIls: round2(grossIls - amount), grossIls, exempt: false };
  }
  // 'included' — the amount already contains VAT.
  const netIls = round2(amount / (1 + rate / 100));
  return { unitPriceInclIls: round2(unit), netIls, vatIls: round2(amount - netIls), grossIls: amount, exempt: false };
}

/** Totals over a set of rows — the numbers the preview panel shows. */
export function documentTotals(rows, vatMode, ratePct) {
  let netIls = 0;
  let vatIls = 0;
  let grossIls = 0;
  for (const row of rows || []) {
    const c = documentRowCalc(row, vatMode, ratePct);
    netIls = round2(netIls + c.netIls);
    vatIls = round2(vatIls + c.vatIls);
    grossIls = round2(grossIls + c.grossIls);
  }
  return { netIls, vatIls, grossIls };
}
