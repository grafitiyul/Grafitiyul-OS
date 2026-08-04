// THE canonical name-script classifier — one deterministic rule for routing
// person names into Hebrew vs English name fields, shared by the server
// (ingress contact creation, contact-route validation, repairs) and the client
// (admin form inline validation). No other module may re-derive this.
//
// Rules (Slice F, 2026-08-04):
//   • Hebrew letters → the Hebrew fields; Latin letters → the English fields.
//   • A MIXED name (both scripts) is never guessed: it stays in the default
//     (Hebrew) field with the full original preserved.
//   • Neutral characters — digits, punctuation, whitespace, other scripts —
//     never determine language.
//   • Names are never translated, phone numbers never inspected.

const HEBREW_RE = /[֐-׿]/;
// Basic Latin letters + Latin-1/Extended (José, Müller, Française…).
const LATIN_RE = /[A-Za-zÀ-ɏ]/;

/**
 * Classify a string's name-script: 'he' | 'en' | 'mixed' | 'neutral' | 'empty'.
 */
export function classifyNameScript(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'empty';
  const hasHe = HEBREW_RE.test(s);
  const hasLat = LATIN_RE.test(s);
  if (hasHe && hasLat) return 'mixed';
  if (hasHe) return 'he';
  if (hasLat) return 'en';
  return 'neutral';
}

/**
 * Route an incoming lead's (firstName, lastName) into the four canonical name
 * columns. The PAIR is classified together (a Latin first + Hebrew last is
 * 'mixed' and stays whole in the default fields — never split across
 * languages). Returns { firstNameHe, lastNameHe, firstNameEn, lastNameEn,
 * script }.
 */
export function routeLeadName({ firstName = '', lastName = '' } = {}) {
  const f = String(firstName || '').trim();
  const l = String(lastName || '').trim();
  const script = classifyNameScript(`${f} ${l}`);
  if (script === 'en') {
    return { firstNameHe: '', lastNameHe: '', firstNameEn: f, lastNameEn: l, script };
  }
  // he / mixed / neutral / empty → the default (Hebrew) fields, whole.
  return { firstNameHe: f, lastNameHe: l, firstNameEn: '', lastNameEn: '', script };
}

/**
 * Admin-form guard: does a value belong in the field it was typed into?
 * A Hebrew-mapped field rejects FULLY-Latin values and vice versa; mixed and
 * neutral values are always allowed (never a destructive rejection).
 * Returns null when fine, else 'belongs_en' | 'belongs_he'.
 */
export function nameFieldMismatch(field, value) {
  const script = classifyNameScript(value);
  if (field === 'he' && script === 'en') return 'belongs_en';
  if (field === 'en' && script === 'he') return 'belongs_he';
  return null;
}
