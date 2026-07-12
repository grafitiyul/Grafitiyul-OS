// Payroll calculation engine — PURE functions only (pricing/engine.js
// convention): inputs in, lines/totals out, no I/O, no clock. Everything the
// service persists (calculatedMinor per line, VAT split) is produced here, so
// a stored calcSnapshot + ENGINE_VERSION reproduces every number forever.
//
// Money: BigInt-agorot columns arrive as BigInt/number — the engine works in
// Number agorot (integer) and the service persists them back. PersonProfile
// supplement fields are plain-decimal SHEKELS (Decimal(10,2)) — converted here
// at the boundary via ilsToMinor.
//
// Line semantics (schema PayrollEntryLine):
//   final        = overrideMinor ?? calculatedMinor ?? 0   (never negative input)
//   contribution = sign × final
//   VAT per line by snapshot vatMode: net → VAT added for vat_18 guides,
//   gross → already includes VAT, none → never carries VAT.

import { splitVat } from '../pricing/engine.js';

export const ENGINE_VERSION = 2;

// Canonical weekend/holiday rule: 50% of the entry's calculated base payment.
// NOT a configured fixed sum — the multiplier is the business rule.
export const WEEKEND_MULTIPLIER = 0.5;

const num = (v) => (v == null ? null : Number(v));

// The base-payment basis for a role. Variant base pay applies to the guiding
// roles; workshop assistants have no rate source in the system yet → null
// (office enters manually; percent rules have no basis either).
function baseBasisMinor(inputs = {}) {
  if (inputs.role === 'lead_guide' || inputs.role === 'guide') {
    return num(inputs.baseGuidePaymentMinor) ?? 0;
  }
  return null;
}

