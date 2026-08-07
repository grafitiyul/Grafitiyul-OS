// Pure z-index math for THE application floating layer. Kept separate — and
// unit-tested — because "the nested picker was clipped / painted behind" is a
// layering contract, not a rendering detail, and the numbers are the contract.
//
// THE application layering order, low to high. Nothing may invent a value
// outside it:
//   < 40        in-flow content, sticky headers, page chrome
//   40          the mobile tab bar
//   60..70      drawers and workspace panes (DealDrawer, the gallery
//               workspace) — bounded surfaces that live INSIDE a page
//   80          top-level modal dialogs (Dialog)
//   90..99      floating surfaces (AnchoredMenu, SearchSelect, and any dialog
//               opened from INSIDE one), two z-indexes per nesting level
//   100         app chrome that must beat everything (media lightbox,
//               VersionGate)
//   200         toasts
//
// Why dialogs sit BELOW the floating band rather than above it: a dropdown
// opened inside a dialog must paint above that dialog, and Dialog hands its
// children depth+1, so a menu inside a top-level dialog lands at 92/93 — above
// 80. The ordering that matters in practice is the one this encodes:
//   drawer  <  modal dialog  <  the menus opened from inside either.
//
// DIALOG_BASE_Z was 50, which put every modal BELOW the z-[60] drawers. That is
// why a Quote preview opened from a Deal drawer was painted inside the drawer's
// box with its footer buttons under the WhatsApp pane. (Its other half was that
// Dialog rendered in place: the drawer animates with `translate-x`, and a
// transform makes an ancestor the containing block for `position: fixed`, so
// `fixed inset-0` stopped meaning "the viewport". Dialog now always portals.)
//
// Each nesting level needs TWO values, and the pairing is the whole point:
// a floating surface's outside-click catcher must sit ABOVE its parent's panel
// (otherwise a click on the parent never reaches it and the child never
// closes), and its own panel must sit above its own catcher.

export const FLOATING_BASE_Z = 90;
// 4 → depths 0..4 occupy 90..99, so the band never reaches the 100 chrome layer.
export const FLOATING_MAX_DEPTH = 4;
// Top-level modal dialogs: above every drawer/workspace pane, below the
// floating band (so their own dropdowns still paint on top).
export const DIALOG_BASE_Z = 80;

// The ceiling for bounded in-page surfaces (drawers, workspace panes). Kept
// here so "is this above or below a dialog?" has one answer in one file.
export const PANE_MAX_Z = 70;

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
