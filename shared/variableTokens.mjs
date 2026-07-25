// THE canonical variable-token representation, shared by server and client.
//
// One rule everywhere:
//   - In stored BODY HTML, a recognized variable is a chip node:
//       <span data-type="dynamic-field" data-field-key="KEY">LABEL</span>
//     (the TipTap DynamicFieldNode form — the inner label is presentation
//     only; renderers always re-derive it from the registry by KEY).
//   - In plain-text surfaces (email subject, serialized WhatsApp markup) the
//     canonical form is {{KEY}}.
//   - Raw {{KEY}} moustache for a RECOGNIZED key must never remain in body
//     HTML: normalizeTokensToChips converts it (draft save on the server,
//     editor hydration on the client, AI-translation output). Unknown keys
//     are deliberately left as-is so they stay visible and flaggable.
//
// Environment-free: string transforms only, key-recognition is injected.

export const RAW_TOKEN_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** The canonical chip HTML for a recognized key. */
export function chipHtml(key, label) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<span data-type="dynamic-field" data-field-key="${esc(key)}">${esc(label || key)}</span>`;
}

/**
 * Convert recognized raw {{key}} tokens inside body HTML (or editor-bound
 * plain text) into canonical chip spans. `getLabel(key)` returns the display
 * label for recognized keys and null/undefined for unknown ones — unknown
 * tokens are left untouched (visible + flaggable, never silently rewritten).
 * Existing chip spans are naturally unaffected (their inner text is a human
 * label, not moustache).
 */
export function normalizeTokensToChips(html, getLabel) {
  if (html == null || html === '') return html ?? '';
  return String(html).replace(RAW_TOKEN_RE, (m, key) => {
    const label = getLabel?.(key);
    return label ? chipHtml(key, label) : m;
  });
}

/** All keys referenced by a string — both chip spans and raw moustache. */
export function referencedKeys(text) {
  const keys = new Set();
  const s = String(text ?? '');
  for (const m of s.matchAll(RAW_TOKEN_RE)) keys.add(m[1]);
  for (const m of s.matchAll(/data-field-key="([a-z][a-z0-9_]*)"/g)) keys.add(m[1]);
  return [...keys];
}
