// Runs on every paste via TipTap's editorProps.transformPastedHTML, BEFORE
// ProseMirror parses the HTML into nodes. Its job:
//   - remove Word/Google-Docs noise (classes, mso-* attrs, <o:p>, meta/style)
//   - strip all inline styles except a narrow allow-list (text-align)
//   - preserve dynamic-field chip markers (data-type, data-field-key)
//   - preserve <a href> so links survive
//   - normalise the SOURCE's visible line/paragraph structure into the
//     structure that renders identically on the TARGET surface (see
//     pastePlainText.js for the two rhythms, 'spaced' and 'tight')
//
// Structure normalisation recognises the two ways HTML sources encode
// multi-line text:
//
//   LINE-MODEL sources — each visual line is a bare <div> (Gmail compose,
//   VS Code, many chat apps), an inline run inside a block container
//   (anonymous box), or a literal \n inside inline/pre-wrap markup
//   (WhatsApp Web, Gmail plain-text bodies). Divs/anonymous boxes render
//   with NO margins at the source, so consecutive lines are visually tight
//   and a blank line is an explicit `<div><br></div>`. These are rebuilt
//   through the ONE plain-text contract: lines group into paragraphs with
//   soft <br> breaks; blank lines map per the target rhythm.
//
//   PARAGRAPH-MODEL sources — real <p>/<h*>/<ul>/<blockquote> blocks
//   (ChatGPT, Word, Docs, articles). These render WITH margins at the
//   source, so adjacent blocks already look separated. They pass through
//   as blocks; on a 'tight' target (zero margins) the gap the author saw
//   is materialised as an explicit empty paragraph between blocks.
//
// Leading/trailing blank blocks are always trimmed (same edge rule as the
// plain-text contract) — a sloppy source selection must not inject blank
// lines before/after the pasted content.
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

