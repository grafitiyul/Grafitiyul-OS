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
    saturday_surcharge: () => 'תוספת שבת',
    holiday_surcharge: () => 'תוספת חג',
    subtotal: 'סכום ביניים לפני מע״מ',
    vat: (rate) => (rate != null ? `מע״מ (${rate}%)` : 'מע״מ'),
    vatExempt: 'פטור ממע״מ',
    total: 'סה״כ צפוי להזמנה',
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
    saturday_surcharge: () => 'Saturday surcharge',
    holiday_surcharge: () => 'Holiday surcharge',
    subtotal: 'Subtotal before VAT',
    vat: (rate) => (rate != null ? `VAT (${rate}%)` : 'VAT'),
    vatExempt: 'VAT exempt',
    total: 'Expected total for this reservation',
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

// One row → { label, amountText }. quantity > 1 renders the explicit
// multiplication "qty × unit = total"; quantity ≤ 1 (or structural null)
// renders one clean amount. Business-labeled generic surcharges ('surcharge',
// 'ticket') keep their catalog label.
export function pricingRowText(row, lang) {
  const t = pricingT(lang);
  const label =
    typeof t[row.type] === 'function'
      ? t[row.type](row.threshold != null ? row.threshold.toLocaleString(lang === 'en' ? 'en-US' : 'he-IL') : '')
      : row.labelHe || '';
  const qty = Number(row.quantity) || 0;
  const amountText =
    qty > 1
      ? `${qty} × ${formatMinor(row.unitAmountMinor)} = ${formatMinor(row.totalMinor)}`
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
