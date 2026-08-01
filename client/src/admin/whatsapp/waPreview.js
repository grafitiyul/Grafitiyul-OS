import { getDynamicFieldByKey } from '../../lib/dynamicFields.js';

// THE WhatsApp preview renderer. Every surface that shows "how this message
// will look on WhatsApp" renders through here — the Communication Center
// editor, the delivery simulator, the Team composer, the message history. One
// renderer means a message can never look one way while being composed and
// another way while being reviewed.
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
// (Moved out of WhatsAppBodyEditor.jsx, which pulled TipTap into every consumer
// and made "the renderer" look like a detail of one editor.)

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * WhatsApp markup → styled preview HTML. Tokens render as chips.
 *
 * The formatting rules run over the author's own prose ONLY. Anything that is
 * not prose — code spans, variable chips, URLs — is lifted out first and put
 * back afterwards, because those routinely contain characters the markup rules
 * would otherwise eat:
 *
 *   {{customer_first_name}}          `_first_` read as italics
 *   https://grafitiyul.co.il/a_b_c   `_b_` read as italics
 *
 * Either one produces a preview that quietly misrepresents the message — the
 * exact failure this renderer exists to prevent.
 *
 * The placeholder is `<n>`: escaping has already turned every `<` in the
 * author's text into `&lt;`, so no message content can impersonate one.
 */
export function waPreviewHtml(markup) {
  const held = [];
  const hold = (html) => `<${held.push(html) - 1}>`;

  let out = esc(markup);
  out = out.replace(/```([\s\S]+?)```/g, (m, code) => hold(`<code class="rounded bg-black/10 px-1">${code}</code>`));
  out = out.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (m, key) => {
    const f = getDynamicFieldByKey(key);
    return hold(`<span class="mx-0.5 inline-flex items-center rounded bg-blue-100 px-1 text-[0.85em] font-medium text-blue-800">${esc(f?.label || key)}</span>`);
  });
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (m, url) => hold(`<span class="text-sky-700 underline">${url}</span>`));

  out = out.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  out = out.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  out = out.replace(/\n/g, '<br>');

  return out.replace(/<(\d+)>/g, (m, i) => held[Number(i)] ?? m);
}
