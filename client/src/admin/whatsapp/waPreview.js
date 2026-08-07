import { getDynamicFieldByKey } from '../../lib/dynamicFields.js';
import { parseWaMarkup } from './waFormat.js';

// THE WhatsApp AUTHORING preview renderer. Every surface that shows "how this
// message will look on WhatsApp" renders through here — the Communication
// Center editor, the delivery simulator, the Team composer. One renderer means
// a message can never look one way while being composed and another way while
// being reviewed.
//
// It renders the WhatsApp MARKUP (the exact text the bridge transmits, produced
// by shared/waMarkup.mjs) rather than the editor's HTML, so the preview is a
// view of what leaves the system, not of what the editor happens to hold.
//
// Two states, ONE renderer:
//   template — variables still present, drawn as chips (authoring).
//   resolved — variables already substituted for a real recipient; there are no
//              tokens left, so the same code simply renders the formatting.
// A token that survives into a resolved text is a MISSING value, and rendering
// it as a chip is exactly right: it shows the operator what will be absent.
//
// The GRAMMAR itself is not here — it lives in waFormat.js, shared with the
// live conversation renderer (WaText.jsx). This module only decides how the
// parsed nodes are PAINTED as an HTML string.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const WRAP = { bold: 'strong', italic: 'em', strike: 's' };

function paint(nodes) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += esc(n.value);
        break;
      case 'break':
        out += '<br>';
        break;
      case 'code':
        out += `<code class="rounded bg-black/10 px-1">${esc(n.value)}</code>`;
        break;
      case 'link':
        // Flat styling on purpose: an authoring preview shows that the URL will
        // be a link, it is not itself a place to click through to customers.
        out += `<span class="text-sky-700 underline">${esc(n.text)}</span>`;
        break;
      case 'variable': {
        const f = getDynamicFieldByKey(n.key);
        out += `<span class="mx-0.5 inline-flex items-center rounded bg-blue-100 px-1 text-[0.85em] font-medium text-blue-800">${esc(f?.label || n.key)}</span>`;
        break;
      }
      default:
        out += `<${WRAP[n.type]}>${paint(n.children || [])}</${WRAP[n.type]}>`;
    }
  }
  return out;
}

/** WhatsApp markup → styled preview HTML. Tokens render as chips. */
export function waPreviewHtml(markup) {
  return paint(parseWaMarkup(markup, { variables: true }));
}
