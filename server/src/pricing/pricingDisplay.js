// Structured pricing DISPLAY model — pure, no IO, no rendered sentences.
//
// Rows are SEMANTIC: { type, threshold?, quantity, unitAmountMinor, totalMinor,
// scope, labelHe? } — the client/localization layer turns the type into Hebrew
// or English text and renders "qty × unit = total" when quantity > 1. Amounts
// come from the canonical engine result; nothing here recomputes pricing.
//
// Row types: fixed_price | per_participant | tier_up_to | extra_participant |
//            ticket | saturday_surcharge | holiday_surcharge | surcharge
// Scopes:    per_group | per_participant | per_order
//
// Two row builders:
//   describeApplied   — ONLY the rows that participated in the actual
//                       calculation (from the engine's breakdown). Null when
//                       the amount doesn't decompose (rare mixed-tier splits).
//   describeStructure — the card's full structure (no context): a structural
//                       preview for incomplete contexts. quantity is null —
//                       nothing was multiplied yet.

function num(v) {
  return v == null ? null : Number(v);
}

// Applied rows for an exact calculation. `engineResult` is calculate()'s output
// (breakdown + debug); `rule` is the winning PriceRule.
export function describeApplied(rule, engineResult) {
  const b = engineResult?.breakdown;
  if (!b) return null; // no faithful decomposition → caller falls back
  const d = engineResult.debug || {};
  const model = rule?.priceModel;
  const rows = [];
  const base = {
    quantity: b.unitQuantity,
    unitAmountMinor: b.unitBaseMinor,
    totalMinor: b.unitBaseMinor * b.unitQuantity,
  };
  if (model === 'fixed') {
    rows.push({ type: 'fixed_price', scope: 'per_group', ...base });
  } else if (model === 'per_head') {
    rows.push({ type: 'per_participant', scope: 'per_participant', ...base });
  } else if (model === 'tiered' || model === 'tiered_group') {
    rows.push({ type: 'tier_up_to', threshold: d.baseParticipants ?? null, scope: 'per_group', ...base });
  } else {
    return null;
  }
  // The extra-participant row appears ONLY when extras were actually charged.
  if (b.extra && b.extra.quantity > 0) {
    rows.push({
      type: 'extra_participant',
      scope: 'per_participant',
      quantity: b.extra.quantity,
      unitAmountMinor: b.extra.unitPriceMinor,
      totalMinor: b.extra.quantity * b.extra.unitPriceMinor,
    });
  }
  return rows;
}

// Structural preview of one rule (no context; quantity = null).
export function describeStructure(rule, ticketTypeNames = new Map()) {
  const rows = [];
  const model = rule?.priceModel;
  const row = (type, unit, extraFields = {}) =>
    rows.push({ type, quantity: null, unitAmountMinor: unit, totalMinor: null, ...extraFields });

  if (model === 'fixed') {
    row('fixed_price', num(rule.fixedPriceMinor) || 0, { scope: 'per_group' });
    return { priceModel: model, rows, degraded: false };
  }
  if (model === 'per_head') {
    row('per_participant', num(rule.adultPriceMinor) ?? num(rule.childPriceMinor) ?? 0, { scope: 'per_participant' });
    return { priceModel: model, rows, degraded: false };
  }
  if (model === 'tiered') {
    row('tier_up_to', num(rule.basePriceMinor) || 0, { threshold: num(rule.baseParticipants) || 0, scope: 'per_group' });
    const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
    if (perAdd > 0) row('extra_participant', perAdd, { scope: 'per_participant' });
    return { priceModel: model, rows, degraded: false };
  }
  if (model === 'tiered_group') {
    const tiers = [...(rule.tiers || [])]
      .map((t) => ({ upto: Math.max(0, num(t.uptoParticipants) || 0), total: num(t.totalPriceMinor) || 0, sort: num(t.sortOrder) || 0 }))
      .sort((a, b) => a.upto - b.upto || a.sort - b.sort);
    for (const t of tiers) row('tier_up_to', t.total, { threshold: t.upto, scope: 'per_group' });
    const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
    if (perAdd > 0) row('extra_participant', perAdd, { scope: 'per_participant' });
    return { priceModel: model, rows, degraded: rows.length === 0 };
  }
  if (model === 'ticket_types') {
    for (const p of rule.ticketPrices || []) {
      row('ticket', num(p.priceMinor) || 0, { scope: 'per_participant', labelHe: ticketTypeNames.get(p.ticketTypeId) || 'כרטיס' });
    }
    return { priceModel: model, rows, degraded: rows.length === 0, totalUnavailable: true };
  }
  return { priceModel: model || null, rows: [], degraded: true };
}

// Surcharge rows from the engine's generated auto add-on lines. The system
// שבת/חג add-on maps to the semantic saturday/holiday type from the ONE
// detector's verdict; other (business-configured) add-ons keep their catalog
// label with the generic 'surcharge' type. Quantity comes from the line (the
// engine sets it to the group count for per-group rules).
export function describeSurcharges(autoAddonLines = [], { systemAddonId = null, sabbathType = null } = {}) {
  return (autoAddonLines || []).map((l) => {
    const qty = Math.max(1, Number(l.quantity) || 1);
    const unit = Number(l.unitPriceMinor) || 0;
    const isSystem = systemAddonId && l.refId === systemAddonId;
    const type = isSystem
      ? sabbathType === 'chag' || sabbathType === 'erev_chag'
        ? 'holiday_surcharge'
        : 'saturday_surcharge'
      : 'surcharge';
    return {
      type,
      scope: 'per_group',
      quantity: qty,
      unitAmountMinor: unit,
      totalMinor: unit * qty,
      ...(type === 'surcharge' ? { labelHe: l.label || 'תוספת' } : {}),
    };
  });
}
