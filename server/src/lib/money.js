// Server-side money formatting for generated documents. Values are integer
// MINOR units (agorot) — the same contract as the client's lib/money.js.
//
// Deliberately NOT Intl-based: he-IL currency formatting embeds invisible RLM
// bidi marks around the number and the ₪ sign, which visually REORDER composed
// math expressions inside RTL text ("2 × ₪1,650 = ₪3,300" painted out of
// order). Documents need deterministic, mark-free LTR strings; the PDF layout
// places them on the trailing edge as their own left-to-right run.

const SYMBOLS = { ILS: '₪', USD: '$', EUR: '€' };

// 165000 -> "₪1,650" · 125050 -> "₪1,250.50" · -5000 -> "-₪50"
export function formatMinor(minor, currency = 'ILS') {
  const value = Number(minor || 0);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sym = SYMBOLS[currency] || SYMBOLS.ILS;
  return `${sign}${sym}${grouped}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

// The explicit multiplication row used across pricing displays and documents:
// semantic order LOCKED as "qty × unit = total" (a pure LTR run — no Hebrew,
// no bidi marks — so no renderer can reorder it).
export function formatQuantityRow(quantity, unitMinor, totalMinor, currency = 'ILS') {
  return `${quantity} × ${formatMinor(unitMinor, currency)} = ${formatMinor(totalMinor, currency)}`;
}
