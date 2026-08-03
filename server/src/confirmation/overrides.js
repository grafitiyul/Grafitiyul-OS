// Confirmation Email — per-deal preview overrides. Pure, no DB.
//
// The QuoteDocument.overrideState convention, keyed by SECTION id:
//   { sections: { [sectionId]: { html?, title? } } }
// where sectionId is 'greeting' | 'tour_details' | … for auto sections and
// 'block:<sharedContentId>' for library blocks.
//
// Two layers, exactly like quotes:
//   • PERSISTENT — DealConfirmation.overrideState (survives across sends)
//   • TEMPORARY  — client-held, sent per request, consumed once, never stored
// mergeOverrides is field-level and overlay-wins per section key.

export function mergeOverrides(base, overlay) {
  const a = base?.sections || {};
  const b = overlay?.sections || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (!keys.size) return null;
  const sections = {};
  for (const k of keys) sections[k] = { ...a[k], ...b[k] };
  return { sections };
}

export function overrideFor(state, sectionId) {
  const o = state?.sections?.[sectionId];
  if (!o) return null;
  const html = typeof o.html === 'string' && o.html.trim() ? o.html : null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
  return html || title ? { html, title } : null;
}

/** Drop one section's override (the ↺ reset action). Returns null when empty. */
export function withoutOverride(state, sectionId) {
  const sections = { ...(state?.sections || {}) };
  delete sections[sectionId];
  return Object.keys(sections).length ? { sections } : null;
}

/** Normalize a stored/incoming state: keep only non-empty string fields. */
export function normalizeOverrideState(raw) {
  const src = raw?.sections;
  if (!src || typeof src !== 'object') return null;
  const sections = {};
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue;
    const html = typeof v.html === 'string' && v.html.trim() ? v.html : null;
    const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null;
    if (html || title) sections[k] = { ...(html ? { html } : {}), ...(title ? { title } : {}) };
  }
  return Object.keys(sections).length ? { sections } : null;
}
