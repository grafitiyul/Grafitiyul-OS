// THE send-language decision for the automatic new-lead reply.
//
// The language comes from the PHONE NUMBER and nothing else. Deliberately not
// from the contact's name (a lead called "David Miller" is overwhelmingly an
// Israeli customer who reads Hebrew), not from Contact.communicationLanguage
// (which the office curates later and which is empty on a brand-new lead), not
// from the browser, the form's language or the lead source. A name is not a
// nationality, and guessing wrong means a stranger's first impression of the
// business is in a language they may not read.
//
// Rules:
//   normalized country code 972  → 'he'
//   any other valid international number → 'en'
//   not classifiable → null, and the caller does NOT send
//
// "Israeli" is defined AFTER canonical normalization, so every local spelling
// the office actually types resolves the same way: '050-123-4567',
// '+972 50 123 4567', '00972501234567' and the legacy '972050…' double-prefix
// all normalize to '972501234567' → Hebrew.
//
// Normalization is the SAME normalizePhoneIntl used by WhatsApp↔Contact
// matching and staff matching — one notion of "same number" across the system.
// It already returns null for impossible shapes (972 + wrong digit count, local
// formats it cannot place, too-short strings), which is exactly the "cannot be
// classified safely" case: we refuse rather than guess.
//
// This is a SEND-LANGUAGE decision only. Nothing here writes
// Contact.communicationLanguage — one automatic message must not silently
// become the customer's recorded language preference.

import { normalizePhoneIntl } from './phone.js';

export const ISRAEL_COUNTRY_CODE = '972';

/**
 * Decide the language for one automatic reply.
 *
 * @param {string|null} rawPhone  the phone exactly as stored/received
 * @returns {{ language: 'he'|'en'|null, phoneIntl: string|null, reason: string|null }}
 *          `reason` is set ONLY when no language could be chosen, and is the
 *          operator-facing skip code recorded on the attempt ledger.
 */
export function leadSendLanguage(rawPhone) {
  const raw = String(rawPhone ?? '').trim();
  if (!raw) return { language: null, phoneIntl: null, reason: 'missing_phone' };

  const phoneIntl = normalizePhoneIntl(raw);
  // Unusable shape: a local format with no country code we can place, an
  // impossible Israeli length, or not a phone number at all. Guessing 'he'
  // here would send Hebrew to an unknown foreign number.
  if (!phoneIntl) return { language: null, phoneIntl: null, reason: 'invalid_phone' };

  if (phoneIntl.startsWith(ISRAEL_COUNTRY_CODE)) {
    return { language: 'he', phoneIntl, reason: null };
  }
  return { language: 'en', phoneIntl, reason: null };
}

/** True when the normalized number is Israeli. Exported for tests and callers. */
export function isIsraeliNumber(rawPhone) {
  const n = normalizePhoneIntl(rawPhone);
  return !!n && n.startsWith(ISRAEL_COUNTRY_CODE);
}
