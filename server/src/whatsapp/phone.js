// THE canonical phone normalizer for WhatsApp↔Contact matching. GOS stores
// ContactPhone.value raw (as typed); WhatsApp reports international digits.
// Everything that compares the two MUST go through normalizePhoneIntl so
// there is exactly one notion of "same number".
//
// The normalizer itself lives in shared/phone.mjs so the client's search-input
// classifier shares the SAME definition; this module remains the server-side
// import site (plus the WhatsApp-specific index/match helpers below).

import { normalizePhoneIntl } from '../../../shared/phone.mjs';

export { normalizePhoneIntl };

// digits → Map<intlDigits, Set<contactId>> over raw ContactPhone rows.
export function buildPhoneIndex(contactPhones) {
  const map = new Map();
  for (const p of contactPhones || []) {
    const n = normalizePhoneIntl(p.value);
    if (!n) continue;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n).add(p.contactId);
  }
  return map;
}

// Auto-match rule: EXACTLY one contact owns the number → link (reviewable via
// matchSource='phone'); zero or ambiguous (shared office number) → null and
// the chat stays in the unmatched inbox. Never guess.
export function matchContactId(chatPhoneIntl, index) {
  if (!chatPhoneIntl) return null;
  const set = index.get(String(chatPhoneIntl));
  if (!set || set.size !== 1) return null;
  return set.values().next().value;
}
