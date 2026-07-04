// Runs on every paste via TipTap's editorProps.transformPastedHTML, BEFORE
// ProseMirror parses the HTML into nodes. Its job:
//   - remove Word/Google-Docs noise (classes, mso-* attrs, <o:p>, meta/style)
//   - strip all inline styles except a narrow allow-list (text-align)
//   - preserve dynamic-field chip markers (data-type, data-field-key)
//   - preserve <a href> so links survive
//
// It never rewrites text content — so `{{key}}` patterns in pasted text
// still reach the DynamicField paste rule intact.

const PRESERVED_DATA_ATTRS = new Set(['data-type', 'data-field-key']);

// Attributes kept on ANY element (not tag-specific). `dir` carries writing
// direction (RTL/LTR) — preserving it on paste lets the TextDirection extension
// re-read it, so a pasted mixed-language document keeps its paragraph direction
// AND its list-marker/indent side instead of being flattened to the editor
// default. Only valid ltr/rtl values are kept (see cleanAttributes).
const GLOBAL_KEEP_ATTRS = new Set(['dir']);

// Style-preservation policy — two scopes:
//
//   GLOBAL: styles that are kept on any element (text-align applies to
//     paragraphs, headings, lists, etc).
//
//   SPAN-ONLY: styles that are only meaningful as part of the TipTap
//     TextStyle mark. TextStyle parses solely from <span> elements, so
//     preserving color/font-size on a <p> or <li> would leave an inline-
//     style blob in saved HTML that isn't tied to any editor mark —
//     which is exactly what the controlled rich-text policy forbids.
//     For non-span elements with these styles, see
//     `promoteColorAndSizeToSpans` below: it transplants color/size
//     from the element onto a wrapping <span> around its children, so
//     TextStyle picks them up correctly and the non-span's style is
//     dropped by this whitelist.
//
// Each entry is a validator: takes the raw CSS value string, returns a
// sanitized version, or null to reject.
const GLOBAL_STYLE_PROPS = {
  'text-align': (v) =>
    /^(right|left|center|justify)$/i.test(v) ? v.toLowerCase() : null,
};

const SPAN_STYLE_PROPS = {
  color: normalizeColor,
  'font-size': normalizeFontSize,
};

function validatePastedStyle(tagName, prop, value) {
  const global = GLOBAL_STYLE_PROPS[prop];
  if (global) return global(value);
  if (tagName === 'SPAN' && SPAN_STYLE_PROPS[prop]) {
    return SPAN_STYLE_PROPS[prop](value);
  }
  return null;
}

// Color normalizer — accepts hex / rgb(a) / hsl(a) / named colors, but
// blocks dangerous patterns (url(), expression(), javascript:, var(),
// calc()) and meta-values (inherit, currentcolor, etc.) that don't
// round-trip through the editor schema.
function normalizeColor(raw) {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (!lower) return null;
  if (/url\(|expression\(|javascript:|var\(|calc\(/.test(lower)) return null;
  if (
    lower === 'inherit' ||
    lower === 'currentcolor' ||
    lower === 'transparent' ||
    lower === 'initial' ||
    lower === 'unset'
  ) {
    return null;
  }
  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(lower)) {
    return lower;
  }
  // Functional: rgb(), rgba(), hsl(), hsla()
  if (/^(rgb|rgba|hsl|hsla)\s*\([^)]*\)$/.test(lower)) {
    return lower.replace(/\s+/g, ' ');
  }
  // CSS named color (simple alphabetic string).
  if (/^[a-z]+$/.test(lower)) return lower;
  return null;
}

// Font-size normalizer — accepts a number with an optional unit in
// {px, pt, em, rem, %}. Blocks calc() / var(). Clamps to a sane range
// (roughly 6px..100px equivalent) so a pasted "font-size: 9999pt"
// doesn't blow out the layout.
function normalizeFontSize(raw) {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (!lower) return null;
  if (/calc\(|var\(/.test(lower)) return null;
  const m = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)?$/.exec(lower);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2] || 'px';
  // Rough px equivalent for the bounds check.
  let px;
  switch (unit) {
    case 'px':
      px = num;
      break;
    case 'pt':
      px = num * 1.333;
      break;
    case 'em':
    case 'rem':
      px = num * 16;
      break;
    case '%':
      px = (num / 100) * 16;
      break;
    default:
      px = num;
  }
  if (!Number.isFinite(px) || px < 6 || px > 100) return null;
  return `${num}${unit}`;
}

// Iframes are always dropped on paste: embed nodes carry their data via
// (data-provider, data-video-id) on the outer <div data-type="media-embed">,
// and MediaEmbed.renderHTML reconstructs the iframe from those. This means
// any pasted iframe (trusted or not) is reliably stripped.
const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'IFRAME']);

