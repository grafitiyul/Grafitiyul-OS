// Render-time HTML normalisation for rich content stored in the DB.
//
// Two passes:
//
//   1. Split runs of 2+ consecutive `<br>` inside a single `<p>` into
//      separate `<p>` blocks. Pasted content (Word, Google Docs,
//      mobile keyboards, plain textareas) often arrives as one giant
//      `<p>` with `<br><br>` runs marking what the author meant as
//      paragraph breaks. Without this, paragraph margins have nothing
//      to apply to and the runtime renders one continuous block.
//      Single `<br>` is preserved — that's the user's intentional
//      soft line break (Shift+Enter), and keeping it tight is the
//      whole point of distinguishing it from a paragraph break.
//
//   2. Tag "inline-heading" paragraphs with the `gos-inline-heading`
//      class. An inline heading is a `<p>` whose visible text sits
//      ENTIRELY inside `<strong>`/`<u>`/`<b>` tags (any nesting) and
//      is short enough to read as a label, not a sentence. The
//      stylesheet uses this class to TIGHTEN the gap to the
//      following paragraph so the heading visually attaches to the
//      explanation it introduces — matching how the user authors
//      "bold-underline title \n\n explanation" structures.
//
//      Detection is conservative: a single italic word doesn't
//      qualify, neither does a paragraph that has any plain text
//      outside emphasis tags. The rule kicks in ONLY for the "the
//      whole paragraph is the title" shape.
//
// What this is NOT:
//   * It does not mutate DB content. The transform runs every time
//     we render. Editor saves still go through unchanged.
//   * It does not affect the editor surface (`.rt-editor-prose`) —
//     editing reads raw HTML, normalisation runs only on read-only
//     surfaces.
//   * It does not touch list items / blockquotes / headings — the
//     regex only matches `<p>...</p>` blocks.
//   * It does not add/remove tags inside the paragraph. Only the
//     `<p>` opening tag's class attribute may change.

const PARAGRAPH_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
// At-least-two `<br>` separated only by whitespace.
const DOUBLE_BR_RE = /(?:<br\s*\/?>\s*){2,}/gi;
const ANY_DOUBLE_BR_RE = /(?:<br\s*\/?>\s*){2,}/i;

// Strong / underline / bold wrappers (no <em> — italic alone is not
// the heading shape we want to detect).
const EMPHASIS_RE = /<(strong|u|b)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const ANY_TAG_RE = /<[^>]*>/g;
// Trailing-only punctuation that we tolerate outside emphasis. A
// short label like "סיור גרפיטי מקוצר -" still counts as a heading
// even though the trailing dash isn't bolded.
const PUNCT_ONLY_RE = /^[\s\-:.,;–—|()[\]]*$/;

const INLINE_HEADING_MAX_LEN = 100;

export function normalizeRichHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return '';

  // Pass 1: split paragraphs on double-<br>.
  const splitOnBr = html.replace(PARAGRAPH_RE, (match, attrs, inner) => {
    if (!ANY_DOUBLE_BR_RE.test(inner)) return match;
    const parts = inner.split(DOUBLE_BR_RE);
    return parts.map((piece) => `<p${attrs}>${piece}</p>`).join('');
  });

  // Pass 2: tag inline-heading paragraphs.
  return splitOnBr.replace(PARAGRAPH_RE, (match, attrs, inner) => {
    if (!isInlineHeading(inner)) return match;
    return `<p${ensureClass(attrs, 'gos-inline-heading')}>${inner}</p>`;
  });
}

// Returns true when the paragraph's body is "wholly emphasized" —
// every visible character lives inside <strong>/<u>/<b> wrappers,
// modulo trailing punctuation. Used to mark inline headings so the
// CSS can tighten their bottom gap to the next paragraph.
function isInlineHeading(innerHtml) {
  if (typeof innerHtml !== 'string') return false;
  const plain = stripAllTags(innerHtml).trim();
  if (!plain) return false;
  if (plain.length > INLINE_HEADING_MAX_LEN) return false;

  // Strip emphasis wrappers (strong/u/b) and their full content. If
  // what's left is empty, all visible text was inside emphasis. If
  // what's left is nothing but punctuation/whitespace, treat the
  // paragraph as a heading too — this handles "Title -" where the
  // trailing dash sits outside the bold span.
  const withoutEmphasis = stripEmphasis(innerHtml);
  const remainder = stripAllTags(withoutEmphasis).trim();
  if (remainder.length === 0) return true;
  if (PUNCT_ONLY_RE.test(remainder)) return true;
  return false;
}

function stripAllTags(html) {
  return html.replace(ANY_TAG_RE, '');
}

// Repeatedly strip <strong>/<u>/<b> blocks (and their content) until
// the string stops changing. The loop handles nested emphasis like
// <strong><u>X</u></strong> — the outer match consumes the whole
// thing in one go but the loop is cheap insurance against any
// sequencing surprises.
function stripEmphasis(html) {
  let prev = html;
  for (let i = 0; i < 5; i += 1) {
    const next = prev.replace(EMPHASIS_RE, '');
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

// Add `cls` to the existing class list on a `<p>` tag's attribute
// string. Preserves any other attributes (style, etc.). The attribute
// substring includes the leading whitespace seen by the regex, e.g.
// ` class="x"` or ``.
function ensureClass(attrs, cls) {
  if (typeof attrs !== 'string' || attrs.length === 0) {
    return ` class="${cls}"`;
  }
  if (/\bclass\s*=\s*["']/.test(attrs)) {
    return attrs.replace(
      /\bclass\s*=\s*(["'])([^"']*)\1/,
      (_m, quote, list) => {
        const tokens = list.split(/\s+/).filter(Boolean);
        if (!tokens.includes(cls)) tokens.push(cls);
        return `class=${quote}${tokens.join(' ')}${quote}`;
      },
    );
  }
  // No class attr yet — append one. The leading space is already in
  // `attrs`, so just tack ours on.
  return `${attrs} class="${cls}"`;
}