export function sanitizePastedHtml(html, rhythm = 'spaced') {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Word/Docs leave conditional-comment nodes (<!--[if !supportLists]-->,
    // <o:p> markers). Drop comment nodes up front so they can't wedge between
    // list markers and their text.
    stripComments(doc.body);
    // Sources that carry their line structure as LITERAL newlines inside
    // inline markup (WhatsApp Web message spans, Gmail plain-text
    // white-space:pre-wrap divs) collapse into one unformatted block when the
    // DOM treats \n as ordinary whitespace. Restore the structure BEFORE any
    // other pass — see the function for the (deliberately narrow) rules.
    restoreLiteralNewlines(doc, doc.body, rhythm);
    // Emoji/tiny-icon <img> normalization MUST run before cleanAttributes
    // strips width/height/class — that sizing evidence is what identifies an
    // inline emoji sprite vs a real content image.
    normalizeEmojiImages(doc.body);
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
    // LINE-MODEL normalisation: unwrap structural <div>s, wrap bare inline
    // runs (CSS anonymous boxes — Chrome's clipboard serializer emits Gmail
    // plain-text bodies as `<span>…</span><br><span>…</span>` with no block
    // at all), then rebuild the line runs into real paragraphs through the
    // plain-text contract. MUST run while the topology is still the source's:
    // in particular BEFORE promoteColorAndSizeToSpans, which used to wrap a
    // div's children — including block children and blank-line <br><br>
    // markers — in a <span>, destroying the very structure this pass reads
    // (the real-Gmail paste-collapse bug).
    convertDivsToParagraphs(doc, doc.body, rhythm);
    // Color and font-size are also commonly carried as inline styles,
    // but unlike weight/style/decoration they don't have semantic
    // tags — they map onto TipTap's TextStyle mark, which ONLY parses
    // from <span> elements. Transplant color/size from non-span
    // elements (<p>, <li>, etc.) onto a wrapping <span> so TextStyle
    // picks them up. The whitelist below then preserves the styles on
    // the span and strips them from every other element. (Line divs are
    // already gone by now — their Chrome computed-style color noise is
    // deliberately dropped with them.)
    promoteColorAndSizeToSpans(doc, doc.body);
    // StarterKit only supports h1–h3. Map pasted h4–h6 down to h3 so deep
    // headings stay headings ("reasonable headings") instead of being dropped
    // to plain paragraphs by the schema parser.
    downgradeHeadings(doc, doc.body);
    // 'tight' targets render paragraph margins as ZERO — the gap the author
    // saw between paragraph-model blocks must become an explicit blank line.
    if (rhythm === 'tight') insertTightGaps(doc, doc.body);
    // Edge rule (same as the plain-text contract): no blank lines at the
    // start or end of the pasted fragment, whatever the source selection
    // dragged in.
    trimEdgeBlankBlocks(doc.body);
    cleanSubtree(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

// ── Pasted emoji images → Unicode ────────────────────────────────────────────
// WhatsApp Web, Slack, Google Docs and many sites copy emoji as <img>
// elements (twemoji-style sprites carrying the real character in `alt`, or
// tiny inline PNGs). Left alone, MediaImage's bare-img parse rule turns each
// into a full-column BLOCK figure — a 20px emoji becomes a giant image that
// splits the paragraph (production bug). Policy:
//   • emoji-only alt  → replace the <img> with its Unicode alt text
//   • tiny icon (≤48px declared, or an emoji-ish class) → its alt text is the
//     content; without alt it is decoration and is dropped
//   • data: URI      → dropped (alt text kept). Real images go through the
//     media-upload toolbar (R2); allowBase64:false was always the intent —
//     the bare-img parse rule bypassed it and base64 blobs reached the DB.
// Legitimate content images (real src, no tiny sizing) are untouched.

// Emoji-only test: at least one pictograph/flag, and nothing but emoji
// machinery (components, ZWJ, variation selectors, keycap, whitespace).
// Emoji_Component alone is not enough — it matches plain digits.
const HAS_EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Regional_Indicator}‍️⃣\s]+$/u;

function isEmojiAlt(alt) {
  const t = String(alt || '').trim();
  return !!t && t.length <= 24 && HAS_EMOJI_RE.test(t) && EMOJI_ONLY_RE.test(t);
}

function declaredPx(img, name) {
  const attr = img.getAttribute(name);
  if (attr) {
    const n = Number(String(attr).replace(/px$/i, '').trim());
    if (Number.isFinite(n)) return n;
  }
  const style = img.getAttribute('style') || '';
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i').exec(style);
  return m ? Number(m[1]) : null;
}

function normalizeEmojiImages(body) {
  for (const img of [...body.querySelectorAll('img')]) {
    const alt = (img.getAttribute('alt') || '').trim();
    const cls = img.getAttribute('class') || '';
    const w = declaredPx(img, 'width');
    const h = declaredPx(img, 'height');
    const tiny =
      (w != null && w <= 48) || (h != null && h <= 48) || /(^|[\s_-])emoji([\s_-]|$)/i.test(cls);
    const dataUri = (img.getAttribute('src') || '').trim().toLowerCase().startsWith('data:');
    if (!isEmojiAlt(alt) && !tiny && !dataUri) continue; // real content image
    if (alt) img.replaceWith(body.ownerDocument.createTextNode(alt));
    else img.remove();
  }
}

// ── Literal-newline restoration ──────────────────────────────────────────────
// Two narrow, deliberate rules — NEVER applied to ordinary pretty-printed HTML
// (where \n between tags is meaningless formatting whitespace):
//
//   1. INLINE-ONLY fragment: the paste contains no block elements and no <br>
//      at all (e.g. WhatsApp Web copies a multi-line message as one
//      <span class="copyable-text">line1\nline2</span>). The literal newlines
//      ARE the only structure.
//
//   2. A BLOCK element whose INLINE style declares white-space: pre / pre-wrap
//      / pre-line (Gmail plain-text bodies): its own newlines are meaningful
//      by declaration. An INLINE pre-wrap element only gets soft breaks (a
//      span mid-paragraph must not spawn paragraphs).
//
// The restored STRUCTURE follows the same plain-text contract as the editor's
// clipboardTextParser (client/src/editor/pastePlainText.js): a blank line is a
// PARAGRAPH break (extra blank lines become intentional empty paragraphs), a
// single newline is a soft <br>, and leading/trailing blank content is
// trimmed. Inline formatting (<b>, <a>, spans…) is carried into the rebuilt
// paragraphs untouched.
//
// Word / Google Docs / web-page pastes always contain block elements, so rule
// 1 never touches them, and they don't declare pre-wrap inline, so neither
// does rule 2. Runs before every other pass.
const NEWLINE_BLOCKISH_SELECTOR =
  'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, br, blockquote, pre, table, figure, section, article';

// Soft-break-only conversion (inline contexts): every \n run inside text nodes
// becomes exactly one <br> per newline.
function textToBreaks(doc, container) {
  // SHOW_TEXT = 4. Snapshot first — we replace nodes while iterating.
  const walker = doc.createTreeWalker(container, 4);
  const texts = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('\n')) texts.push(walker.currentNode);
  }
  for (const t of texts) {
    const parts = t.nodeValue.split('\n');
    const frag = doc.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i) frag.appendChild(doc.createElement('br'));
      if (part) frag.appendChild(doc.createTextNode(part));
    });
    t.parentNode?.replaceChild(frag, t);
  }
}

