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
    unwrapSpuriousBold(doc.body);
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
    cleanSubtree(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
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
