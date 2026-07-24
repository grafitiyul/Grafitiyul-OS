// Localization of the SEMANTIC pricing display model — pure, testable.
// The server returns typed rows + minor amounts (see server
// pricing/pricingDisplay.js); this module turns them into Hebrew/English text.
// Nothing here computes prices — row totals and VAT come from the canonical
// engine result. New pricing cards/products localize automatically because
// only semantic types and numbers arrive.

import { formatMinor } from '../lib/money.js';

const T = {
  he: {
    title: 'מחיר לסוכנים',
    fixed_price: () => 'מחיר קבוע',
    per_participant: () => 'מחיר למשתתף',
    tier_up_to: (n) => `עד ${n} משתתפים`,
    extra_participant: () => 'כל משתתף נוסף',
    // ONE canonical label for the שבת/חג addon — a holiday is not necessarily a
    // Saturday, so both semantic types render the same combined wording. The
    // row still appears only when the engine says the surcharge applies.
    saturday_surcharge: () => 'תוספת שבת/חג',
    holiday_surcharge: () => 'תוספת שבת/חג',
    // Agent-facing hierarchy: the PRE-VAT amount is the commercial headline
    // ("צפי להזמנה זו"); VAT informs; the gross is the secondary "to pay" row.
    subtotal: 'צפי להזמנה זו',
    vat: (rate) => (rate != null ? `מע״מ (${rate}%)` : 'מע״מ'),
    vatExempt: 'פטור ממע״מ',
    total: 'סה״כ לתשלום',
    structuralHint: 'הזינו מספר משתתפים לחישוב מדויק.',
    structuralBadge: 'מבנה תמחור (לא חישוב סופי)',
    loading: 'טוען מחיר…',
    error: 'לא ניתן לטעון את המחיר כרגע.',
    fallback:
      'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.',
    degraded: 'המחיר יהיה כפי שכתוב במחירון לסוכנים.',
  },
  en: {
    title: 'Agent price',
    fixed_price: () => 'Fixed price',
    per_participant: () => 'Price per participant',
    tier_up_to: (n) => `Up to ${n} participants`,
    extra_participant: () => 'Each additional participant',
    saturday_surcharge: () => 'Saturday / Holiday surcharge',
    holiday_surcharge: () => 'Saturday / Holiday surcharge',
    subtotal: 'Expected for this reservation',
    vat: (rate) => (rate != null ? `VAT (${rate}%)` : 'VAT'),
    vatExempt: 'VAT exempt',
    total: 'Total to pay',
    structuralHint: 'Enter a participant count for an exact calculation.',
    structuralBadge: 'Pricing structure (not a final calculation)',
    loading: 'Loading price…',
    error: 'Could not load the price right now.',
    fallback:
      'Automatic price calculation is not available for this product. The price will be according to the agent price list.',
    degraded: 'The price will be according to the agent price list.',
  },
};

export const pricingT = (lang) => T[lang === 'en' ? 'en' : 'he'];

// A money amount safe to embed inside a composed math expression. he-IL
// currency formatting embeds RLM (U+200F) bidi marks before the number and the
// ₪ sign; inside "qty × unit = total" those strong RTL marks visually REORDER
// the runs (the browser painted "2 × 2,600 = 1,300" from a logically-correct
// string). Strip the invisible bidi controls and wrap the amount in an explicit
// LTR ISOLATE (U+2066…U+2069) so nothing can leak into the expression's order.
function isolatedAmount(minor) {
  const cleaned = formatMinor(minor).replace(/[\u200e\u200f\u061c]/g, '');
  return `\u2066${cleaned}\u2069`; // LRI ... PDI
}

// One row → { label, amountText }. quantity > 1 renders the explicit
// multiplication "qty × unit = total" (semantic order locked, bidi-safe);
// quantity ≤ 1 (or structural null) renders one clean amount. Business-labeled
// generic surcharges ('surcharge', 'ticket') keep their catalog label.
export function pricingRowText(row, lang) {
  const t = pricingT(lang);
  const label =
    typeof t[row.type] === 'function'
      ? t[row.type](row.threshold != null ? row.threshold.toLocaleString(lang === 'en' ? 'en-US' : 'he-IL') : '')
      : // Business-labeled rows (generic surcharge / ticket): use the catalog's
        // EN label in the English experience — never a mixed-Hebrew line.
        (lang === 'en' ? row.labelEn || row.labelHe : row.labelHe) || '';
  const qty = Number(row.quantity) || 0;
  const amountText =
    qty > 1
      ? `${qty} × ${isolatedAmount(row.unitAmountMinor)} = ${isolatedAmount(row.totalMinor)}`
      : formatMinor(row.totalMinor != null ? row.totalMinor : row.unitAmountMinor);
  return { label, amountText };
}

// Totals block → ordered rows [{ label, amountText, kind }] with the VAT-mode
// aware VAT line (included/excluded both show the engine's split; exempt shows
// the exempt state with ₪0).
export function pricingTotalsText(totals, lang) {
  const t = pricingT(lang);
  if (!totals) return [];
  const rows = [{ kind: 'subtotal', label: t.subtotal, amountText: formatMinor(totals.netMinor) }];
  if (totals.vatMode === 'exempt') {
    rows.push({ kind: 'vat', label: t.vatExempt, amountText: formatMinor(0) });
  } else {
    rows.push({ kind: 'vat', label: t.vat(totals.vatRate ?? null), amountText: formatMinor(totals.vatMinor) });
  }
  rows.push({ kind: 'total', label: t.total, amountText: formatMinor(totals.grossMinor) });
  return rows;
}
