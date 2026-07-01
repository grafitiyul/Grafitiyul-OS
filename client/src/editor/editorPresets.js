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
export const EDITOR_PRESETS = {
  full: { toolbar: 'full', tone: 'default' },
  lite: { toolbar: 'lite', tone: 'default' },
  note: { toolbar: 'full', tone: 'note' },
  title: { singleLine: true },
};
