// Structured pricing DESCRIPTION — pure, no IO. Turns a resolved PriceRule into
// readable, structured rows (NOT free text and NOT a second pricing engine):
// the caller renders `{labelHe} — {money(amountMinor)}` with the app's money
// formatting. One formatter for every consumer (the agent reservation form
// today; any future read-only price display). Amounts stay in MINOR units.
//
// Supported models: fixed · per_head (per participant) · tiered (base + extra)
// · tiered_group (ladder + extra) · ticket_types (per category, structure only).
// An unrecognised-but-valid model degrades to { degraded:true, rows:[] } so the
// UI shows a safe "see agent price list" rather than misleading text.

function num(v) {
  return v == null ? null : Number(v);
}

// Structure rows for one rule. `ticketTypeNames` maps ticketTypeId → nameHe for
// the ticket_types model (optional). Returns { priceModel, rows, degraded }.
export function describeStructure(rule, ticketTypeNames = new Map()) {
  const rows = [];
  const model = rule?.priceModel;

  if (model === 'fixed') {
    rows.push({ kind: 'fixed', labelHe: 'מחיר קבוע', amountMinor: num(rule.fixedPriceMinor) || 0 });
    return { priceModel: model, rows, degraded: false };
  }

  if (model === 'per_head') {
    // Single-price per-head (the authoring UX writes child = adult).
    const per = num(rule.adultPriceMinor) ?? num(rule.childPriceMinor) ?? 0;
    rows.push({ kind: 'perParticipant', labelHe: 'מחיר למשתתף', amountMinor: per });
    return { priceModel: model, rows, degraded: false };
  }

  if (model === 'tiered') {
    const cap = num(rule.baseParticipants) || 0;
    rows.push({ kind: 'tier', labelHe: `עד ${cap} משתתפים`, amountMinor: num(rule.basePriceMinor) || 0 });
    const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
    if (perAdd > 0) rows.push({ kind: 'perExtra', labelHe: 'כל משתתף נוסף', amountMinor: perAdd });
    return { priceModel: model, rows, degraded: false };
  }

  if (model === 'tiered_group') {
    const tiers = [...(rule.tiers || [])]
      .map((t) => ({ upto: Math.max(0, num(t.uptoParticipants) || 0), total: num(t.totalPriceMinor) || 0, sort: num(t.sortOrder) || 0 }))
      .sort((a, b) => a.upto - b.upto || a.sort - b.sort);
    for (const t of tiers) rows.push({ kind: 'tier', labelHe: `עד ${t.upto} משתתפים`, amountMinor: t.total });
    const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
    if (perAdd > 0) rows.push({ kind: 'perExtra', labelHe: 'כל משתתף נוסף', amountMinor: perAdd });
    return { priceModel: model, rows, degraded: rows.length === 0 };
  }

  if (model === 'ticket_types') {
    for (const p of rule.ticketPrices || []) {
      rows.push({
        kind: 'ticket',
        labelHe: ticketTypeNames.get(p.ticketTypeId) || 'כרטיס',
        amountMinor: num(p.priceMinor) || 0,
      });
    }
    // No participant→total mapping from the reservation form; structure only.
    return { priceModel: model, rows, degraded: rows.length === 0, totalUnavailable: true };
  }

  // Valid card, unusual/unknown model: degrade safely.
  return { priceModel: model || null, rows: [], degraded: true };
}

// Surcharge rows from the engine's already-generated auto add-on lines (שבת/חג,
// weekday) — NO second detector. Each line's unitPriceMinor is the per-group
// amount (the engine sets quantity = groups), so surcharges are per-group.
export function describeSurcharges(autoAddonLines = []) {
  return (autoAddonLines || []).map((l) => ({
    kind: 'surcharge',
    labelHe: l.label || 'תוספת',
    amountMinor: Number(l.unitPriceMinor) || 0,
    perGroup: true,
  }));
}