// Rebuild a container whose only structure is literal newlines into real
// paragraphs. Child nodes are walked in order: text nodes split the flow
// (blank lines map per the rhythm — see pastePlainText.js — and \n = <br>);
// inline ELEMENTS are moved whole into the current paragraph (their own inner
// newlines become soft breaks). Edge-empty paragraphs are dropped. Produced
// paragraphs are tagged as line-derived (see LINE_MARK) so the tight-gap pass
// never spaces them apart.
function restructureIntoParagraphs(doc, container, rhythm) {
  const paragraphs = [];
  let current = doc.createElement('p');
  const flush = () => {
    current.setAttribute(LINE_MARK, '1');
    paragraphs.push(current);
    current = doc.createElement('p');
  };
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 && node.nodeValue.includes('\n')) {
      const segments = node.nodeValue.split(/(\n{2,})/);
      for (const seg of segments) {
        if (!seg) continue;
        if (/^\n{2,}$/.test(seg)) {
          // A run of n newlines = (n-1) blank lines in the author's source.
          // 'spaced': the first blank is the paragraph separator, each one
          // beyond it is an intentional empty line. 'tight': every blank
          // line is an explicit empty paragraph.
          flush();
          const from = rhythm === 'tight' ? 1 : 2;
          for (let i = from; i < seg.length; i += 1) flush();
          continue;
        }
        const lines = seg.split('\n');
        lines.forEach((line, i) => {
          if (i) current.appendChild(doc.createElement('br'));
          if (line) current.appendChild(doc.createTextNode(line));
        });
      }
    } else {
      if (node.nodeType === 1) textToBreaks(doc, node); // inner newlines → soft breaks
      current.appendChild(node);
    }
  }
  flush();

  const isEmptyPara = (p) => !p.textContent.trim() && !p.querySelector('img, video, br');
  while (paragraphs.length && isEmptyPara(paragraphs[0])) paragraphs.shift();
  while (paragraphs.length && isEmptyPara(paragraphs[paragraphs.length - 1])) paragraphs.pop();
  // Trim stray edge <br>s inside the first/last paragraphs (no empty lines at
  // the start or end of the note).
  for (const p of [paragraphs[0], paragraphs[paragraphs.length - 1]]) {
    if (!p) continue;
    while (p.firstChild && p.firstChild.nodeName === 'BR') p.removeChild(p.firstChild);
    while (p.lastChild && p.lastChild.nodeName === 'BR') p.removeChild(p.lastChild);
  }

  container.textContent = '';
  for (const p of paragraphs) container.appendChild(p);
}

const BLOCK_LEVEL = new Set(['DIV', 'P', 'BLOCKQUOTE', 'TD', 'LI', 'BODY']);

function restoreLiteralNewlines(doc, body, rhythm) {
  // Rule 2 first: explicit inline pre-wrap declarations (checked before the
  // attribute stripper removes them). <pre> itself is left to the schema.
  for (const el of Array.from(body.querySelectorAll('[style]'))) {
    if (el.tagName === 'PRE') continue;
    const ws = parseInlineStyles(el.getAttribute('style') || '')['white-space'] || '';
    if (/^pre(-wrap|-line)?$/.test(ws) && el.textContent.includes('\n')) {
      if (BLOCK_LEVEL.has(el.tagName)) restructureIntoParagraphs(doc, el, rhythm);
      else textToBreaks(doc, el);
    }
  }
  // Rule 1: the whole fragment is inline-only — the newlines are the structure.
  if (!body.querySelector(NEWLINE_BLOCKISH_SELECTOR) && body.textContent.includes('\n')) {
    // WhatsApp wraps the whole message in one neutral <span> — descend through
    // single-span wrappers so the paragraphs are built from the actual text,
    // then hoist them out of the wrapper (carrying its dir).
    let target = body;
    for (;;) {
      const kids = Array.from(target.childNodes).filter(
        (n) => !(n.nodeType === 3 && !n.nodeValue.trim()),
      );
      if (kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === 'SPAN') {
        target = kids[0];
        continue;
      }
      break;
    }
    restructureIntoParagraphs(doc, target, rhythm);
    if (target !== body) {
      const dir = (target.getAttribute('dir') || '').toLowerCase();
      for (const p of Array.from(target.children)) {
        if ((dir === 'ltr' || dir === 'rtl') && !p.getAttribute('dir')) p.setAttribute('dir', dir);
      }
      const parent = target.parentNode;
      while (target.firstChild) parent.insertBefore(target.firstChild, target);
      parent.removeChild(target);
    }
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
// (contains other blocks → unwrap) or a leaf line (inline content only).
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'HR',
]);

