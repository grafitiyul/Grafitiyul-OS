// Pure recipient-string helpers, kept out of the .jsx component so they can be
// unit-tested by the plain node test runner. The composer's wire contract is a
// comma-joined string; the chip UI is only an entry surface over it.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitAddresses(text) {
  return String(text || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Append addresses to an existing list, case-insensitively de-duplicated and
// order-preserving. Returns the comma-joined string the composer sends.
export function addAddresses(current, incoming) {
  const next = splitAddresses(current);
  for (const raw of incoming) {
    const addr = String(raw).trim();
    if (addr && !next.some((c) => c.toLowerCase() === addr.toLowerCase())) next.push(addr);
  }
  return next.join(', ');
}

export function isValidAddress(value) {
  return EMAIL_RE.test(String(value || '').trim());
}
