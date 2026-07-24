// THE one HTML → WhatsApp-markup serializer, shared by the server (the
// Communication Center delivery engine renders the stored editor HTML right
// before handing text to the bridge) and the client (the WhatsApp editor's
// live preview). One converter ⇒ what the author previews is exactly what the
// bridge transmits.
//
// Scope is deliberately LIMITED to formatting the WhatsApp provider (Baileys,
// plain text markup) reliably renders:
//   <strong>/<b>  →  *bold*
//   <em>/<i>      →  _italic_
//   <s>/<del>/<strike> → ~strike~
//   <code>        →  ```monospace```
//   <p>/<br>/<div>→  newlines (blank line between paragraphs)
//   <ul>/<ol>/<li>→  "- item" / "1. item" lines
//   <a href>      →  "label: url" (or just the url when the label IS the url)
//   variable chips (span[data-field-key="x"]) → {{x}}
// Anything else is stripped to its text content — the editor never offers
// formatting this converter can't transmit, and the converter never invents
// syntax WhatsApp can't render.
//
// Environment-free: a tiny hand-rolled HTML tokenizer (no DOM, no deps) so the
// exact same module runs in Node (server render/tests) and the browser
// (preview). Not a general-purpose HTML parser — it handles the constrained
// HTML our own TipTap editor emits, plus graceful degradation for pasted tags.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}

// Tokenize into { type:'text'|'open'|'close', ... } events.
function* tokens(html) {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) yield { type: 'text', text: html.slice(last, m.index) };
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const isClose = html[m.index + 1] === '/';
    yield { type: isClose ? 'close' : 'open', tag, attrs, selfClose: /\/>$/.test(m[0]) };
    last = re.lastIndex;
  }
  if (last < html.length) yield { type: 'text', text: html.slice(last) };
}

function attrValue(attrs, name) {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs || '');
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
}

const MARK_TAGS = {
  strong: '*', b: '*',
  em: '_', i: '_',
  s: '~', del: '~', strike: '~',
  code: '```',
};
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

// Wrap `inner` with a WhatsApp mark, keeping the markers glued to the visible
// text (WhatsApp only renders *x* when the asterisks touch non-space chars).
function applyMark(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m || !m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

/**
 * Convert editor HTML to WhatsApp plain-text markup.
 * Newline policy: paragraphs separated by ONE blank line; <br> = single
 * newline; an intentionally empty paragraph (<p></p>) adds an extra blank
 * line — mirroring what the author sees in the editor.
 */
export function htmlToWhatsApp(html) {
  if (html == null) return '';
  const src = String(html);
  if (!src.includes('<')) return decodeEntities(src).replace(/ /g, ' ').trim();

  // Recursive-descent over the token stream via an explicit frame stack.
  // Each frame accumulates its children's text, then its opening tag decides
  // how to wrap it (mark / list item / link / block).
  const root = { tag: null, out: '', attrs: '' };
  const stack = [root];
  const listStack = []; // { ordered, index }

  const top = () => stack[stack.length - 1];

  for (const t of tokens(src)) {
    if (t.type === 'text') {
      top().out += decodeEntities(t.text).replace(/[\t\r\n]+/g, ' ').replace(/ /g, ' ');
      continue;
    }
    if (t.type === 'open') {
      if (t.tag === 'br') { top().out += '\n'; continue; }
      if (t.tag === 'ul' || t.tag === 'ol') {
        listStack.push({ ordered: t.tag === 'ol', index: 0 });
        stack.push({ tag: t.tag, out: '', attrs: t.attrs });
        continue;
      }
      if (t.selfClose) continue; // unknown self-closing tag — ignore
      stack.push({ tag: t.tag, out: '', attrs: t.attrs });
      continue;
    }
    // close tag — find the matching open frame (tolerate mismatched HTML).
    if (stack.length === 1) continue;
    const frame = stack.pop();
    const parent = top();
    const tag = frame.tag;
    let inner = frame.out;

    // Variable chips: <span data-field-key="x">label</span> → {{x}}.
    if (tag === 'span') {
      const key = attrValue(frame.attrs, 'data-field-key');
      parent.out += key ? `{{${key}}}` : inner;
      continue;
    }
    if (MARK_TAGS[tag]) {
      parent.out += applyMark(MARK_TAGS[tag], inner);
      continue;
    }
    if (tag === 'a') {
      const href = attrValue(frame.attrs, 'href');
      const label = inner.trim();
      if (!href) parent.out += inner;
      else if (!label || label === href) parent.out += href;
      else parent.out += `${label}: ${href}`;
      continue;
    }
    if (tag === 'li') {
      const list = listStack[listStack.length - 1];
      const marker = list && list.ordered ? `${++list.index}.` : '-';
      parent.out += `${marker} ${inner.trim()}\n`;
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      listStack.pop();
      parent.out += `${inner.replace(/\n+$/, '')}\n\n`;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      // Preserve intentional empty paragraphs as blank lines.
      parent.out += `${inner.replace(/\s+$/, '')}\n\n`;
      continue;
    }
    // Unknown wrapper — keep the text only.
    parent.out += inner;
  }
  // Unclosed frames — flush their text.
  while (stack.length > 1) {
    const frame = stack.pop();
    top().out += frame.out;
  }

  return root.out
    .replace(/[ \t]+\n/g, '\n') // trailing spaces on lines
    .replace(/\n[ \t]+/g, '\n') // leading spaces on lines
    .replace(/\n{3,}/g, '\n\n') // collapse runs, keep intentional blank lines
    .replace(/^[\s]+|\s+$/g, ''); // trim document edges
}

/**
 * Plain text preview of the WhatsApp markup (markers stripped) — used for
 * length guidance and log summaries.
 */
export function whatsAppTextPreview(markup) {
  return String(markup ?? '')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/([*_~])(\S(?:[\s\S]*?\S)?)\1/g, '$2');
}
