// Pure mapping between the client builder-line shape and QuoteLine create data.
// No Prisma / IO — kept separate from the route so it is unit-testable and so the
// STRUCTURED IDENTITY contract is enforced in one place.
//
// Identity contract: a line's identity lives ONLY in explicit fields
// (sourceKind / sourceCardGroupId / ticketTypeId). `note` is user content and is
// never read as an identifier — editing/clearing it must not change what a line is.

export const VALID_LINE_KINDS = ['product', 'addon', 'discount', 'credit', 'manual'];
export const VALID_LINE_VAT_MODES = ['inherit', 'included', 'excluded', 'exempt'];

// QuoteLine row → the client's builder line shape (generic refId).
export function toClientLine(l) {
  return {
    id: l.id,
    kind: l.kind,
    label: l.label || '',
    refId: l.kind === 'product' ? l.productVariantId : l.kind === 'addon' ? l.addonId : null,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor, // BigInt → Number via the app json replacer
    vatMode: l.vatMode || 'inherit',
    vatRate: l.vatRate ?? null,
    active: l.active,
    note: l.note || '',
    overridden: l.overridden,
    // Structured identity round-trips so the Group Ticket Builder re-hydrates rows
    // by (sourceCardGroupId, ticketTypeId) — not by parsing user content.
    sourceKind: l.sourceKind || null,
    sourceCardGroupId: l.sourceCardGroupId || null,
    ticketTypeId: l.ticketTypeId || null,
    // Manual Pricing Card selection (INPUT to resolution; sourceCardGroupId is
    // the OUTPUT provenance). Null = automatic resolution.
    pinnedCardGroupId: l.pinnedCardGroupId || null,
  };
}

// Client builder line → QuoteLine create data (validated; refId → typed FK).
export function lineToData(ln, i) {
  const kind = VALID_LINE_KINDS.includes(ln.kind) ? ln.kind : 'manual';
  const vatMode = VALID_LINE_VAT_MODES.includes(ln.vatMode) ? ln.vatMode : 'inherit';
  // Quantity applies to every line, the product line included. Default 1.
  let qty = parseInt(ln.quantity, 10);
  if (!Number.isFinite(qty) || qty < 0) qty = 1;
  const vatRateRaw = ln.vatRate;
  const vatRate =
    vatRateRaw === null || vatRateRaw === undefined || vatRateRaw === '' ? null : parseInt(vatRateRaw, 10);
  // Group Ticket Builder lines are kind='manual' (explicit price) but MUST still
  // persist their card's productVariantId — it is the SOLE input the operational
  // product derivation reads (resolveDealGroupOffering → dominant card variant).
  // Without it a workshop ticket saves with a null variant and the tour can never
  // derive workshop. Regular product lines keep carrying the variant via refId.
  const isGroupTicket = ln.sourceKind === 'group_ticket';
  return {
    kind,
    label: ln.label ? String(ln.label) : '',
    productVariantId: isGroupTicket
      ? ln.productVariantId || null
      : kind === 'product'
        ? ln.refId || null
        : null,
    addonId: kind === 'addon' ? ln.refId || null : null,
    quantity: qty,
    unitPriceMinor: BigInt(Math.round(Number(ln.unitPriceMinor) || 0)),
    vatMode,
    vatRate: Number.isFinite(vatRate) ? vatRate : null,
    active: ln.active !== false,
    // USER content — never an identifier.
    note: ln.note ? String(ln.note) : null,
    overridden: !!ln.overridden,
    // Structured identity (Group Ticket Builder). Persisted explicitly, never via
    // `note`. All optional — regular lines send none of these.
    sourceKind: ln.sourceKind ? String(ln.sourceKind) : null,
    sourceCardGroupId: ln.sourceCardGroupId ? String(ln.sourceCardGroupId) : null,
    ticketTypeId: ln.ticketTypeId ? String(ln.ticketTypeId) : null,
    pinnedCardGroupId: ln.pinnedCardGroupId ? String(ln.pinnedCardGroupId) : null,
    sortOrder: i,
  };
}
