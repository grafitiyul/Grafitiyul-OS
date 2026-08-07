// THE canonical email-address sanitizer. Every place an address ENTERS the
// system (contact/org forms, ingress adapters, imports, mirrors, OAuth claims)
// and every place one LEAVES it (Gmail sends, matching, dedupe) MUST go through
// here, so there is exactly one notion of "the same address" and exactly one
// answer to "is this sendable".
//
// Lives in shared/ so the client imports it too — the operator is warned at the
// input, not six silent Gmail rejections later. Same convention as
// shared/phone.mjs (normalizePhoneIntl).
//
// WHY THIS EXISTS (production incident, deals #27099/#27100, 2026-08-07):
// a contact address was stored as 'hilah19@gmail.com' + U+200F (RIGHT-TO-LEFT
// MARK) — invisible on every screen. Copying an address out of a Hebrew (RTL)
// context routinely carries one of these along. The old validators tested
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ and JavaScript's \s does NOT cover U+200B–200F,
// U+202A–202E or U+2066–2069, so the address passed as "valid", landed raw
// inside the To: angle-addr, and Gmail rejected the message with a 400 on every
// attempt. Two customers were never told their tours were confirmed.
//
// The rule: invisible formatting characters carry NO addressing meaning, so
// stripping them PRESERVES the logical address. Interior whitespace does carry
// meaning (it usually means two addresses got glued together), so it is never
// silently removed — it makes the value invalid instead.

// Zero-width, bidi-control and other invisible formatting characters. None of
// these can legally appear in an addr-spec, and none of them change which
// mailbox is meant.
const INVISIBLE = [
  '\\u00AD', // SOFT HYPHEN
  '\\u061C', // ARABIC LETTER MARK
  '\\u180E', // MONGOLIAN VOWEL SEPARATOR
  '\\u200B-\\u200F', // ZWSP, ZWNJ, ZWJ, LRM, RLM  ← the incident character
  '\\u202A-\\u202E', // LRE, RLE, PDF, LRO, RLO
  '\\u2060-\\u2064', // WORD JOINER + invisible operators
  '\\u2066-\\u2069', // LRI, RLI, FSI, PDI
  '\\uFEFF', // ZERO WIDTH NO-BREAK SPACE / BOM
].join('');

const INVISIBLE_RE = new RegExp(`[${INVISIBLE}]`, 'g');

// Unicode spaces a paste can smuggle in. Folded to a plain space so they are
// trimmed at the edges and stay VISIBLE as a break in the middle — where they
// make the value invalid rather than being silently swallowed.
const UNICODE_SPACE = [
  '\\u00A0', // NO-BREAK SPACE
  '\\u1680', // OGHAM SPACE MARK
  '\\u2000-\\u200A', // EN QUAD … HAIR SPACE
  '\\u202F', // NARROW NO-BREAK SPACE
  '\\u205F', // MEDIUM MATHEMATICAL SPACE
  '\\u3000', // IDEOGRAPHIC SPACE
].join('');

const UNICODE_SPACE_RE = new RegExp(`[${UNICODE_SPACE}]`, 'g');

// Same shape rule the system has always used, deliberately unchanged so no
// address that used to work starts failing. ASCII-only is enforced separately
// by isEmailShaped — that is the ONE genuine tightening.
const SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Printable ASCII only. An addr-spec carrying any other byte is an RFC 5322
// violation that Gmail's API rejects outright.
const ASCII_ONLY_RE = /^[\x21-\x7E]+$/;

/** Does this raw value carry invisible formatting characters? (UI warning.) */
export function hasInvisibleChars(raw) {
  INVISIBLE_RE.lastIndex = 0;
  return INVISIBLE_RE.test(String(raw ?? ''));
}

/**
 * Storage form: invisible characters removed, Unicode spaces folded, trimmed.
 * CASE IS PRESERVED — an address is displayed the way its owner writes it.
 * Returns '' for an empty/absent input (never null, so callers can compare).
 */
export function sanitizeEmailAddress(raw) {
  return String(raw ?? '')
    .replace(INVISIBLE_RE, '')
    .replace(UNICODE_SPACE_RE, ' ')
    .trim();
}

/**
 * Matching / sending form: sanitized + lowercased. This is the value to
 * compare, dedupe and put in a To: header.
 * Deliberately NO aggressive canonicalization (dots, plus-tags) — two addresses
 * that differ are different people, which is the safe direction for a CRM.
 * Returns null when there is nothing usable.
 */
export function normalizeEmailAddress(raw) {
  const s = sanitizeEmailAddress(raw).toLowerCase();
  return s || null;
}

/**
 * Is this a sendable address? Shape check PLUS printable-ASCII, which is what
 * actually separates "Gmail accepts it" from "Gmail 400s".
 * Sanitizes defensively, so a raw string can never sneak past by being tested
 * before it was cleaned.
 */
export function isEmailShaped(value) {
  const s = sanitizeEmailAddress(value);
  if (!s || !SHAPE_RE.test(s)) return false;
  return ASCII_ONLY_RE.test(s);
}

/**
 * The one address-cleaning entry point for send paths and write paths:
 * sanitize → validate → return the normalized address, or null if unusable.
 * A caller that gets null MUST surface an honest "no usable address" error
 * instead of handing a doomed value to a queue.
 */
export function toSendableAddress(raw) {
  const normalized = normalizeEmailAddress(raw);
  if (!normalized || !isEmailShaped(normalized)) return null;
  return normalized;
}

/**
 * Full report for an input surface: what was typed, what will be stored, and
 * WHY it is (or is not) acceptable. Powers the operator-facing warning so an
 * invisible character is never saved unknowingly.
 *
 * → { input, sanitized, normalized, valid, hadInvisible, changed, reason }
 *   reason: null | 'empty' | 'invisible_only' | 'invalid_shape' | 'non_ascii'
 */
export function describeEmailInput(raw) {
  const input = String(raw ?? '');
  const sanitized = sanitizeEmailAddress(input);
  const hadInvisible = hasInvisibleChars(input);
  const base = {
    input,
    sanitized,
    normalized: sanitized ? sanitized.toLowerCase() : null,
    hadInvisible,
    changed: sanitized !== input.trim(),
  };
  if (!sanitized) {
    return { ...base, valid: false, reason: input.trim() ? 'invisible_only' : 'empty' };
  }
  if (!SHAPE_RE.test(sanitized)) return { ...base, valid: false, reason: 'invalid_shape' };
  if (!ASCII_ONLY_RE.test(sanitized)) return { ...base, valid: false, reason: 'non_ascii' };
  return { ...base, valid: true, reason: null };
}

/** Hebrew wording for an input surface. One home for the operator's message. */
export const EMAIL_INPUT_MESSAGE_HE = {
  empty: 'לא הוזנה כתובת מייל',
  invisible_only: 'הכתובת מכילה תווים בלתי נראים בלבד',
  invalid_shape: 'כתובת המייל אינה תקינה',
  non_ascii: 'כתובת המייל מכילה תווים שאינם אנגליים — שרת המייל ידחה אותה',
};

/** Shown after a silent repair, so the operator sees what was fixed. */
export const EMAIL_CLEANED_NOTE_HE =
  'הוסרו תווי עיצוב בלתי נראים שהודבקו יחד עם הכתובת (הם גורמים לדחיית המייל).';