// Office/Word-specific tags like <o:p>, <v:shape>, <w:Something>.
const OFFICE_TAG_PREFIX = /^(O|V|W|XML):/i;

const KEEP_ATTRS_BY_TAG = {
  A: new Set(['href', 'target', 'rel']),
  IMG: new Set([
    'src',
    'alt',
    'data-type',
    'data-field-key',
    'data-width',
    'data-align',
  ]),
  VIDEO: new Set([
    'src',
    'controls',
    'preload',
    'playsinline',
    'data-type',
    'data-width',
    'data-align',
  ]),
  SOURCE: new Set(['src', 'type']),
  // Ordered lists: keep `start`/`type` so a pasted numbered list that begins at
  // 3, or uses letters/roman numerals, survives instead of resetting to "1.".
  OL: new Set(['start', 'type']),
  FIGURE: new Set(['data-type', 'data-width', 'data-align']),
  FIGCAPTION: new Set(['class']),
  // Embed wrapper. The actual iframe src is reconstructed from
  // data-provider + data-video-id + data-video-hash in
  // MediaEmbed.renderHTML, so we don't trust whatever src was in the
  // pasted iframe.
  DIV: new Set([
    'data-type',
    'data-provider',
    'data-video-id',
    'data-video-hash',
    'data-width',
    'data-align',
    'data-aspect-ratio',
    'class',
  ]),
};

