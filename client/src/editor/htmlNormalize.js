// Render-time HTML normalisation for rich content stored in the DB.
//
// The runtime renders item bodies and question text through
// `dangerouslySetInnerHTML`. The HTML comes straight from TipTap.
// TipTap emits `<p>` per Enter and `<br>` per Shift+Enter — so a
// hand-typed document gets paragraph structure for free.
//
// BUT pasted content frequently arrives in a different shape:
//   * Plain textareas / mobile keyboards: every newline becomes `<br>`,
//     and the entire body sits inside ONE `<p>`.
//   * Some Word / Google-Docs paste paths: the same — paragraphs are
//     visually separated in the source but the HTML uses `<br>` runs.
//
// In that shape there are no paragraph siblings, so no amount of
// `<p>` margin CSS can render distinct paragraphs — there's only one
// paragraph. Every line looks identical, and the user (rightly) sees
// "the runtime collapsed all my paragraphs into one block".
//
// This helper rebuilds paragraph structure at render time. It splits
// any `<p>` whose body contains TWO OR MORE consecutive `<br>` tags
// into multiple `<p>` blocks. A SINGLE `<br>` is preserved as-is —
// that's the user's intentional soft line break (Shift+Enter), and
// keeping it tight is the whole point of distinguishing it from a
// paragraph break.
//
// What this is NOT:
//   * It does not mutate DB content. The transform runs every time
//     we render. Editor saves still go through unchanged.
//   * It does not touch list items / blockquotes / headings — the
//     regex only matches `<p>...</p>` blocks.
//   * It does not normalise `<p>` attribute order or inner whitespace.
//   * It does not run during editing. The TipTap editor reads the raw
//     stored HTML so the editor and the saved document stay in sync.
//
// Edge cases:
//   * Three or more consecutive `<br>` collapse into one paragraph
//     break (any empty paragraph that results is hidden by
//     `.gos-prose p:empty { display: none }`).
//   * Empty input → empty output.
//   * Input with no `<p>` at all (e.g. raw text) → returned untouched.
//   * Existing `<p><p>` siblings → already correctly structured;
//     untouched.

const PARAGRAPH_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
// At-least-two `<br>` separated only by whitespace.
const DOUBLE_BR_RE = /(?:<br\s*\/?>\s*){2,}/gi;
const ANY_DOUBLE_BR_RE = /(?:<br\s*\/?>\s*){2,}/i;

export function normalizeRichHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html.replace(PARAGRAPH_RE, (match, attrs, inner) => {
    if (!ANY_DOUBLE_BR_RE.test(inner)) return match;
    // Split on every run of 2+ <br>. Each run becomes a paragraph
    // boundary. Empty pieces are kept (they materialise as empty
    // <p></p> in the output, which the runtime stylesheet hides).
    const parts = inner.split(DOUBLE_BR_RE);
    return parts.map((piece) => `<p${attrs}>${piece}</p>`).join('');
  });
}
