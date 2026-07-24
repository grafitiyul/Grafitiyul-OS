// Agent Reservations — the ONE canonical bridge from a group's FROZEN pricing
// snapshot to the Deal's primary Builder version (QuoteOffer → QuoteVersion →
// QuoteLine), plus the Deal's cached gross (Deal.valueMinor).
//
// Invariant (defects #6/#7): the price the agent accepted at submission time IS
// the Deal's Builder state. We CONSUME the already-resolved semantic result the
// reservation preview + PDF use (payloadSnapshot.pricingByGroup[i]); we NEVER
// recompute — later pricing-card edits can never change an accepted reservation.
// Every generated line is `overridden: true` and carries the provenance stamp
// RESERVATION_LINE_SOURCE, so (a) the engine never reprices it on regeneration,
// and (b) the repair path can distinguish untouched generated state from a later
// human edit.
//
// Pure mapping (builderClientLinesFromPricing) is separated from the DB write
// (writeReservationBuilder) so the mapping is unit-testable and the write is
// idempotent: a second run with an unchanged snapshot produces ZERO changes.

import { lineToData } from '../quote/quoteLineMapping.js';
import { ensureWorkingVersion } from '../quote/quoteDocument.js';

// Provenance stamp on every reservation-generated Builder line. A working
// version whose lines are ALL this source (or empty) is "untouched generated
// state" and is safe to (re)write; any other line means a human touched it.
export const RESERVATION_LINE_SOURCE = 'agent_reservation';

// Frozen display-row types (pricingDisplay.js) that describe the BASE product
// price vs a surcharge/add-on line. Base rows carry the product variant ref;
// surcharge rows become addon lines (labelled, no fragile name→id guessing).
const BASE_ROW_TYPES = new Set([
  'fixed_price',
  'per_participant',
  'tier_up_to',
  'extra_participant',
  'ticket',
]);

// Semantic Hebrew labels per row type. The base row prefers the frozen product
// display name (what the agent saw); everything else is a clear line label.
const TYPE_LABEL_HE = {
  fixed_price: 'מחיר לקבוצה',
  per_participant: 'מחיר למשתתף',
  tier_up_to: 'מחיר לקבוצה',
  extra_participant: 'משתתף נוסף',
  ticket: 'כרטיס',
  saturday_surcharge: 'תוספת שבת',
  holiday_surcharge: 'תוספת חג',
  surcharge: 'תוספת',
};

function rowLabel(row, productLabel, isFirstBase) {
  if (isFirstBase && productLabel) return String(productLabel);
  if (row.labelHe) return String(row.labelHe);
  return TYPE_LABEL_HE[row.type] || 'שורה';
}

/**
 * Map ONE group's frozen pricing result → canonical client builder-line shapes
 * (the same shape lineToData() consumes) + the Deal's cached gross.
 *
 * Only an EXACT priced result yields lines. A structural/unavailable result
 * (agent priced by the price list) legitimately has no computed total, so we
 * return priced:false and write nothing — an honest empty Builder, not a zero.
 *
 * @returns {{ lines: object[], valueMinor: number|null, priced: boolean }}
 */
export function builderClientLinesFromPricing(pricing, { productVariantId = null, productLabel = null } = {}) {
  if (!pricing || pricing.available === false || pricing.mode !== 'exact' || !pricing.totals) {
    return { lines: [], valueMinor: null, priced: false };
  }
  const rows = Array.isArray(pricing.rows) ? pricing.rows : [];
  const vatMode = pricing.totals.vatMode || 'excluded';
  const vatRate = pricing.totals.vatRate ?? 18;

  let seenBase = false;
  const lines = rows.map((row) => {
    const isBase = BASE_ROW_TYPES.has(row.type);
    const isFirstBase = isBase && !seenBase;
    if (isBase) seenBase = true;
    return {
      kind: isBase ? 'product' : 'addon',
      label: rowLabel(row, productLabel, isFirstBase),
      // refId → productVariantId (product) via lineToData; surcharge addon lines
      // stay ref-less (the frozen snapshot carries no addon id) but keep their
      // label + exact amount, so they render as structured priced lines — never
      // a misleading "טקסט חופשי" row.
      refId: isBase ? productVariantId : null,
      quantity: Math.max(1, Number(row.quantity) || 1),
      unitPriceMinor: Math.round(Number(row.unitAmountMinor) || 0),
      vatMode,
      vatRate,
      active: true,
      note: '',
      overridden: true, // FROZEN — engine must never reprice an accepted reservation
      sourceKind: RESERVATION_LINE_SOURCE,
    };
  });

  return {
    lines,
    valueMinor: Math.round(Number(pricing.totals.grossMinor) || 0),
    priced: true,
  };
}