// Marker for paragraphs REBUILT from line-model sources (literal newlines,
// div-per-line). The tight-gap pass must not space these apart — their source
// rendered them margin-less. Never survives into the output: cleanAttributes
// strips every non-whitelisted attribute at the end of the pipeline.
const LINE_MARK = 'data-gos-line';

// LINE-MODEL normalisation for div-based sources (Gmail compose, VS Code,
// chat apps): a bare <div> renders with NO margin at the source, so a run of
// sibling leaf divs is a run of LINES, and `<div><br></div>` is an explicit
// blank line — the exact plain-text contract, just spelled in DOM. Rebuild
// each run through that contract so a Gmail paste and a text/plain paste of
// the same message produce the same structure.
//
// Two phases:
//   1. Structural <div>s (containing other blocks) are unwrapped, after
//      first wrapping any bare inline runs among their children into
//      synthetic line-divs. That inline-run wrapping is not a guess — the
//      CSS box model renders such runs as anonymous block boxes, i.e. as
//      margin-less LINES (Gmail's first message line is exactly this shape).
//   2. Runs of sibling leaf divs become paragraphs: consecutive non-blank
//      lines join into one <p> with soft <br> breaks; blank divs map per the
//      rhythm ('spaced': paragraph separator, extras become empty
//      paragraphs; 'tight': every blank is an explicit empty paragraph).
//      A change of dir/text-align closes the current paragraph (those are
//      block-level attributes and must survive per line-group).
function convertDivsToParagraphs(doc, root, rhythm) {
  // Phase 1 — reverse document order = deepest-first: inner divs resolve
  // before the outer divs that contain them, so unwrapping never orphans a
  // child.
  for (const div of Array.from(root.querySelectorAll('div')).reverse()) {
    // Our own structural wrappers (media embeds) carry data-type and rebuild
    // themselves on parse — never touch them or their inner divs.
    if (div.closest('[data-type]')) continue;
    const parent = div.parentNode;
    if (!parent) continue;
    const hasBlockChild = Array.from(div.children).some((c) => BLOCK_TAGS.has(c.tagName));
    if (!hasBlockChild) continue; // leaf line div — phase 2 material
    wrapInlineRunsAsLines(doc, div);
    while (div.firstChild) parent.insertBefore(div.firstChild, div);
    parent.removeChild(div);
  }

  // Phase 1b — the body itself can carry bare line runs: Chrome's clipboard
  // serializer emits a Gmail plain-text body as `<span>…</span><br><span>…`
  // with NO block element at all, and a partially-selected first line arrives
  // as bare inline content next to divs. The CSS box model renders such runs
  // as anonymous block boxes — i.e. margin-less LINES — so wrap them like any
  // other line. Only when the fragment actually HAS line structure (a block
  // element or a top-level <br>); a plain inline snippet (a few copied words)
  // must stay inline so it merges at the cursor on paste.
  const bodyHasStructure = Array.from(root.children).some(
    (c) => BLOCK_TAGS.has(c.tagName) || c.tagName === 'BR',
  );
  if (bodyHasStructure) wrapInlineRunsAsLines(doc, root);

  // Phase 2 — group each run of sibling leaf divs. Collect the runs' parents
  // (a leaf div can now only sit under body or a surviving block container).
  const parents = new Set();
  for (const div of root.querySelectorAll('div')) {
    if (div.closest('[data-type]')) continue;
    if (div.parentNode) parents.add(div.parentNode);
  }
  for (const parent of parents) groupLineDivRuns(doc, parent, rhythm);
}

