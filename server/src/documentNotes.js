// THE canonical customer-facing notes normalizer for accounting documents.
//
// One boundary, one function. Everything that reads notes INTO the document
// flow (a base document's live iCount `hwc`) and everything that writes notes
// OUT of it (the doc/create payload) passes through `normalizeDocumentNotes`,
// so the text the operator reviews in the produce-document modal is byte-for-
// byte the text iCount receives. There is deliberately no second normalizer in
// the React layer — a client-only parse would let the preview and the payload
// disagree, which is exactly the failure this module exists to prevent.
//
// Why a normalizer is needed at all: `hwc` is a FREE-FORM provider field. GOS
// composes it as plain text (accountingDocNotes.js), but iCount's own web UI
// writes rich HTML into the same field — e.g. document 54513:
//   "<div>סדנה למחלקת נשים ויולדות<br /><br />ניתן לשלם…</div>"
// When such a document is chosen as the base for a follow-up, GOS used to copy
// that markup verbatim into the operator's Notes textarea, showing raw tags.
// Legacy/imported sources can additionally hand us a JSON blob instead of a
// string, so the normalizer accepts the whole matrix and always yields readable
// plain text.
//
// Why PLAIN TEXT is the canonical form (and not the shared RichText renderer):
// the Notes surface is an editable textarea whose content is sent verbatim as
// `hwc`, so "what you see" must equal "what is sent" (a rendered read-only
// preview would break that invariant and the operator's ability to edit).
// Plain text is safe on the provider side — verified 2026-08-04 against the two
// live PDFs: iCount honours "\n" in `hwc` as a real line break (doc 54484,
// GOS-composed plain text, renders on separate lines) exactly as it renders
// <br /> (doc 54513). So converting HTML → text loses no customer-visible
// formatting.
//
// Malformed / unreadable input NEVER degrades to raw syntax: the text comes
// back empty with an operator-facing `warning`, so a customer can never receive
// braces, keys or tags.

const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
const ENTITY_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i;
// A JSON-ish string: an opening bracket AND at least one "key": pair. The pair
// requirement keeps ordinary prose that happens to start with a brace (or a
// leftover moustache) out of the JSON branch; deliberately NOT requiring a
// closing bracket, because TRUNCATED legacy JSON ('{"text":"נשבר') is the exact
// case that must be caught and warned about rather than printed.
const JSON_SHAPE_RE = /^\s*[{[]/;
const JSON_PAIR_RE = /"[^"]*"\s*:/;
// Invisible whitespace an HTML/rich editor emits: NBSP + narrow NBSP collapse to
// an ordinary space, LINE/PARAGRAPH SEPARATOR to a real newline — so "the same
// text" compares equal whichever surface produced it. Built from char codes to
// keep this source file free of characters that are themselves line breaks.
const NBSP_RE = new RegExp(`[${String.fromCharCode(0x00a0)}${String.fromCharCode(0x202f)}]`, 'g');
const LINE_SEPARATOR_RE = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  shy: '',
  rlm: '‏',
  lrm: '‎',
};

export const NOTES_UNREADABLE_WARNING =
  'הערות המסמך המקורי שמורות בפורמט שלא ניתן לקרוא — יש להזין את ההערות ידנית לפני ההפקה.';

const EMPTY = Object.freeze({ text: '', format: 'empty', warning: null });

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,9});/gi, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? m : named;
  });
}

/** Whitespace discipline shared by every branch — the single definition of
 *  "the same text", so normalization is idempotent (normalize(normalize(x))
 *  === normalize(x)) and preview/payload comparison is exact. */
function tidy(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(NBSP_RE, ' ')
    .replace(LINE_SEPARATOR_RE, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Rich HTML → readable plain text. Block ends and <br> become newlines; list
 *  items keep a bullet; everything else is stripped and entity-decoded (after
 *  tag removal, so an escaped &lt;div&gt; is never re-read as a tag). */
export function htmlNotesToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|ul|ol|table)\s*>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '• ');
  s = s.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, '');
  s = decodeEntities(s);
  return tidy(s);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Structured payloads put the customer text under a language key when they are
