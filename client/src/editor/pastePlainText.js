// THE plain-text paste contract — one pure rule shared by the editor's
// clipboard text parser (RichEditor), the HTML sanitizer's literal-newline /
// div-per-line restoration (pasteSanitizer), and the display normaliser
// (htmlNormalize), so text/plain and HTML pastes of the same content produce
// the same structure everywhere.
//
// GOS renders rich text in exactly two typography RHYTHMS, and what preserves
// the author's visible structure differs between them:
//
//   'spaced' — the standard editor/display face (.rt-editor-prose /
//     .gos-prose): adjacent paragraphs are separated by a visible margin
//     (~1 blank line). Here a blank line in the source maps to a PARAGRAPH
//     BREAK (the margin renders the gap), and only EXTRA blank lines beyond
//     the separator become explicit empty paragraphs.
//
//   'tight' — the note face (.rt-editor-compact composer / .gos-prose-tight
//     display): paragraph margins are ZERO (Enter reads like a plain line
//     break). A paragraph break renders as NOTHING here, so consuming the
//     blank line would collapse the author's paragraphs into one dense block
//     (the production paste bug). Every blank line must therefore survive as
//     an explicit EMPTY PARAGRAPH.
//
// Shared rules in both rhythms:
//   • a single newline inside a paragraph is a SOFT line break (never a new
//     paragraph — the ProseMirror default of one-paragraph-per-line is exactly
//     the "every line separated strangely" production bug);
//   • leading/trailing blank lines are trimmed (no empty lines at the note's
//     start or end);
//   • \r\n is normalized.

/**
 * Split plain text into paragraph line-groups.
 * @param {string} text
 * @param {'spaced'|'tight'} rhythm — target typography rhythm (see header).
 * @returns {string[][]} e.g. [["line one","line two"], [], ["after blanks"]]
 *   — an inner [] is an explicit empty paragraph (a visible blank line).
 */
export function plainTextToParagraphs(text, rhythm = 'spaced') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const paragraphs = [];
  let current = [];
  let blanks = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blanks += 1;
      continue;
    }
    if (blanks > 0 && current.length) {
      paragraphs.push(current);
      // 'spaced': the first blank IS the paragraph separator (the margin
      // renders it); extras become empty paragraphs. 'tight': margins are 0,
      // so EVERY blank line becomes an explicit empty paragraph.
      const empties = rhythm === 'tight' ? blanks : blanks - 1;
      for (let i = 0; i < empties; i += 1) paragraphs.push([]);
      current = [];
    }
    blanks = 0;
    current.push(line);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}
