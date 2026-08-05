// THE deterministic classifier for global-search input — what did the operator
// type: a phone, an email, a Hebrew name, a Latin name, or mixed text?
//
// Reuses the two canonical classifiers instead of inventing new notions:
//   • phones  → shared/phone.mjs normalizePhoneIntl (ONE "same number" rule)
//   • names   → shared/nameLanguage.mjs classifyNameScript (ONE script rule)
// Email shape matches the server's ingress convention (trim + lowercase,
// minimal one-@-and-dotted-domain check) — see server/src/ingress/normalize.js.
//
// Deterministic rules only. Used for the "+ ליד" no-result action (which field
// of the canonical CreateDealModal to prefill) and for the type hint shown on
// recent searches. Never used to rewrite stored data.

import { classifyNameScript } from '../../../../shared/nameLanguage.mjs';
import { normalizePhoneIntl } from '../../../../shared/phone.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone-shaped: optional leading '+', then only digits and common separators.
const PHONEISH_RE = /^\+?[\d\s\-().]+$/;

// → { kind: 'phone'|'email'|'name_he'|'name_en'|'mixed'|'invalid', text, … }
//   phone carries `intl` (canonical digits), email carries `email` (lowercased).
//   `text` always preserves the operator's original (trimmed) input.
export function classifySearchInput(raw) {
  const text = String(raw || '').trim();
  if (text.length < 2) return { kind: 'invalid', text };

  if (EMAIL_RE.test(text)) return { kind: 'email', text, email: text.toLowerCase() };
  // Contains '@' but is not a valid email → malformed, never a name. Don't
  // offer creation from it.
  if (text.includes('@')) return { kind: 'invalid', text };

  const digitCount = (text.match(/\d/g) || []).length;
  if (PHONEISH_RE.test(text) && digitCount >= 7) {
    const intl = normalizePhoneIntl(text);
    // Phone-shaped but impossible (too short / bad prefix) → not creatable.
    return intl ? { kind: 'phone', text, intl } : { kind: 'invalid', text };
  }

  const script = classifyNameScript(text);
  if (script === 'he') return { kind: 'name_he', text };
  if (script === 'en') return { kind: 'name_en', text };
  if (script === 'mixed') return { kind: 'mixed', text };
  // 'neutral' (digits/punctuation only, short digit fragments) — nothing to
  // create a lead from.
  return { kind: 'invalid', text };
}

// May this input become a new lead? Mixed IS allowed — it opens the form with
// the original text visible plus a hint, never a silent guess.
export function isCreatable(intent) {
  return !!intent && intent.kind !== 'invalid';
}

// Small type hint shown on recent-search rows (null → no hint).
export const KIND_HINT = {
  phone: 'טלפון',
  email: 'אימייל',
  name_he: 'שם',
  name_en: 'שם',
  mixed: null,
  invalid: null,
};

const MIXED_HINT = 'הטקסט משלב עברית ואנגלית — בדקו את השם לפני היצירה';

// Supporting line under the compact "+ ליד" action: what exactly will be
// prefilled. The operator's original formatting is preserved for display.
export function createLeadDescription(intent) {
  if (!intent) return null;
  switch (intent.kind) {
    case 'phone':
      return `פתיחת ליד חדש עם הטלפון ${intent.text}`;
    case 'email':
      return `פתיחת ליד חדש עם האימייל ${intent.email}`;
    case 'name_he':
    case 'name_en':
      return `פתיחת ליד חדש עבור ${intent.text}`;
    case 'mixed':
      return `פתיחת ליד חדש עם "${intent.text}"`;
    default:
      return null;
  }
}

// The CreateDealModal `prefill` payload — exactly one Contact field receives
// the value; names go to the single full-name field, whose canonical split
// (contactNamesFromFull) already routes Hebrew→Hebrew fields, Latin→English
// fields, mixed→default Hebrew fields, at submit time.
export function createLeadPrefill(intent) {
  if (!intent) return null;
  switch (intent.kind) {
    case 'phone':
      return { phone: intent.text };
    case 'email':
      return { email: intent.email };
    case 'name_he':
    case 'name_en':
      return { fullName: intent.text };
    case 'mixed':
      return { fullName: intent.text, hint: MIXED_HINT };
    default:
      return null;
  }
}