// Plain-decimal shekels (Prisma Decimal | string | number) → integer agorot.
export function ilsToMinor(ils) {
  if (ils == null) return null;
  const n = Number(ils);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// Calculated amount (positive agorot) for one AUTO component. Returns null
// when the system has no rate source for this context (e.g. base pay for a
// workshop assistant) — the office fills those by override; 0 means "the rule
// ran and yields nothing".
export function autoAmountMinor(component, inputs = {}) {
  const cfg = component.config || {};
  switch (component.autoRule) {
    case 'base':
      return baseBasisMinor(inputs);
    // Weekend/holiday = base × multiplier (canonically 50%), applied ONLY when
    // the existing שבת/חג detector (sabbathHolidayWindow — the ONE source of
    // truth, fed to the engine as inputs.isWeekendHoliday) says the tour
    // qualifies. The engine has NO calendar of its own. The legacy
    // 'weekend_holiday' key maps to the same rule so a lagging catalog row can
    // never resurrect a fixed-amount behavior.
    case 'weekend_holiday':
    case 'weekend_holiday_percent_of_base': {
      if (!inputs.isWeekendHoliday) return 0;
      const basis = baseBasisMinor(inputs);
      if (basis == null) return null; // no base → no automatic 50% (assistants)
      const multiplier = num(cfg.multiplier) ?? WEEKEND_MULTIPLIER;
      return Math.round(basis * multiplier);
    }
    case 'participant_bonus': {
      const from = num(cfg.fromParticipants);
      const per = num(cfg.perExtraMinor) ?? 0;
      const participants = num(inputs.participants) ?? 0;
      if (from == null || per <= 0 || participants <= from) return 0;
      return Math.round((participants - from) * per);
    }
    case 'seniority':
      return ilsToMinor(inputs.seniorityIls) ?? 0;
    case 'travel': {
      // Precedence (product rule): variant travel payment overrides the
      // guide's personal allowance; both remain editable per entry.
      const variant = num(inputs.variantTravelMinor);
      if (variant != null) return variant;
      return ilsToMinor(inputs.travelAllowanceIls) ?? 0;
    }
    case 'general_quantity': {
      const unit = num(inputs.unitPriceMinor) ?? 0;
      const qty = num(inputs.quantity) ?? 0;
      return Math.round(unit * qty);
    }
    default:
      return null;
  }
}

// Build the line set for one entry from the component catalog. `source` is
// 'tour' | 'general'; catalog scope filters which components participate.
// Every ACTIVE in-scope component gets a line — office-manual rows exist even
// at zero (the guide portal filters zero rows at display time, not here).
export function buildEntryLines({ source, components, inputs = {} }) {
  const rows = (components || [])
    .filter((c) => c.active !== false)
    .filter((c) => c.scope === 'all' || c.scope === source);
  return rows.map((c) => {
    const isGeneralQty = c.autoRule === 'general_quantity';
    return {
      componentId: c.id,
      componentNameHe: c.nameHe,
      sign: Number(c.sign) || 1,
      vatMode: c.vatMode || 'net',
      quantity: isGeneralQty ? (num(inputs.quantity) ?? 1) : null,
      unitPriceMinor: isGeneralQty ? (num(inputs.unitPriceMinor) ?? 0) : null,
      calculatedMinor: c.kind === 'auto' ? autoAmountMinor(c, inputs) : null,
      overrideMinor: null,
      sortOrder: Number(c.sortOrder) || 0,
    };
  });
}

// final = override ?? calculated ?? 0. Amounts are stored positive; direction
// comes from sign at total time. (An override MAY be negative — the office
// sometimes needs a signed correction on an "התאמה" row — final passes it
// through untouched.)
export function lineFinalMinor(line) {
  const override = num(line.overrideMinor);
  if (override != null) return Math.round(override);
  const calculated = num(line.calculatedMinor);
  if (calculated != null) return Math.round(calculated);
  return 0;
}

const VAT_MODE_TO_SPLIT = { net: 'excluded', gross: 'included', none: 'exempt' };

// Totals for one entry. VAT-exempt guides get a flat total (no VAT concept at
// all — the UI hides VAT rows entirely). vat_18 guides get net/vat/gross per
// the per-line vatMode snapshots.
export function entryTotals(lines, { vatStatus, vatRate = 18 } = {}) {
  let totalMinor = 0;
  let netMinor = 0;
  let vatMinor = 0;
  for (const line of lines || []) {
    const contribution = (Number(line.sign) || 1) * lineFinalMinor(line);
    if (vatStatus !== 'vat_18') {
      totalMinor += contribution;
      continue;
    }
    const mode = VAT_MODE_TO_SPLIT[line.vatMode] || 'excluded';
    // splitVat works on magnitudes; re-apply the contribution's direction.
    const dir = contribution < 0 ? -1 : 1;
    const split = splitVat(Math.abs(contribution), mode, vatRate);
    netMinor += dir * split.netMinor;
    vatMinor += dir * split.vatMinor;
    totalMinor += dir * split.grossMinor;
  }
  if (vatStatus !== 'vat_18') {
    return { vatStatus: vatStatus || 'exempt', totalMinor, netMinor: totalMinor, vatMinor: 0 };
  }
  return { vatStatus: 'vat_18', totalMinor, netMinor, vatMinor };
}

// Aggregate totals across entries that were each computed with their OWN VAT
// snapshot (a mixed team: exempt + vat_18 guides). Sums gross totals only —
// per-guide VAT breakdowns stay per entry, never blended.
export function sumTotals(perEntryTotals) {
  return (perEntryTotals || []).reduce((acc, t) => acc + (Number(t?.totalMinor) || 0), 0);
}

// Footer totals for the Reports table — sums the EXACT displayed row set,
// each row through its own entryTotals result (per-entry VAT snapshots; an
// exempt guide contributes net=total, vat=0 — never one global VAT rate over
// the report). Distinct people count by canonical stable identity:
// personRefId when present, otherwise the externalPersonId snapshot — the
// same person across many activities counts ONCE.
export function reportTotals(rows) {
  const distinct = new Set();
  let beforeVatMinor = 0;
  let vatMinor = 0;
  let totalMinor = 0;
  let rowCount = 0;
  for (const r of rows || []) {
    if (!r) continue;
    rowCount += 1;
    beforeVatMinor += Number(r.totals?.netMinor) || 0;
    vatMinor += Number(r.totals?.vatMinor) || 0;
    totalMinor += Number(r.totals?.totalMinor) || 0;
    distinct.add(r.personRefId ? `ref:${r.personRefId}` : `ext:${r.externalPersonId}`);
  }
  return { beforeVatMinor, vatMinor, totalMinor, distinctGuidesCount: distinct.size, rowCount };
}

// ── Office approval derivation (selective approval model) ───────────────────
// Office approval is persisted PER ENTRY (PayrollEntry.officeStatus). The
// activity office-state is DERIVED — never stored — so a second, conflicting
// truth cannot exist.
export function deriveOfficeState(entries) {
  const active = (entries || []).filter((e) => e.state === 'active');
  if (active.length === 0) return 'draft';
  const approved = active.filter((e) => e.officeStatus === 'approved').length;
  if (approved === 0) return 'draft';
  if (approved < active.length) return 'partially_approved';
  return 'office_approved';
}

// Is an entry ready for office approval? An entry with nothing to pay
// (every final resolves to 0 — e.g. an assistant whose base was never
// entered) is NOT silently approved; the caller reports it instead.
export function entryApprovable(lines) {
  return (lines || []).some((l) => lineFinalMinor(l) !== 0);
}
