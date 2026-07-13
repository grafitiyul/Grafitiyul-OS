import { formatMinor } from '../lib/money.js';

// Canonical Hebrew wording for the payroll summary cards — ONE place for the
// singular/plural rule (the waiting card counts ACTIVITIES awaiting the
// guide's action; it never shows their monetary total).
export function waitingLabel(count) {
  if (count === 0) return 'אין פעילויות הממתינות לאישורך';
  if (count === 1) return 'פעילות אחת ממתינה לאישורך';
  return `${count} פעילויות ממתינות לאישורך`;
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
export function lineCalcLabel(line) {
  const { unitPriceMinor, quantity, amountMinor, unitLabelSingular, unitLabelPlural } = line || {};
  if (unitPriceMinor == null || quantity == null) return null;
  if (Math.round(Number(unitPriceMinor) * Number(quantity)) !== Number(amountMinor)) return null;

  const qty = formatQuantity(quantity);
  const rate = formatMinor(unitPriceMinor);
  const singular = String(unitLabelSingular || '').trim();
  const plural = String(unitLabelPlural || '').trim();
  if (!singular && !plural) return `${rate} × ${qty}`;

  const ratePart = singular ? `${rate} ל${singular}` : rate;
  const qtyNoun = Number(quantity) === 1 ? singular || plural : plural || singular;
  return `${ratePart} × ${qty} ${qtyNoun}`.trim();
}

// User-facing label for a payroll component in the guide portal. Tours show
// "קיזוז" for the deduction component historically named "ניכוי" — a display
// relabel only; the stored componentNameHe and the accounting concept are
// unchanged.
export function lineDisplayName(name, sourceType) {
  if (sourceType === 'tour_event' && name === 'ניכוי') return 'קיזוז';
  return name;
}