// Compare a persisted QuoteLine row to a target create-data row for idempotency
// (the fields the mapper controls). Ignores id/timestamps so a re-run with an
// unchanged snapshot is a genuine no-op.
function sameLine(existing, target) {
  return (
    existing.kind === target.kind &&
    (existing.label || '') === (target.label || '') &&
    (existing.productVariantId || null) === (target.productVariantId || null) &&
    (existing.addonId || null) === (target.addonId || null) &&
    Number(existing.quantity) === Number(target.quantity) &&
    BigInt(existing.unitPriceMinor) === BigInt(target.unitPriceMinor) &&
    (existing.vatMode || 'inherit') === (target.vatMode || 'inherit') &&
    (existing.vatRate ?? null) === (target.vatRate ?? null) &&
    !!existing.overridden === !!target.overridden &&
    (existing.sourceKind || null) === (target.sourceKind || null) &&
    Number(existing.sortOrder) === Number(target.sortOrder)
  );
}

/**
 * Idempotently write a group's frozen pricing into its Deal's PRIMARY Builder
 * version and cache the gross on Deal.valueMinor.
 *
 * Provenance safety: if the working version already contains any line NOT
 * stamped RESERVATION_LINE_SOURCE, a human (or another system) edited the
 * Builder — we DO NOT overwrite it (returns { skipped: 'human_edited' }).
 *
 * Idempotency: when the existing generated lines + valueMinor already match the
 * target, nothing is written (returns { changed: false }).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{ changed: boolean, priced?: boolean, skipped?: string, lineCount?: number, valueMinor?: number|null }>}
 */
export async function writeReservationBuilder(tx, { dealId, pricing, productVariantId = null, productLabel = null }) {
  const { lines: clientLines, valueMinor, priced } = builderClientLinesFromPricing(pricing, {
    productVariantId,
    productLabel,
  });
  // Nothing to price (structural / price-list fallback) — leave the Builder
  // empty and the Deal value untouched. Honest, not a fabricated zero.
  if (!priced) return { changed: false, priced: false };

  const version = await ensureWorkingVersion(tx, dealId);
  const existing = await tx.quoteLine.findMany({
    where: { quoteVersionId: version.id },
    orderBy: { sortOrder: 'asc' },
  });

  // Human-edit guard: any foreign-provenance line ⇒ do not clobber.
  const foreign = existing.find((l) => (l.sourceKind || null) !== RESERVATION_LINE_SOURCE);
  if (foreign) return { changed: false, skipped: 'human_edited', priced: true };

  const targets = clientLines.map((ln, i) => ({ ...lineToData(ln, i), quoteVersionId: version.id }));

  const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { valueMinor: true } });
  const currentValue = deal?.valueMinor == null ? null : BigInt(deal.valueMinor);
  const targetValue = BigInt(Math.round(Number(valueMinor) || 0));

  const linesUnchanged =
    existing.length === targets.length && existing.every((e, i) => sameLine(e, targets[i]));
  const valueUnchanged = currentValue != null && currentValue === targetValue;

  if (linesUnchanged && valueUnchanged) {
    return { changed: false, priced: true, lineCount: targets.length, valueMinor: Number(targetValue) };
  }

  await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id } });
  if (targets.length) await tx.quoteLine.createMany({ data: targets });
  await tx.deal.update({ where: { id: dealId }, data: { valueMinor: targetValue } });

  return { changed: true, priced: true, lineCount: targets.length, valueMinor: Number(targetValue) };
}
