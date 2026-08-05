// One source of truth for editor "presets" — so every editor in GOS behaves
// consistently and screens stop hand-specifying chrome. A preset bundles the
// standardized defaults for a role; explicit props on <RichEditor> still win,
// so an edge case can opt out of a single default without forking behavior.
//
// Presets:
//   full  — the standard long-content editor (marketing, item bodies, sections,
//           meeting/ending points, city marketing). Full toolbar, white surface.
//   lite  — lightweight working notes: minimal toolbar (bold · underline ·
//           highlight · emoji · font size), white surface.
//   note  — sticky-note surfaces (timeline notes, price-line notes): warm-yellow
//           tone. Toolbar can be overridden per site (full for timeline notes,
//           lite for price-line notes) via the explicit `toolbar` prop.
//   title — single-line title editor. Served by TitleEditor.jsx (a distinct
//           single-paragraph instance); listed here so the roster of editor
//           roles lives in one place. Not consumed by RichEditor.
//
// The toolbar `full`/`lite` values map 1:1 to TOOLBAR_PRESETS in Toolbar.jsx —
// the toolbar itself is defined as data there.
// `rhythm` is the typography contract of the surface (see pastePlainText.js):
//   'spaced' — paragraphs separated by a visible margin (standard face);
//   'tight'  — zero paragraph margins, Enter reads like a line break (note
//              face, .rt-editor-compact / .gos-prose-tight). Paste
//              normalisation maps the author's blank lines per this rhythm.
// The `collapsible` prop on RichEditor also forces 'tight' — a collapsed
// composer is always the note face.
export const EDITOR_PRESETS = {
  full: { toolbar: 'full', tone: 'default', rhythm: 'spaced' },
  lite: { toolbar: 'lite', tone: 'default', rhythm: 'spaced' },
  note: { toolbar: 'full', tone: 'note', rhythm: 'tight' },
  title: { singleLine: true },
  // "דפי אתר" rich sections: exactly what the site-page sanitizer keeps —
  // headings/lists/links/images/direction, no fonts/colors/video (those would
  // be silently stripped on save, which is worse than not offering them).
  sitePage: { toolbar: 'sitePage', tone: 'default' },
};
