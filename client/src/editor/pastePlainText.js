// THE plain-text paste contract — one pure rule shared by the editor's
// clipboard text parser (RichEditor) and the HTML sanitizer's literal-newline
// restoration (pasteSanitizer), so text/plain and inline-HTML pastes of the
// same content produce the same structure:
//
//   • a blank line separates PARAGRAPHS (paragraphs stay paragraphs);
//   • each EXTRA blank line beyond the separator is an intentional empty
//     paragraph and is preserved;
//   • a single newline inside a paragraph is a SOFT line break (never a new
//     paragraph — the ProseMirror default of one-paragraph-per-line is exactly
//     the "every line separated strangely" production bug);
//   • leading/trailing blank lines are trimmed (no empty lines at the note's
//     start or end);
//   • \r\n is normalized.

/**
 * Split plain text into paragraph line-groups.
 * @returns {string[][]} e.g. [["line one","line two"], [], ["after blank×2"]]
 *   — an inner [] is an intentional empty paragraph.
 */
export function plainTextToParagraphs(text) {
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
      for (let i = 1; i < blanks; i += 1) paragraphs.push([]); // extra blank lines survive
      current = [];
    }
    blanks = 0;
    current.push(line);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}
