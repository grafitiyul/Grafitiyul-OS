import sanitizeHtml from 'sanitize-html';
import { normalizeEmailColors } from './emailColors.js';

// Server-side HTML sanitization AT INGEST (defence layer 1; the client also
// renders inside a sandboxed iframe with scripts disabled — layer 2). Email
// HTML keeps tables + inline styles (real-world newsletters/signatures break
// without them) but loses scripts, event handlers, forms and non-http(s)
// resource URLs. cid: inline-image refs are dropped — inline images surface
// through the attachments list instead.

const OPTIONS = {
  allowedTags: [
    // `mark` = highlight / text background. The editor's Highlight extension
    // emits <mark style="background-color:…">; without it here the tag was
    // discarded (text kept, background silently lost) on BOTH send and ingest.
    'a', 'b', 'i', 'u', 's', 'em', 'strong', 'mark', 'p', 'div', 'span', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
    'img', 'font', 'center', 'small', 'sub', 'sup',
  ],
  allowedAttributes: {
    '*': ['style', 'dir', 'align', 'valign', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['face', 'size', 'color'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // cid: = RFC 2392 inline-image references — kept so the thread view can
  // swap them for presigned attachment URLs at render time (nothing loads
  // from a cid: URL directly; unresolved ones simply don't render).
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  transformTags: {
    // External links open outside the app and never keep an opener handle.
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
  // Keep text content of disallowed containers, drop these entirely:
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
};

export function sanitizeEmailHtml(html) {
  if (!html) return null;
  const clean = sanitizeHtml(String(html), OPTIONS).trim();
  if (!clean) return null;
  // Theme-hostile colour normalization runs HERE, after tag/attribute
  // sanitization, so it covers already-stored content as well as new pastes:
  // a near-black foreground copied from Word assumes a white page and turns
  // unreadable on a dark client. See emailColors.js for the exact rule.
  return normalizeEmailColors(clean) || null;
}
