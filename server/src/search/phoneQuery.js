// Phone handling for global search.
//
// This module does NOT define a second notion of "same number" — it reuses the
// canonical normalizePhoneIntl from ../whatsapp/phone.js. Its only job is to
// turn a partially-typed SEARCH QUERY into the forms needed to find candidate
// rows in SQL, and to expose the canonical comparison for final verification.
//
// Nothing here writes: stored ContactPhone.value is never repaired or
// rewritten. Normalization is for matching only.

import { normalizePhoneIntl } from '../whatsapp/phone.js';

export { normalizePhoneIntl };

// The trailing digits that identify a subscriber regardless of how the number
// was written. '050-123-4567', '+972 50 1234567' and '972501234567' all
// normalize to '972501234567', whose last 9 digits are '501234567' — the one
// value that appears in EVERY stored spelling of that number.
const SIGNIFICANT_LEN = 9;

export function significantDigits(intl) {
  if (!intl) return null;
  return intl.length > SIGNIFICANT_LEN ? intl.slice(-SIGNIFICANT_LEN) : intl;
}

// Parse a raw query into phone intent.
//   { kind: 'exact',   intl, significant }  → query is a complete phone number
//   { kind: 'partial', needle }             → query is a digit fragment
//   { kind: 'none' }                        → not phone-ish at all
//
// The leading zero is stripped for partial matching because stored values may
// be international ('972501234567' has no '0' before '50').
export function phoneQuery(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { kind: 'none' };

  const intl = normalizePhoneIntl(raw);
  if (intl) return { kind: 'exact', intl, significant: significantDigits(intl) };

  // Too short / odd shape to normalize, but still a usable fragment.
  // The length test is on what the user TYPED, not on the stripped needle:
  // '050' is three meaningful digits even though only '50' survives the strip.
  if (digits.length < 3) return { kind: 'none' };
  const needle = digits.replace(/^0+/, '');
  if (!needle) return { kind: 'none' };
  return { kind: 'partial', needle };
}

// Canonical verification of a candidate row against an exact phone query.
// SQL narrows by digit-suffix (cheap, tolerant of formatting); this decides.
export function isExactPhoneMatch(storedValue, intl) {
  if (!intl) return false;
  return normalizePhoneIntl(storedValue) === intl;
}
