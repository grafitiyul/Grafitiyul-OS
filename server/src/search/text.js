// Text helpers for global search. Pure — no DB, no Prisma.

// TimelineEntry.body and several note fields hold rich HTML. Matching and
// snippeting must run on the VISIBLE text, never the markup: without this a
// query like "div" or "span" matches every note ever written, and a snippet
// would leak tags into the UI.
export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function norm(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

export function contains(haystack, needle) {
  const h = norm(haystack);
  const n = norm(needle);
  return !!h && !!n && h.includes(n);
}

export function startsWith(haystack, needle) {
  const h = norm(haystack);
  const n = norm(needle);
  return !!h && !!n && h.startsWith(n);
}

export function equals(a, b) {
  const x = norm(a);
  const y = norm(b);
  return !!x && x === y;
}

// A short, human-readable excerpt centred on the match, for the "why it
// matched" line. Input may be HTML; output never is.
export function snippet(source, needle, radius = 50) {
  const text = stripHtml(source);
  if (!text) return '';
  const i = norm(text).indexOf(norm(needle));
  if (i < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + String(needle).length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// Whitespace-separated query tokens. Needed because Contact full names are
// DERIVED, not stored: no column ever contains "דור כהן", so a full-name query
// only matches when each token is matched against the name fields separately.
export function tokens(q) {
  return String(q ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Contact full names are DERIVED, never stored (schema comment on Contact).
// Build both language forms so "full name" queries can match.
export function fullNameHe(c) {
  return [c?.firstNameHe, c?.lastNameHe].filter(Boolean).join(' ').trim();
}

export function fullNameEn(c) {
  return [c?.firstNameEn, c?.lastNameEn].filter(Boolean).join(' ').trim();
}