// Wrap every maximal run of inline children (text / spans / <b> / <a> and the
// <br>s BETWEEN them) of a container into a synthetic <div>, so phase 2 treats
// the run as the lines the browser rendered it as (anonymous block box). The
// <br>s inside the run are handled by the segments rule in lineSegments().
function wrapInlineRunsAsLines(doc, container) {
  const isInline = (n) =>
    (n.nodeType === 3 && n.nodeValue.trim()) ||
    (n.nodeType === 1 && !BLOCK_TAGS.has(n.tagName) && !n.hasAttribute?.('data-type'));
  let run = null;
  for (const node of Array.from(container.childNodes)) {
    if (isInline(node)) {
      if (!run) {
        run = doc.createElement('div');
        container.insertBefore(run, node);
      }
      run.appendChild(node);
    } else if (!isWhitespaceText(node)) {
      run = null; // block boundary (whitespace-only text doesn't break a run)
    }
  }
}

function isWhitespaceText(node) {
  return node.nodeType === 3 && !node.nodeValue.trim();
}

// Visible-content test for a set of nodes: any real text (NBSP is not
// content), or any media element.
function hasVisibleContent(nodes) {
  for (const n of nodes) {
    if (n.nodeType === 3 && n.nodeValue.replace(/ /g, ' ').trim()) return true;
    if (n.nodeType === 1) {
      if (n.matches?.('img, video, figure, iframe')) return true;
      if (n.querySelector?.('img, video, figure, iframe')) return true;
      if ((n.textContent || '').replace(/ /g, ' ').trim()) return true;
    }
  }
  return false;
}

// THE SEGMENTS RULE — a line container's direct children, split on top-level
// <br> runs, are its visual lines:
//   • a single <br> separates two lines;
//   • a run of n ≥ 2 <br>s renders (n-1) blank lines between the segments;
//   • a trailing <br> run at the very end of the container renders nothing
//     beyond its blank count (a single trailing <br> is a serialization
//     artifact and disappears).
// Returns [{ blank: true } | { nodes: [...] }] in visual order.
// This is what makes `<div>p1<br><br></div><div>p2</div>` and
// `<span>p1</span><br><br><span>p2</span>` (both real Chrome/Gmail clipboard
// shapes) equal to the plain text "p1\n\np2".
function lineSegments(container) {
  const segments = [];
  let cur = [];
  let brRun = 0;
  const flushSegment = () => {
    segments.push({ nodes: cur, empty: !hasVisibleContent(cur) });
    cur = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 1 && child.tagName === 'BR') {
      if (brRun === 0) flushSegment();
      else segments.push({ nodes: [], empty: true }); // each extra <br> = one blank line
      brRun += 1;
      continue;
    }
    if (isWhitespaceText(child) && cur.length === 0) continue; // leading formatting whitespace
    brRun = 0;
    cur.push(child);
  }
  flushSegment();
  // A trailing <br> run leaves one empty segment beyond its blanks — drop it.
  if (brRun > 0 && segments.length && segments[segments.length - 1].empty) segments.pop();

  return segments.map((s) => (s.empty ? { blank: true } : { nodes: s.nodes }));
}

function lineGroupKey(div) {
  const dir = (div.getAttribute('dir') || '').toLowerCase();
  const ta = (parseInlineStyles(div.getAttribute('style') || '')['text-align'] || '').toLowerCase();
  return [
    dir === 'ltr' || dir === 'rtl' ? dir : '',
    /^(left|right|center|justify)$/.test(ta) ? ta : '',
  ].join('|');
}