export function sanitizePastedHtml(html) {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Word/Docs leave conditional-comment nodes (<!--[if !supportLists]-->,
    // <o:p> markers). Drop comment nodes up front so they can't wedge between
    // list markers and their text.
    stripComments(doc.body);
    unwrapSpuriousBold(doc.body);
    // Word does not emit <ul>/<ol>. It emits <p class="MsoListParagraph"> with
    // the bullet/number in a leading marker span. Rebuild real lists BEFORE the
    // rest of the pipeline runs, while the mso markers are still present.
    reconstructWordLists(doc, doc.body);
    // IMPORTANT: semantic-style → tag conversion must run BEFORE the
    // generic attribute/style stripper. Google Docs, Word and many web
    // sources express bold/italic/underline as inline styles on
    // <span>/<p> (font-weight: 700, font-style: italic,
    // text-decoration: underline). If we strip styles first, these
    // formats are lost entirely.
    convertSemanticStylesToTags(doc, doc.body);
    // Color and font-size are also commonly carried as inline styles,
    // but unlike weight/style/decoration they don't have semantic
    // tags — they map onto TipTap's TextStyle mark, which ONLY parses
    // from <span> elements. Transplant color/size from non-span
    // elements (<p>, <li>, <div>, etc.) onto a wrapping <span> so
    // TextStyle picks them up. The whitelist below then preserves the
    // styles on the span and strips them from every other element.
    promoteColorAndSizeToSpans(doc, doc.body);
    // StarterKit only supports h1–h3. Map pasted h4–h6 down to h3 so deep
    // headings stay headings ("reasonable headings") instead of being dropped
    // to plain paragraphs by the schema parser.
    downgradeHeadings(doc, doc.body);
    // Web pages (and some Word/Docs fragments) express paragraphs and line
    // blocks as <div>, which StarterKit has no node for — runs of <div>s would
    // otherwise collapse and lose paragraph separation. Normalise leaf <div>s to
    // <p> and unwrap structural (block-containing) <div>s. Runs last, after list
    // and heading normalisation, so only genuine paragraph divs remain.
    convertDivsToParagraphs(doc, doc.body);
    cleanSubtree(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

// Remove all comment nodes (Word conditional comments, Docs markers) from the
// subtree. Comments are ignored by ProseMirror anyway, but stripping them keeps
// the tree clean and prevents them from splitting adjacent text runs.
function stripComments(root) {
  const doc = root.ownerDocument;
  // SHOW_COMMENT = 128
  const walker = doc.createTreeWalker(root, 128);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.remove();
}

// Block-level tags used to decide whether a <div> is a structural wrapper
// (contains other blocks → unwrap) or a leaf paragraph (inline content → <p>).
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'HR',
]);

function convertDivsToParagraphs(doc, root) {
  // Reverse document order = deepest-first: inner divs resolve before the
  // outer divs that contain them, so unwrapping never orphans a converted child.
  const divs = Array.from(root.querySelectorAll('div')).reverse();
  for (const div of divs) {
    // Our own structural wrappers (media embeds) carry data-type and rebuild
    // themselves on parse — never touch them or their inner divs.
    if (div.closest('[data-type]')) continue;

    const hasBlockChild = Array.from(div.children).some((c) =>
      BLOCK_TAGS.has(c.tagName),
    );
    const parent = div.parentNode;
    if (!parent) continue;

    if (hasBlockChild) {
      // Structural wrapper → unwrap: splice its children up into the parent.
      while (div.firstChild) parent.insertBefore(div.firstChild, div);
      parent.removeChild(div);
    } else {
      // Leaf block of inline content → a real paragraph, carrying dir and any
      // text-align so alignment/direction survive.
      const p = doc.createElement('p');
      const dir = (div.getAttribute('dir') || '').toLowerCase();
      if (dir === 'ltr' || dir === 'rtl') p.setAttribute('dir', dir);
      const ta = parseInlineStyles(div.getAttribute('style') || '')['text-align'];
      if (ta && /^(left|right|center|justify)$/i.test(ta)) {
        p.setAttribute('style', `text-align: ${ta.toLowerCase()}`);
      }
      while (div.firstChild) p.appendChild(div.firstChild);
      parent.replaceChild(p, div);
    }
  }
}

// Rebuild Word "list paragraphs" into real <ul>/<ol>. Word exports each list
// item as <p class="MsoListParagraph…"> containing a leading marker span
// (<span style="mso-list:Ignore">1.</span> or a bullet glyph). We: detect such
// paragraphs, read the marker to decide ordered vs unordered, drop the marker,
// turn the <p> into an <li>, then wrap consecutive items into one list.
//
// Detection deliberately requires the MsoListParagraph class OR an explicit
// Ignore-marker span — NOT the paragraph's own mso-list style alone — so a
// stray mso-list attribute on ordinary text doesn't get mistaken for a list.
//
// Scope: flat (single-level) lists. Nested Word sub-levels are flattened into
// the same list rather than nested — a readable, safe simplification.
function reconstructWordLists(doc, root) {
  for (const p of Array.from(root.querySelectorAll('p'))) {
    const cls = p.getAttribute('class') || '';
    const isListClass = /\bMsoListParagraph/i.test(cls);
    const marker = findWordListMarker(p);
    if (!isListClass && !marker) continue;

    let ordered = false;
    if (marker) {
      const t = (marker.textContent || '').trim();
      ordered =
        /^\(?\d+[.)]/.test(t) ||
        /^\(?[a-z][.)]/i.test(t) ||
        /^\(?[ivxlcdm]+[.)]/i.test(t);
      marker.remove();
    }

    const li = doc.createElement('li');
    li.setAttribute('data-wl', ordered ? 'ol' : 'ul');
    const dir = (p.getAttribute('dir') || '').toLowerCase();
    if (dir === 'ltr' || dir === 'rtl') li.setAttribute('dir', dir);
    while (p.firstChild) li.appendChild(p.firstChild);
    trimLeadingWhitespace(li);
    p.parentNode?.replaceChild(li, p);
  }
  groupWordListItems(doc, root);
}

// The Word bullet/number marker: a descendant span whose inline style contains
// `mso-list: Ignore`. Returns the span element, or null if none.
function findWordListMarker(p) {
  for (const span of p.querySelectorAll('span')) {
    const st = (span.getAttribute('style') || '').toLowerCase();
    if (st.includes('mso-list') && st.includes('ignore')) return span;
  }
  return null;
}

// Drop leading whitespace/nbsp-only text nodes and left-trim the first real
// text node — removes the gap the marker span left behind.
function trimLeadingWhitespace(el) {
  while (el.firstChild && el.firstChild.nodeType === 3) {
    const text = el.firstChild.textContent.replace(/ /g, ' ');
    if (!text.trim()) {
      el.removeChild(el.firstChild);
      continue;
    }
    el.firstChild.textContent = text.replace(/^\s+/, '');
    break;
  }
}

// Wrap runs of adjacent <li data-wl> siblings (produced above) into a single
// <ul>/<ol>. A run breaks on any non-li element; whitespace text between items
// is dropped so it can't split a run. The list type comes from each item's
// data-wl flag — a switch from ul to ol starts a new list.
function groupWordListItems(doc, root) {
  const parents = new Set();
  for (const li of root.querySelectorAll('li[data-wl]')) {
    const parent = li.parentNode;
    if (parent && parent.tagName !== 'UL' && parent.tagName !== 'OL') {
      parents.add(parent);
    }
  }
  for (const parent of parents) {
    let run = null;
    let runType = null;
    for (const node of Array.from(parent.childNodes)) {
      const isWlLi =
        node.nodeType === 1 &&
        node.tagName === 'LI' &&
        node.hasAttribute('data-wl');
      if (isWlLi) {
        const type = node.getAttribute('data-wl') === 'ol' ? 'ol' : 'ul';
        node.removeAttribute('data-wl');
        if (!run || runType !== type) {
          run = doc.createElement(type);
          runType = type;
          parent.insertBefore(run, node);
        }
        run.appendChild(node);
      } else if (node.nodeType === 3 && !node.textContent.trim()) {
        node.remove();
      } else {
        run = null;
        runType = null;
      }
    }
  }
}

// Bug fix: Google Docs + some Word exports wrap the entire pasted body in
// <b id="docs-internal-guid-..."> with an INLINE font-weight: normal style.
// TipTap's Bold mark parser treats a plain <b> as bold, so when our earlier
// style-stripping pass removed the "font-weight:normal" override, every
// character inherited the Bold mark and the whole paste appeared bold.
//
// Fix: before the style-stripping pass, unwrap any <b> or <strong> whose
// inline font-weight is explicitly "normal" or "400", OR whose id starts
// with "docs-internal-" (Google Docs auto-wrapper pattern). Actual bold
// formatting from the source (real <b>/<strong> without a normal override)
// is preserved unchanged.
function unwrapSpuriousBold(root) {
  const elts = root.querySelectorAll('b, strong');
  for (const el of Array.from(elts)) {
    const id = (el.getAttribute('id') || '').toLowerCase();
    const style = (el.getAttribute('style') || '').toLowerCase();
    const weight = /font-weight\s*:\s*([^;]+)/.exec(style)?.[1]?.trim();
    const isDocsWrapper = id.startsWith('docs-internal-');
    const isExplicitlyNormal = weight === 'normal' || weight === '400';
    if (isDocsWrapper || isExplicitlyNormal) {
      // Replace the <b>/<strong> with its children, preserving document order.
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
  }
}

// Convert semantic inline styles (bold / italic / underline) into the
// corresponding HTML tags, wrapping the element's existing children.
// Runs BEFORE style-stripping so Docs/Word paste preserves formatting:
// a Google Docs `<span style="font-weight:700">X</span>` becomes
// `<span><strong>X</strong></span>`, and when the style-stripper runs
// next the now-styleless `<span>` is dropped by ProseMirror's schema
// parser, leaving `<strong>X</strong>`.
//
// Policy:
//   * font-weight: 'bold' | 'bolder' | ≥ 600   → wrap in <strong>
//   * font-style:  'italic' | 'oblique'         → wrap in <em>
//   * text-decoration (line): 'underline'       → wrap in <u>
//
// Nothing else is inferred from styles. Colors, highlights, font
// families, sizes etc. remain out of scope for inline-style inference
// — the editor has explicit Color/Highlight/FontSize marks for those,
// applied through UI actions only.
function convertSemanticStylesToTags(doc, root) {
  // Walk a SNAPSHOT of the elements — we mutate as we go.
  const elts = root.querySelectorAll('[style]');
  for (const el of Array.from(elts)) {
    const styles = parseInlineStyles(el.getAttribute('style') || '');

    const wantBold = isBoldWeight(styles['font-weight']);
    const fs = styles['font-style'];
    const wantItalic = fs === 'italic' || fs === 'oblique';
    const td =
      styles['text-decoration-line'] || styles['text-decoration'] || '';
    const wantUnderline = /\bunderline\b/.test(td);

    if (!wantBold && !wantItalic && !wantUnderline) continue;

    // Empty element (no children) → nothing to wrap.
    if (!el.firstChild) continue;

    // Pop current children off el, build a nested chain of wrapper
    // tags around them, then put the whole chain back. Nesting order
    // is strong(em(u(content))) — any order is semantically identical
    // so we pick one deterministic shape.
    const kids = Array.from(el.childNodes);
    for (const k of kids) el.removeChild(k);

    // Innermost wrapper holds the original kids.
    let current;
    if (wantUnderline) {
      current = doc.createElement('u');
      for (const k of kids) current.appendChild(k);
    } else {
      current = null;
    }
    if (wantItalic) {
      const w = doc.createElement('em');
      if (current) w.appendChild(current);
      else for (const k of kids) w.appendChild(k);
      current = w;
    }
    if (wantBold) {
      const w = doc.createElement('strong');
      if (current) w.appendChild(current);
      else for (const k of kids) w.appendChild(k);
      current = w;
    }

    el.appendChild(current);
  }
}

function parseInlineStyles(style) {
  const out = {};
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim().toLowerCase();
    if (prop) out[prop] = val;
  }
  return out;
}

function isBoldWeight(raw) {
  if (!raw) return false;
  const v = String(raw).toLowerCase().trim();
  if (v === 'bold' || v === 'bolder') return true;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 600;
}

// Move `color` and `font-size` inline styles from non-span elements
// onto a wrapping <span> around their children. Runs AFTER the
// semantic-style pass (so bold/italic/underline wrapping is already in
// place) and BEFORE the whitelist stripper (so the newly-created span
// keeps the styles).
//
// Why wrap on a span specifically: TipTap's TextStyle mark — the
// carrier for Color and FontSize marks — only matches <span
// style="…"> during parseHTML. A <p style="color: red"> would lose
// its color because TextStyle doesn't apply to <p>. Wrapping the
// children in a <span style="color: red"> gives the TextStyle parser
// a proper target without bending the schema.
//
// If the element is already a <span>, nothing to do — the style stays
// on it and the whitelist preserves it.
function promoteColorAndSizeToSpans(doc, root) {
  // Snapshot — we're mutating the tree as we iterate.
  const elts = Array.from(root.querySelectorAll('[style]'));
  for (const el of elts) {
    if (el.tagName === 'SPAN') continue;
    if (!el.firstChild) continue;

    const styles = parseInlineStyles(el.getAttribute('style') || '');
    const color = normalizeColor(styles['color']);
    const fontSize = normalizeFontSize(styles['font-size']);
    if (!color && !fontSize) continue;

    const styleParts = [];
    if (color) styleParts.push(`color: ${color}`);
    if (fontSize) styleParts.push(`font-size: ${fontSize}`);

    const span = doc.createElement('span');
    span.setAttribute('style', styleParts.join('; '));

    const kids = Array.from(el.childNodes);
    for (const k of kids) {
      el.removeChild(k);
      span.appendChild(k);
    }
    el.appendChild(span);
  }
}

// Rename pasted h4/h5/h6 to h3, preserving attributes (dir, etc.) and children.
// Runs before the whitelist stripper so the moved attributes are then filtered
// normally. Deepest-first isn't needed — these tags don't nest in practice.
function downgradeHeadings(doc, root) {
  for (const el of Array.from(root.querySelectorAll('h4, h5, h6'))) {
    const h3 = doc.createElement('h3');
    for (const a of Array.from(el.attributes)) h3.setAttribute(a.name, a.value);
    while (el.firstChild) h3.appendChild(el.firstChild);
    el.parentNode?.replaceChild(h3, el);
  }
}

function cleanSubtree(root) {
  // Depth-first, using a snapshot of children so removing from the tree is safe.
  for (const child of Array.from(root.children)) {
    const tag = child.tagName;
    if (DROP_TAGS.has(tag) || OFFICE_TAG_PREFIX.test(tag)) {
      child.remove();
      continue;
    }
    cleanSubtree(child);
    cleanAttributes(child);
  }
}

function cleanAttributes(el) {
  const keepForTag = KEEP_ATTRS_BY_TAG[el.tagName] || null;
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();

    if (keepForTag && keepForTag.has(name)) continue;
    if (PRESERVED_DATA_ATTRS.has(name)) continue;
    if (GLOBAL_KEEP_ATTRS.has(name)) {
      // Keep only well-formed direction values; drop anything else.
      if (name === 'dir') {
        const v = (attr.value || '').toLowerCase();
        if (v === 'ltr' || v === 'rtl') continue;
      } else {
        continue;
      }
    }

    if (name === 'style') {
      const kept = [];
      for (const decl of (attr.value || '').split(';')) {
        const colon = decl.indexOf(':');
        if (colon < 0) continue;
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const val = decl.slice(colon + 1).trim();
        const sanitized = validatePastedStyle(el.tagName, prop, val);
        if (sanitized != null) kept.push(`${prop}: ${sanitized}`);
      }
      if (kept.length) el.setAttribute('style', kept.join('; '));
      else el.removeAttribute('style');
      continue;
    }

    el.removeAttribute(attr.name);
  }
}
