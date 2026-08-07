// Pure recipient-string helpers, kept out of the .jsx component so they can be
// unit-tested by the plain node test runner. The composer's wire contract is a
// comma-joined string; the chip UI is only an entry surface over it.
//
// Address cleaning + validity are NOT decided here — they come from THE
// canonical sanitizer (shared/emailAddress.mjs), the same one the server's send
// path uses. A composer that accepted an address the server would drop is
// exactly the divergence that let #27099/#27100 fail silently.

import { sanitizeEmailAddress, normalizeEmailAddress, isEmailShaped } from '../../lib/emailAddress.js';

export function splitAddresses(text) {
  return String(text || '')
    .split(/[,;]+/)
    // Sanitized on the way in: a pasted address carrying an invisible bidi mark
    // is repaired here, so the chip the operator sees IS what gets sent.
    .map(sanitizeEmailAddress)
    .filter(Boolean);
}

// Append addresses to an existing list, case-insensitively de-duplicated and
// order-preserving. Returns the comma-joined string the composer sends.
export function addAddresses(current, incoming) {
  const next = splitAddresses(current);
  for (const raw of incoming) {
    const addr = sanitizeEmailAddress(raw);
    if (addr && !next.some((c) => normalizeEmailAddress(c) === normalizeEmailAddress(addr))) {
      next.push(addr);
    }
  }
  return next.join(', ');
}

export function isValidAddress(value) {
  return isEmailShaped(value);
}
