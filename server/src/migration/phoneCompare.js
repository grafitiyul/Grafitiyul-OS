// COMPARE-ONLY phone normalisation for the legacy migration (rules R0–R8).
//
// WHY THIS EXISTS ALONGSIDE whatsapp/phone.js:
//   * `normalizePhoneIntl` (src/whatsapp/phone.js) is the runtime SSOT for
//     matching a live WhatsApp number to a GOS ContactPhone. It stays the only
//     normalizer GOS uses at runtime, and nothing here changes it.
//   * These rules exist ONLY to PROPOSE duplicate contacts for human review in
//     the one-time migration. They were designed and measured in the M1b audit,
//     and the approved cluster numbers (1,151 clusters / 2,402 contacts →
//     647 safe / 363 probable / 141 ambiguous) come from exactly this logic —
//     so it must stay byte-identical to reconcile.
//
// The important difference: R2 repairs the classic `+972 0 5X…` corruption, which
// `normalizePhoneIntl` treats as an unknown 13-digit foreign number. That extra
// repair only ever SUGGESTS a duplicate to a human; it can never merge anything.
//
// HARD RULES (from the frozen spec):
//   * The raw value is preserved verbatim. This output is NEVER stored.
//   * Foreign numbers are NEVER auto-repaired — ambiguous shapes return null
//     (`review`) instead of guessing.
//
// Returns { candidate, confidence: 'high'|'medium'|'review'|'none', rule }.
export function normalizeForCompare(raw) {
  const v = String(raw || '').trim();
  if (!v) return { candidate: null, confidence: 'none', rule: 'empty' };
  const d = v.replace(/[^\d+]/g, '');
  let digits = d.replace(/\D/g, '');
  // R0: collapse a duplicated country prefix (972972…, +972972…)
  if (/^972972/.test(digits)) digits = digits.slice(3);
  // R2: 9720XXXXXXXX — the classic corruption: keep 972, drop the stray 0
  if (/^9720/.test(digits)) {
    const rest = digits.slice(4);
    if (rest.length === 8 || rest.length === 9) return { candidate: `972${rest}`, confidence: 'high', rule: 'R2_9720_strip_zero' };
    return { candidate: null, confidence: 'review', rule: 'R2_9720_bad_length' };
  }
  // R1: +972 / 972 with a valid Israeli national length
  if (/^972/.test(digits)) {
    const rest = digits.slice(3);
    if ((rest.length === 8 || rest.length === 9) && !rest.startsWith('0')) return { candidate: digits, confidence: 'high', rule: 'R1_il_972' };
    return { candidate: null, confidence: 'review', rule: 'R1_972_invalid_length_maybe_foreign' };
  }
  // R4: 00 international prefix → drop 00, take as-is (no country repair)
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    if (rest.length >= 8 && rest.length <= 15 && !rest.startsWith('0')) return { candidate: rest, confidence: 'medium', rule: 'R4_double_zero' };
    return { candidate: null, confidence: 'review', rule: 'R4_bad' };
  }
  // R3: Israeli local 0XXXXXXXX(X)
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
    return { candidate: `972${digits.slice(1)}`, confidence: 'high', rule: 'R3_il_local' };
  }
  // R7: leading 0 + >10 digits → possibly a foreign number whose '+' became '0'.
  // NEVER auto-repair — a wrong repair would merge two different people.
  if (digits.startsWith('0') && digits.length > 10) return { candidate: null, confidence: 'review', rule: 'R7_zero_replaced_plus_suspect' };
  // R5: +<other country>, valid shape
  if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) {
    return { candidate: digits, confidence: 'high', rule: 'R5_plus_foreign' };
  }
  // R6: bare 10-15 digits, not 0/972-leading → international as-is (weaker)
  if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith('0')) return { candidate: digits, confidence: 'medium', rule: 'R6_bare_intl' };
  if (digits.length >= 8 && digits.length < 10) return { candidate: null, confidence: 'review', rule: 'R8_short_no_country' };
  return { candidate: null, confidence: 'none', rule: 'R8_unusable' };
}

// Only high/medium candidates are trustworthy enough to even SUGGEST a duplicate.
export const isComparable = (n) => !!n.candidate && (n.confidence === 'high' || n.confidence === 'medium');

// Auto-generated junk contacts ("New Contact | <phone>") — excluded from dedup
// and from Contact creation entirely (3,193 measured; 0 open/won deals).
export const NEW_CONTACT_RE = /^new contact\b/i;
export const isNewContactName = (name) => NEW_CONTACT_RE.test(String(name || '').trim());