// bilingual and under a generic key when they are not. Language order follows
// the existing document-language policy: the document's own language first,
// Hebrew as the fallback, then whatever generic field carries text.
function candidateKeys(language) {
  const forLang = (l) => [l, `text_${l}`, `text${cap(l)}`, `note${cap(l)}`, `notes${cap(l)}`, `body${cap(l)}`, `content${cap(l)}`, `value${cap(l)}`];
  const keys = forLang(language);
  if (language !== 'he') keys.push(...forLang('he'));
  keys.push('text', 'notes', 'note', 'content', 'body', 'value', 'message', 'description', 'html', 'hwc', 'plain');
  return keys;
}

/** Pull the customer-facing string out of a parsed structure. Returns null when
 *  nothing readable is in there — the caller turns that into a warning, never
 *  into rendered JSON. */
function extractFromStructure(node, language, depth = 0) {
  if (node == null || depth > 5) return null;
  if (typeof node === 'string') return node.trim() ? node : null;
  if (typeof node === 'number' || typeof node === 'boolean') return null;
  if (Array.isArray(node)) {
    const parts = node.map((n) => extractFromStructure(n, language, depth + 1)).filter((p) => p && p.trim());
    return parts.length ? parts.join('\n') : null;
  }
  if (typeof node !== 'object') return null;
  for (const key of candidateKeys(language)) {
    if (!(key in node)) continue;
    const found = extractFromStructure(node[key], language, depth + 1);
    if (found && found.trim()) return found;
  }
  return null;
}

/** A string extracted from a structure may itself be HTML — finish it through
 *  the same rendering rules as a top-level HTML note. */
const renderExtracted = (s) => (HTML_TAG_RE.test(s) ? htmlNotesToText(s) : ENTITY_RE.test(s) ? tidy(decodeEntities(s)) : tidy(s));

/**
 * Normalize ANY stored notes value into the customer-facing plain text used by
 * both the preview and the iCount payload.
 *
 * @param {unknown} value  plain string / HTML string / JSON string / object /
 *                         array / null — whatever the source actually holds
 * @param {{language?: 'he'|'en'}} [opts]  the DOCUMENT's language (bilingual
 *                         payloads resolve to it, Hebrew as the fallback)
 * @returns {{text: string, format: 'empty'|'plain'|'html'|'json'|'object'|'unreadable', warning: string|null}}
 */
export function normalizeDocumentNotes(value, { language = 'he' } = {}) {
  const lang = language === 'en' ? 'en' : 'he';
  if (value == null) return EMPTY;

  // Already-parsed structure (a Json column, a legacy import).
  if (typeof value === 'object') {
    const extracted = extractFromStructure(value, lang);
    if (!extracted) return { text: '', format: 'unreadable', warning: NOTES_UNREADABLE_WARNING };
    const text = renderExtracted(extracted);
    return text ? { text, format: 'object', warning: null } : { text: '', format: 'unreadable', warning: NOTES_UNREADABLE_WARNING };
  }

  const raw = String(value);
  if (!raw.trim()) return EMPTY;

  // JSON string carrying the customer text.
  if (JSON_SHAPE_RE.test(raw) && JSON_PAIR_RE.test(raw)) {
    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // Malformed legacy JSON: do not crash, and do not let braces/keys through.
      return { text: '', format: 'unreadable', warning: NOTES_UNREADABLE_WARNING };
    }
    if (typeof parsed === 'string') {
      const text = renderExtracted(parsed);
      return text ? { text, format: 'json', warning: null } : EMPTY;
    }
    const extracted = parsed && typeof parsed === 'object' ? extractFromStructure(parsed, lang) : null;
    if (!extracted) return { text: '', format: 'unreadable', warning: NOTES_UNREADABLE_WARNING };
    const text = renderExtracted(extracted);
    return text ? { text, format: 'json', warning: null } : { text: '', format: 'unreadable', warning: NOTES_UNREADABLE_WARNING };
  }

  if (HTML_TAG_RE.test(raw)) {
    const text = htmlNotesToText(raw);
    return text ? { text, format: 'html', warning: null } : EMPTY;
  }
  if (ENTITY_RE.test(raw)) {
    const text = tidy(decodeEntities(raw));
    return text ? { text, format: 'plain', warning: null } : EMPTY;
  }
  const text = tidy(raw);
  return text ? { text, format: 'plain', warning: null } : EMPTY;
}

/** Convenience for callers that only need the text (the common case). */
export function documentNotesText(value, opts) {
  return normalizeDocumentNotes(value, opts).text;
}
