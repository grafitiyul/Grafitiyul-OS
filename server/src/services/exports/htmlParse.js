// Minimal HTML parser tuned to the subset TipTap emits in the bank.
// Returns a small block-level tree the DOCX and print-HTML renderers walk.
//
// Recognised inline:   <strong>/<b>, <em>/<i>, <u>, <s>/<strike>, <a>,
//                      <span>, <br>, plain text
// Recognised block:    <p>, <h1>..<h6>, <ul>, <ol>, <li>,
//                      <blockquote>, <hr>, <div>, <figure>, <figcaption>
// Recognised media:    <img>, <video>, <iframe>, <div data-type="media-embed">
//
// Anything not recognised is treated as a transparent inline group — its
// text content survives, but no formatting is added. We don't attempt
// full CSS handling: TipTap encodes weight/style/decoration as tags
// (the paste sanitizer already converts inline styles → tags), so a
// tag-based pass captures everything that matters.

// Tokenize. A tiny state machine; the input is well-formed TipTap output.
function tokenize(html) {
  const tokens = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html[i] === '<') {
      // Comment.
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      // Tag.
      const end = html.indexOf('>', i);
      if (end < 0) {
        // Malformed — treat the rest as text so we don't lose it.
        tokens.push({ kind: 'text', text: html.slice(i) });
        break;
      }
      const raw = html.slice(i + 1, end);
      i = end + 1;
      const isClose = raw.startsWith('/');
      const body = isClose ? raw.slice(1) : raw;
      const selfClosing = body.endsWith('/');
      const cleaned = selfClosing ? body.slice(0, -1).trim() : body.trim();
      const spaceIdx = cleaned.search(/\s/);
      const name =
        (spaceIdx === -1
          ? cleaned
          : cleaned.slice(0, spaceIdx)
        ).toLowerCase();
      const attrs =
        spaceIdx === -1
          ? {}
          : parseAttrs(cleaned.slice(spaceIdx + 1));
      if (isClose) {
        tokens.push({ kind: 'close', name });
      } else if (selfClosing || VOID_TAGS.has(name)) {
        tokens.push({ kind: 'void', name, attrs });
      } else {
        tokens.push({ kind: 'open', name, attrs });
      }
    } else {
      const next = html.indexOf('<', i);
      const end = next < 0 ? n : next;
      const text = html.slice(i, end);
      if (text.length > 0) tokens.push({ kind: 'text', text });
      i = end;
    }
  }
  return tokens;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function parseAttrs(s) {
  const out = {};
  // name="value", name='value', name=value, name (boolean)
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = decodeEntities(value);
  }
  return out;
}

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
};

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITY_MAP[name] ?? m);
}

// Build a block-level tree. Inline runs inside a block are flattened to
// a list of text fragments with marks, plus inline media nodes.
//
// Tree node shapes:
//   { type: 'paragraph', level?: 1..6, alignment?, runs: Run[] }
//   { type: 'list', ordered: boolean, items: ListItem[] }
//   { type: 'image', src, alt }
//   { type: 'video', src, poster?, label }
//   { type: 'embed', provider, videoId, src, label }
//   { type: 'rule' }
//   { type: 'blockquote', children: Block[] }
//
// Run shapes:
//   { kind: 'text', text, bold, italic, underline, strike, link? }
//   { kind: 'image', src, alt }
//   { kind: 'mediaPlaceholder', label, href? }
//   { kind: 'lineBreak' }
//
// ListItem: { runs: Run[], children?: Block[] }  (children for nested lists)

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export function parseHtmlToBlocks(html) {
  if (!html || typeof html !== 'string') return [];
  const tokens = tokenize(html);

  // Walking cursor.
  let pos = 0;

  // Build a lightweight DOM first (open/close pairs) for predictable
  // recursion. Skips unknown closing tags rather than throwing.
  function readNodes(stopName) {
    const nodes = [];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.kind === 'close') {
        if (!stopName) {
          // Stray close; skip.
          pos++;
          continue;
        }
        if (t.name === stopName) {
          pos++;
          return nodes;
        }
        // Mismatched close: bubble up so the outer reader handles it.
        return nodes;
      }
      if (t.kind === 'text') {
        nodes.push({ kind: 'text', text: t.text });
        pos++;
        continue;
      }
      if (t.kind === 'void') {
        nodes.push({ kind: 'el', name: t.name, attrs: t.attrs, children: [] });
        pos++;
        continue;
      }
      // Open.
      pos++;
      const children = readNodes(t.name);
      nodes.push({ kind: 'el', name: t.name, attrs: t.attrs, children });
    }
    return nodes;
  }

  const rootNodes = readNodes(null);
  const blocks = [];
  for (const node of rootNodes) {
    pushBlocksFromNode(node, blocks, {});
  }
  return blocks;
}

