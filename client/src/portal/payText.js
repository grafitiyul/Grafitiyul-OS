import { formatMinor } from '../lib/money.js';

// Payroll line/summary wording for the Guide Portal.
//
// Every function takes the portal string registry (`t.pay`) so there is exactly
// one place where these sentences are written per language — this module holds
// the RULES (singular/plural, when a rate breakdown may be shown), never the
// words.
//
// Note on the DATA: payroll component names, activity titles and unit nouns are
// bilingual columns now (PayrollComponent.nameEn, PayrollActivity.titleEn,
// GeneralActivityType.unitLabel*En). The SERVER resolves them to the reading
// guide's language before they reach this file, so nothing here inspects a
// language-specific field or translates anything.

// The waiting card counts ACTIVITIES awaiting the guide's action; it never
// shows their monetary total.
export function waitingLabel(count, t) {
  if (count === 0) return t.waitingNone;
  if (count === 1) return t.waitingOne;
  return t.waitingMany(count);
}

// A quantity without noisy trailing zeros: 1.5 → "1.5", 2 → "2", 1.25 → "1.25".
export function formatQuantity(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return Number(num.toFixed(2)).toString();
}

// The canonical rate × quantity breakdown for one payroll line, e.g.
// "₪40 לשעה × 1.5 שעות" (or "₪40 × 1.5" when the activity type has no unit
// noun), or null when the line is a direct amount (tour base/travel, manual
// rows) OR an office override made the stored rate × quantity no longer equal
// the paid amount. This NEVER re-derives business logic — it only formats
// values the payroll engine already produced (quantity, unitPriceMinor) plus
// the unit noun configured on the activity type, and only while they still
// reconcile with the amount actually paid.
//
//   quantity === 1 → singular noun ("1 שעה"); otherwise plural ("1.5 שעות").
//   rate noun is always the singular ("₪40 לשעה"). Missing nouns degrade
//   gracefully to the bare multiplier.
//
// The "ל" rate preposition only works glued to a Hebrew noun, so the English
// form uses "per": "₪40 per hour × 1.5 hours". The noun itself is DATA the
// server already resolved — this only picks the connecting word.
export function lineCalcLabel(line, lang = 'he') {
  const { unitPriceMinor, quantity, amountMinor, unitLabelSingular, unitLabelPlural } = line || {};
  if (unitPriceMinor == null || quantity == null) return null;
  if (Math.round(Number(unitPriceMinor) * Number(quantity)) !== Number(amountMinor)) return null;

  const qty = formatQuantity(quantity);
  const rate = formatMinor(unitPriceMinor);
  const singular = String(unitLabelSingular || '').trim();
  const plural = String(unitLabelPlural || '').trim();
  if (!singular && !plural) return `${rate} × ${qty}`;

  const qtyNoun = Number(quantity) === 1 ? singular || plural : plural || singular;
  const ratePart = singular
    ? (lang === 'en' ? `${rate} per ${singular}` : `${rate} ל${singular}`)
    : rate;
  return `${ratePart} × ${qty} ${qtyNoun}`.trim();
}

// User-facing label for a payroll component in the guide portal. Tours show
// "קיזוז" for the deduction component historically named "ניכוי" — a display
// relabel only; the stored componentNameHe and the accounting concept are
// unchanged. The rule is defined over the HEBREW stored name and has no English
// counterpart, so it applies regardless of the reader's language.
export function lineDisplayName(name, sourceType, t) {
  if (sourceType === 'tour_event' && name === t.deductionStoredName) {
    return t.deductionDisplayName;
  }
  return name;
}
