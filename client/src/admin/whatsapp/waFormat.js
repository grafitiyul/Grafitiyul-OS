import { tokenizeLinks } from '../../lib/linkifyCore.js';

// THE WhatsApp markup grammar — one parser, every surface.
//
// GOS shows WhatsApp text in two different places, and before this module they
// disagreed: the template preview understood `*bold*`, the live conversation
// printed the asterisks. A message cannot look one way while being composed and
// another way while being read, so the grammar now lives here ONCE and the
// surfaces differ only in how they PAINT the parsed nodes:
//
//   waPreview.js  → HTML string (authoring preview: variable chips, flat link
//                   styling, rendered through dangerouslySetInnerHTML)
//   WaText.jsx    → React nodes  (live conversation: real clickable <a> via the
//                   shared safe link renderer, no innerHTML at all)
//
// Presentation only. Nothing here ever mutates a stored message: the canonical
// `textContent` stays byte-for-byte what the bridge received or transmitted,
// and every consumer parses a copy at render time.
//
// Node shapes:
//   { type: 'text',     value }
//   { type: 'break' }                        — a newline
//   { type: 'bold' | 'italic' | 'strike', children }
//   { type: 'code',     value }
//   { type: 'link',     href, text }
//   { type: 'variable', key }                — {{token}}, authoring surfaces only

// Marks in the order WhatsApp itself resolves them. Nesting works because each
// mark recurses into the NEXT one, so `*a _b_ c*` yields bold(text, italic, text).
const MARKS = [
  ['*', 'bold'],
  ['_', 'italic'],
  ['~', 'strike'],
];

// Atoms are lifted out of the text before the mark rules run and put back
// afterwards, because they routinely contain characters the mark rules would
// otherwise eat:
//   {{customer_first_name}}          `_first_` read as italics
//   https://grafitiyul.co.il/a_b_c   `_b_` read as italics
// The sentinel is NUL, stripped from the input first, so no message content can
// impersonate a placeholder.
const SENTINEL = '\u0000';
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/;

function markRegex(ch) {
  return new RegExp(`\\${ch}([^\\${ch}\\n]+)\\${ch}`, 'g');
}

function pushText(str, out) {
  const lines = str.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'break' });
    if (line) out.push({ type: 'text', value: line });
  });
}

// Split a plain run into text/break nodes and re-inflate any held atoms.
function leaves(str, held, out) {
  let rest = str;
  for (;;) {
    const m = PLACEHOLDER_RE.exec(rest);
    if (!m) break;
    if (m.index > 0) pushText(rest.slice(0, m.index), out);
    out.push(held[Number(m[1])]);
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) pushText(rest, out);
}

function applyMarks(str, held, from = 0) {
  const out = [];
  if (from >= MARKS.length) {
    leaves(str, held, out);
    return out;
  }
  const [ch, type] = MARKS[from];
  const re = markRegex(ch);
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.push(...applyMarks(str.slice(last, m.index), held, from + 1));
    out.push({ type, children: applyMarks(m[1], held, from + 1) });
    last = re.lastIndex;
  }
  if (last < str.length) out.push(...applyMarks(str.slice(last), held, from + 1));
  return out;
}

/**
 * WhatsApp markup → node tree.
 *
 * `variables` is the ONE deliberate difference between the two surfaces, and it
 * is not a second grammar: `{{token}}` is a GOS authoring concept, not WhatsApp
 * markup. An authoring preview must draw it as a chip (a token that survives
 * resolution is a MISSING value the operator has to see); a live conversation
 * must NOT, because a customer who literally types `{{` is typing braces.
 */
export function parseWaMarkup(markup, { variables = true } = {}) {
  const src = String(markup ?? '').split(SENTINEL).join('');
  if (!src) return [];

  const held = [];
  const hold = (node) => `${SENTINEL}${held.push(node) - 1}${SENTINEL}`;

  let s = src.replace(/```([\s\S]+?)```/g, (m, code) => hold({ type: 'code', value: code }));
  if (variables) {
    s = s.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (m, key) => hold({ type: 'variable', key }));
  }
  // URLs come from the SHARED tokenizer (linkifyCore) — one notion of "what is
  // a link" across the whole app.
  //
  // Its trailing punctuation (`rest`) goes back into the STRING rather than
  // into the node: that trailing character is by definition NOT part of the
  // URL, and it is routinely the closing marker of a mark — `*https://x.co/a*`
  // is a bold link on WhatsApp, and burying the `*` inside the link node would
  // leave the bold span unclosed and the asterisks visible.
  s = s
    .split('\n')
    .map((line) =>
      tokenizeLinks(line)
        .map((t) => (t.type === 'link' ? hold({ type: 'link', href: t.href, text: t.text }) + t.rest : t.text))
        .join(''),
    )
    .join('\n');

  return applyMarks(s, held);
}

/**
 * Markup → readable plain text: the SAME grammar with the markers dropped.
 *
 * For one-line summaries (list snippet, reply quote, search result), where
 * WhatsApp itself shows the words without the syntax. Deriving it from the
 * parsed tree — rather than a second set of strip-the-stars regexes — is what
 * keeps "one interpretation" true for the compact surfaces too.
 */
export function waPlainText(markup, { variables = false } = {}) {
  const flatten = (list) =>
    list
      .map((n) => {
        switch (n.type) {
          case 'text':
            return n.value;
          case 'break':
            return ' ';
          case 'code':
            return n.value;
          case 'link':
            return n.text;
          case 'variable':
            return `{{${n.key}}}`;
          default:
            return flatten(n.children || []);
        }
      })
      .join('');
  return flatten(parseWaMarkup(markup, { variables }));
}