function pushBlocksFromNode(node, blocks, marks) {
  if (node.kind === 'text') {
    const text = decodeEntities(node.text);
    if (!text.trim()) return;
    // Wrap loose text in a paragraph at the top level.
    blocks.push({
      type: 'paragraph',
      runs: [{ kind: 'text', text, ...marks }],
    });
    return;
  }
  const name = node.name;
  const attrs = node.attrs || {};

  if (HEADING_LEVELS[name]) {
    blocks.push({
      type: 'paragraph',
      level: HEADING_LEVELS[name],
      runs: collectInline(node.children, marks),
    });
    return;
  }
  if (name === 'p' || name === 'div') {
    // Some TipTap surfaces wrap blocks in <div>; we treat the contents as
    // children rather than a paragraph if any child is itself a block.
    if (childrenContainBlock(node.children)) {
      for (const c of node.children) pushBlocksFromNode(c, blocks, marks);
      return;
    }
    blocks.push({
      type: 'paragraph',
      runs: collectInline(node.children, marks),
    });
    return;
  }
  if (name === 'ul' || name === 'ol') {
    const items = [];
    for (const c of node.children) {
      if (c.kind === 'el' && c.name === 'li') {
        const itemBlocks = [];
        const itemRuns = [];
        for (const inner of c.children) {
          if (
            inner.kind === 'el' &&
            (inner.name === 'ul' || inner.name === 'ol')
          ) {
            // Nested list — keep as a child block for the renderer to indent.
            const nested = [];
            pushBlocksFromNode(inner, nested, marks);
            itemBlocks.push(...nested);
          } else {
            for (const run of collectInline([inner], marks)) {
              itemRuns.push(run);
            }
          }
        }
        items.push({ runs: itemRuns, children: itemBlocks });
      }
    }
    blocks.push({ type: 'list', ordered: name === 'ol', items });
    return;
  }
  if (name === 'blockquote') {
    const inner = [];
    for (const c of node.children) pushBlocksFromNode(c, inner, marks);
    blocks.push({ type: 'blockquote', children: inner });
    return;
  }
  if (name === 'hr') {
    blocks.push({ type: 'rule' });
    return;
  }
  if (name === 'figure') {
    // Figure wraps an image + optional caption.
    let imgNode = null;
    let caption = '';
    for (const c of node.children) {
      if (c.kind === 'el' && c.name === 'img') imgNode = c;
      else if (c.kind === 'el' && c.name === 'figcaption') {
        caption = nodesToText(c.children);
      } else if (c.kind === 'el' && c.name === 'video') {
        blocks.push(makeVideoBlock(c));
      } else if (
        c.kind === 'el' &&
        c.name === 'div' &&
        c.attrs?.['data-type'] === 'media-embed'
      ) {
        blocks.push(makeEmbedBlock(c));
      }
    }
    if (imgNode) {
      blocks.push({
        type: 'image',
        src: imgNode.attrs.src || '',
        alt: imgNode.attrs.alt || caption || '',
      });
      if (caption) {
        blocks.push({
          type: 'paragraph',
          runs: [{ kind: 'text', text: caption, italic: true }],
          alignment: 'center',
        });
      }
    }
    return;
  }
  if (name === 'img') {
    blocks.push({ type: 'image', src: attrs.src || '', alt: attrs.alt || '' });
    return;
  }
  if (name === 'video') {
    blocks.push(makeVideoBlock(node));
    return;
  }
  if (
    name === 'iframe' ||
    (name === 'div' && attrs['data-type'] === 'media-embed')
  ) {
    blocks.push(makeEmbedBlock(node));
    return;
  }
  // Anything else — flatten into a paragraph composed of its descendants.
  const runs = collectInline([node], marks);
  if (runs.length > 0) {
    blocks.push({ type: 'paragraph', runs });
  }
}

function makeVideoBlock(node) {
  const src = node.attrs?.src || nodeFirstChildAttr(node, 'source', 'src');
  return {
    type: 'video',
    src,
    label: 'סרטון',
  };
}

function makeEmbedBlock(node) {
  const a = node.attrs || {};
  return {
    type: 'embed',
    provider: a['data-provider'] || '',
    videoId: a['data-video-id'] || '',
    src: a['src'] || '',
    label: 'סרטון מוטמע',
  };
}

function nodeFirstChildAttr(node, childName, attr) {
  for (const c of node.children || []) {
    if (c.kind === 'el' && c.name === childName) return c.attrs?.[attr] || '';
  }
  return '';
}

function nodesToText(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += decodeEntities(n.text);
    else if (n.kind === 'el') out += nodesToText(n.children);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function childrenContainBlock(children) {
  for (const c of children) {
    if (c.kind !== 'el') continue;
    const n = c.name;
    if (
      n === 'p' || n === 'div' || HEADING_LEVELS[n] ||
      n === 'ul' || n === 'ol' || n === 'blockquote' || n === 'hr' ||
      n === 'figure' || n === 'video' || n === 'iframe'
    ) {
      return true;
    }
  }
  return false;
}

function collectInline(children, marks) {
  const runs = [];
  for (const c of children) walkInline(c, runs, marks);
  return runs;
}

function walkInline(node, runs, marks) {
  if (node.kind === 'text') {
    const text = decodeEntities(node.text);
    if (!text) return;
    runs.push({ kind: 'text', text, ...marks });
    return;
  }
  const name = node.name;
  const attrs = node.attrs || {};
  if (name === 'br') {
    runs.push({ kind: 'lineBreak' });
    return;
  }
  if (name === 'img') {
    runs.push({ kind: 'image', src: attrs.src || '', alt: attrs.alt || '' });
    return;
  }
  if (name === 'video') {
    runs.push({
      kind: 'mediaPlaceholder',
      label: 'סרטון',
      href: attrs.src || '',
    });
    return;
  }
  if (name === 'iframe') {
    runs.push({
      kind: 'mediaPlaceholder',
      label: 'סרטון מוטמע',
      href: attrs.src || '',
    });
    return;
  }
  let next = marks;
  if (name === 'strong' || name === 'b') next = { ...next, bold: true };
  else if (name === 'em' || name === 'i') next = { ...next, italic: true };
  else if (name === 'u') next = { ...next, underline: true };
  else if (name === 's' || name === 'strike' || name === 'del') {
    next = { ...next, strike: true };
  } else if (name === 'a') {
    next = { ...next, link: attrs.href || '' };
  }
  for (const c of node.children) walkInline(c, runs, next);
}
