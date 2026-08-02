// THE canonical phone normalizer for WhatsApp↔Contact matching. GOS stores
// ContactPhone.value raw (as typed); WhatsApp reports international digits.
// Everything that compares the two MUST go through normalizePhoneIntl so
// there is exactly one notion of "same number".
//
// → international digits, no '+', no separators. null when unusable.
//   '050-123-4567'    → '972501234567'   (Israeli local → international)
//   '+972 50 1234567' → '972501234567'
//   '972050-1234567'  → '972501234567'   (972+0 double prefix — legacy imports)
//   '0031612345678'   → '31612345678'    ('00' international prefix)
//   '12125551234'     → '12125551234'    (already international)
//   '+9725551780355'  → null              (impossible Israeli: 972 + 10 digits)
//   '123'             → null              (too short to be a phone)

export function normalizePhoneIntl(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Israeli local form: 0 + 8-9 digits (mobile 05x-xxxxxxx, landline 0x-xxxxxxx).
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
    digits = `972${digits.slice(1)}`;
  }
  // '972' + local leading zero ('972 050-…') — the classic legacy-import double
  // prefix. Israeli subscriber numbers never start with 0 after 972, so this is
  // unambiguous: drop the zero.
  if (digits.startsWith('9720') && (digits.length === 12 || digits.length === 13)) {
    digits = `972${digits.slice(4)}`;
  }
  // Impossible Israeli shapes (972 + anything but 8-9 digits) are DATA, not
  // phones — usually a foreign number stored with an Israeli prefix. Returning
  // them verbatim used to mint unreachable JIDs (false "not registered on
  // WhatsApp") and unmatchable chat links; null forces the honest
  // "no usable phone" path instead.
  if (digits.startsWith('972') && (digits.length < 11 || digits.length > 12)) {
    return null;
  }
  // Already-international shapes. Reject leading 0 (unknown local format) and
  // anything outside E.164's practical bounds.
  if (!digits.startsWith('0') && digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  return null;
}

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
