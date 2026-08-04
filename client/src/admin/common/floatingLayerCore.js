// Pure z-index math for THE application floating layer. Kept separate — and
// unit-tested — because "the nested picker was clipped / painted behind" is a
// layering contract, not a rendering detail, and the numbers are the contract.
//
// The floating band is 90..99. Nothing else in the app may live there:
//   < 90        page chrome, sticky headers, in-flow content
//   50          top-level modal dialogs (Dialog) — a plain fixed overlay
//   90..99      floating surfaces (AnchoredMenu, SearchSelect, and any dialog
//               opened from INSIDE one), two z-indexes per nesting level
//   100         app chrome that must beat everything (media lightbox,
//               VersionGate)
//
// Each nesting level needs TWO values, and the pairing is the whole point:
// a floating surface's outside-click catcher must sit ABOVE its parent's panel
// (otherwise a click on the parent never reaches it and the child never
// closes), and its own panel must sit above its own catcher.

export const FLOATING_BASE_Z = 90;
// 4 → depths 0..4 occupy 90..99, so the band never reaches the 100 chrome layer.
export const FLOATING_MAX_DEPTH = 4;
// Top-level modal dialogs keep their historical z. Only a dialog opened from
// inside a floating surface is lifted into the band.
export const DIALOG_BASE_Z = 50;

// depth (0 = opened from the page) -> { catcher, panel }.
// Depth 0 returns 90/91 — byte-identical to the values AnchoredMenu shipped
// with, so nothing at the top level moves.
export function floatingZ(depth = 0) {
  const d = Math.min(Math.max(Number(depth) || 0, 0), FLOATING_MAX_DEPTH);
  const catcher = FLOATING_BASE_Z + d * 2;
  return { catcher, panel: catcher + 1 };
}

// A dialog rendered at `depth`: at the top level it is an ordinary modal;
// nested inside a floating surface it must be lifted above that surface.
export function dialogZ(depth = 0) {
  return depth > 0 ? floatingZ(depth).panel : DIALOG_BASE_Z;
}
