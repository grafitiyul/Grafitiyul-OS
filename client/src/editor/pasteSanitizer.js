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

const PRESERVED_STYLE_PROPS = {
  'text-align': /^(right|left|center|justify)$/i,
};

const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK']);

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
};

export function sanitizePastedHtml(html) {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    cleanSubtree(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
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
        const re = PRESERVED_STYLE_PROPS[prop];
        if (re && re.test(val)) kept.push(`${prop}: ${val}`);
      }
      if (kept.length) el.setAttribute('style', kept.join('; '));
      else el.removeAttribute('style');
      continue;
    }

    el.removeAttribute(attr.name);
  }
}
