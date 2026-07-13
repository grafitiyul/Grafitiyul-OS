// Reservation-hold duration: the ONE place the value+unit → milliseconds and the
// value+unit → Hebrew label are computed, shared by the server (expiry) and the
// client (payment-link modal preview), so the message text and the stored
// expiresAt can never disagree.

export const DURATION_UNITS = ['minutes', 'hours', 'days'];

export const DEFAULT_HOLD = { value: 3, unit: 'hours' };

export function durationToMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'minutes') return n * 60_000;
  if (unit === 'hours') return n * 3_600_000;
  if (unit === 'days') return n * 86_400_000;
  return null;
}

// Hebrew label, matching the product examples exactly:
//   30 דקות · שעה אחת · 3 שעות · יום אחד · 2 ימים
// (singular special-cased; two-or-more stays numeric, e.g. "2 ימים" not "יומיים").
export function durationLabelHe(value, unit) {
  const n = Number(value);
  if (unit === 'minutes') return n === 1 ? 'דקה אחת' : `${n} דקות`;
  if (unit === 'hours') return n === 1 ? 'שעה אחת' : `${n} שעות`;
  if (unit === 'days') return n === 1 ? 'יום אחד' : `${n} ימים`;
  return `${n}`;
}

// The default WhatsApp payment-link message. The duration label is interpolated
// live so it updates whenever the operator changes the hold duration.
export function defaultPaymentLinkMessage(value, unit, link = '') {
  const label = durationLabelHe(value, unit);
  const body = `המערכת שומרת לכם את המקום בסיור למשך ${label}, עד הסדרת התשלום:`;
  return link ? `${body}\n${link}` : body;
}
