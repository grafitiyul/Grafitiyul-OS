// Canonical writing-direction serialization for authored rich text.
//
// THE PROBLEM THIS SOLVES: the editor shows RTL because of editor CSS
// (`.rt-editor-prose { direction: rtl }`) and a `dir="rtl"` attribute on the
// contenteditable ELEMENT. Neither is part of `editor.getHTML()`, and the
// TextDirection extension only emits a `dir` attribute for blocks where the
// author explicitly chose one (its attribute default is null). So authored
// content serializes with NO direction information at all, and a mail client
// then falls back to ITS default — which is why Hebrew arrived LTR.
//
// THE CANONICAL RULE (one rule, applied at serialization; never a hardcoded
// RTL wrapper):
//   1. An explicit author choice ALWAYS wins. A block that already carries
//      `dir` is never touched — this is what preserves the editor's RTL/LTR
//      buttons and the original direction of quoted reply/forward history.
//   2. A block with no explicit direction resolves from ITS OWN text using the
//      Unicode first-strong-character heuristic (the same rule `dir="auto"`
//      defines). Hebrew text → rtl, English text → ltr, per block. We emit a
//      CONCRETE rtl/ltr rather than `dir="auto"` because `auto` support across
//      mail clients (notably Outlook) is unreliable.
//   3. A block with no strong character (empty, digits/punctuation only) falls
//      back to the surface default — RTL for the Hebrew GOS admin.
//   4. The document gets a computed base-direction wrapper so stray inline
//      content outside any block still has a predictable base. The base is
//      DERIVED from the content, never hardcoded.
//
// Result: mixed-language documents keep predictable punctuation and alignment
// because every block carries its own explicit base direction.

const RTL_RANGES =
  /[֐-׿؀-ۿ܀-ݏހ-޿ࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_RANGES = /[A-Za-zÀ-ʯͰ-֏Ⴀ-ჿḀ-῿]/;

// Block-level elements the editor and real-world email HTML produce.
const BLOCK_TAGS = 'p|div|h[1-6]|ul|ol|li|blockquote|pre|td|th|table|tr';

// First strong directional character wins — 'rtl' | 'ltr' | null (undetermined).
export function resolveDirection(text) {
  const s = String(text || '');
  for (const ch of s) {
    if (RTL_RANGES.test(ch)) return 'rtl';
    if (LTR_RANGES.test(ch)) return 'ltr';
  }
  return null;
}

// Visible text of an HTML fragment. Tags are removed WHOLE (attributes
// included) so URLs, class names and style values can never be mistaken for
// content — a stray href would otherwise make every block look LTR.
export function htmlToPlainish(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code) || 32));
}

// Index of the `<` of the close tag matching an already-open `tag`, or -1.
function findMatchingClose(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

// FORCE a direction (and matching text-align) on every block, overriding any
// existing dir/text-align. This is the AI-translation rule: content translated
// INTO English must open left-aligned and LTR, so the operator never has to
// press the direction/alignment buttons manually. Deliberately different from
// stampBlockDirections, which preserves author choices — here the language of
// the content genuinely changed, so the previous direction is stale.
// The emitted markup is exactly what the editor parses back: `dir` (the
// TextDirection extension) + `style="text-align: …"` (the TextAlign mark).
export function forceBlockDirection(html, dir = 'ltr') {
  if (!html) return html;
  const align = dir === 'rtl' ? 'right' : 'left';
  const openRe = new RegExp(`<(${BLOCK_TAGS})(\\s[^>]*)?>`, 'gi');
  return String(html).replace(openRe, (_full, tag, rawAttrs) => {
    let attrs = rawAttrs || '';
    // Drop any existing dir / text-align so the new direction fully wins.
    attrs = attrs.replace(/\sdir\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    attrs = attrs.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
      const kept = String(dq ?? sq ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^text-align\s*:/i.test(d))
        .join('; ');
      return kept ? ` style="${kept}"` : '';
    });
    const styleRe = /\sstyle\s*=\s*"([^"]*)"/i;
    if (styleRe.test(attrs)) {
      attrs = attrs.replace(styleRe, (_m, s) => ` style="${s.replace(/;\s*$/, '')}; text-align: ${align}"`);
    } else {
      attrs += ` style="text-align: ${align}"`;
    }
    return `<${tag} dir="${dir}"${attrs}>`;
  });
}

// Stamp an explicit `dir` on every block that lacks one, then wrap the document
// in a computed base direction. `fallback` is the surface default for blocks
// with no strong character (GOS admin authoring surface = 'rtl').
export function stampBlockDirections(html, { fallback = 'rtl', wrap = true } = {}) {
  if (!html) return html;
  const source = String(html);

  const openRe = new RegExp(`<(${BLOCK_TAGS})(\\s[^>]*)?>`, 'gi');
  const inserts = [];
  let m;
  while ((m = openRe.exec(source))) {
    const tag = m[1];
    const attrs = m[2] || '';
    // Rule 1 — an explicit author choice is never overridden.
    if (/\sdir\s*=/i.test(attrs)) continue;
    const innerStart = m.index + m[0].length;
    const closeAt = findMatchingClose(source, tag, innerStart);
    const inner = source.slice(innerStart, closeAt < 0 ? source.length : closeAt);
    // Rules 2 + 3.
    const dir = resolveDirection(htmlToPlainish(inner)) || fallback;
    inserts.push({ at: m.index + 1 + tag.length, dir });
  }

  // Apply from the end so earlier offsets stay valid.
  let out = source;
  for (let i = inserts.length - 1; i >= 0; i -= 1) {
    const { at, dir } = inserts[i];
    out = `${out.slice(0, at)} dir="${dir}"${out.slice(at)}`;
  }

  if (!wrap) return out;
  // Rule 4 — computed (not hardcoded) base direction for the document.
  const base = resolveDirection(htmlToPlainish(source)) || fallback;
  return `<div dir="${base}">${out}</div>`;
}