function groupLineDivRuns(doc, parent, rhythm) {
  let group = null; // current open <p>
  let groupKey = null;
  let pendingBlanks = 0;
  let runStarted = false;

  const closeGroup = () => {
    group = null;
    groupKey = null;
  };
  const emitBlanks = (beforeNode) => {
    if (!pendingBlanks) return;
    // Blank lines mid-run: 'spaced' → the first blank is the paragraph
    // separator (extras are explicit empty paragraphs); 'tight' → every
    // blank line is an explicit empty paragraph. Leading blanks (before any
    // text line) are dropped here and the edge-trim pass guards the tail.
    if (runStarted) {
      const empties = rhythm === 'tight' ? pendingBlanks : pendingBlanks - 1;
      for (let i = 0; i < empties; i += 1) {
        const empty = doc.createElement('p');
        empty.setAttribute(LINE_MARK, '1');
        parent.insertBefore(empty, beforeNode);
      }
    }
    pendingBlanks = 0;
    closeGroup();
  };
  const emitLine = (beforeNode, key, nodes) => {
    emitBlanks(beforeNode);
    if (!group || key !== groupKey) {
      group = doc.createElement('p');
      group.setAttribute(LINE_MARK, '1');
      const [dir, ta] = key.split('|');
      if (dir) group.setAttribute('dir', dir);
      if (ta) group.setAttribute('style', `text-align: ${ta}`);
      parent.insertBefore(group, beforeNode);
      groupKey = key;
    } else {
      group.appendChild(doc.createElement('br'));
    }
    for (const n of nodes) group.appendChild(n);
    runStarted = true;
  };

  for (const node of Array.from(parent.childNodes)) {
    const isLeafLineDiv =
      node.nodeType === 1 &&
      node.tagName === 'DIV' &&
      !node.hasAttribute('data-type') &&
      !Array.from(node.children).some((c) => BLOCK_TAGS.has(c.tagName));

    if (!isLeafLineDiv) {
      if (isWhitespaceText(node)) continue; // formatting whitespace between divs
      // Any real block/inline boundary ends the current line run.
      pendingBlanks = 0;
      runStarted = false;
      closeGroup();
      continue;
    }

    // The div's visual lines per the segments rule; all share the div's
    // dir/text-align group key.
    const key = lineGroupKey(node);
    for (const seg of lineSegments(node)) {
      if (seg.blank) pendingBlanks += 1;
      else emitLine(node, key, seg.nodes);
    }
    parent.removeChild(node);
  }
}

// 'tight' faces render paragraph margins as zero, but PARAGRAPH-MODEL blocks
// (<p>, headings, lists, blockquote, pre) were visually separated by margins
// at the source. Materialise that gap as one explicit empty paragraph between
// adjacent blocks — except between two line-derived paragraphs (their source
// was margin-less) and never next to an already-blank paragraph (an explicit
// blank must not be doubled).
const TIGHT_GAP_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);

function isBlankParagraph(el) {
  if (el.tagName !== 'P') return false;
  if (el.querySelector('img, video, figure, iframe, [data-type]')) return false;
  const onlyBreaks = !Array.from(el.childNodes).some(
    (n) => !(n.nodeName === 'BR' || (n.nodeType === 3 && !n.nodeValue.replace(/ /g, ' ').trim())),
  );
  return onlyBreaks;
}

function insertTightGaps(doc, body) {
  for (const el of Array.from(body.children)) {
    const next = el.nextElementSibling;
    if (!next) continue;
    if (!TIGHT_GAP_TAGS.has(el.tagName) || !TIGHT_GAP_TAGS.has(next.tagName)) continue;
    const bothLineDerived = el.hasAttribute(LINE_MARK) && next.hasAttribute(LINE_MARK);
    if (bothLineDerived) continue;
    if (isBlankParagraph(el) || isBlankParagraph(next)) continue;
    body.insertBefore(doc.createElement('p'), next);
  }
}

// No blank lines at the start or end of the pasted fragment — the edge rule
// of the plain-text contract, applied to the HTML path (sloppy selections
// commonly drag in leading/trailing `<div><br></div>` / `<p>&nbsp;</p>`).
function trimEdgeBlankBlocks(body) {
  const isBlankEdge = (n) =>
    (n.nodeType === 3 && !n.nodeValue.trim()) ||
    (n.nodeType === 1 && (n.tagName === 'BR' || isBlankParagraph(n)));
  while (body.firstChild && isBlankEdge(body.firstChild)) body.removeChild(body.firstChild);
  while (body.lastChild && isBlankEdge(body.lastChild)) body.removeChild(body.lastChild);
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
    // NEVER wrap block-level children in a <span>: that inverts the block/
    // inline topology (span>div / span>p), which defeats the structural
    // passes and produces invalid nesting the DOM parser then "fixes" into
    // stray empty paragraphs. (Chrome's clipboard serializer puts a computed
    // color style on EVERY copied element, including structural wrappers —
    // the real-Gmail signature-block corruption.) Color/size on a block
    // container isn't representable as a TextStyle mark anyway — descend to
    // the inline level naturally via the children's own inline styles.
    if (Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName))) continue;

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
