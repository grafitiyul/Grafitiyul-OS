// Pure placement math for AnchoredMenu (the canonical anchored floating
// surface). Kept separate — and unit-tested — because "the popover was clipped"
// is a geometry bug, not a rendering one: the panel is portaled to <body> with
// FIXED coordinates, so these numbers are the entire contract with the viewport.
//
// Inputs are plain rects (no DOM), so every edge case is testable:
//   anchor    { top, bottom, left, right } — viewport coords (getBoundingClientRect)
//   viewport  { width, height }
//   height    measured panel height (0 before the first measure)
//   align     'end' | 'start' — preferred horizontal edge to line up with
//
// Rules, in order:
//   1. vertical  — prefer BELOW the anchor; flip ABOVE when below overflows and
//      above has room; otherwise pin inside the viewport.
//   2. horizontal — prefer the requested alignment; FLIP to the opposite edge
//      when the preferred side overflows and the flipped side fits; then CLAMP
//      as the final guarantee (a panel wider than the viewport still starts at
//      the margin rather than off-screen).
//   3. maxHeight — never taller than the viewport minus margins; the panel
//      scrolls internally instead of running past the edge.

export const ANCHOR_MARGIN = 8;
export const ANCHOR_GAP = 4;

export function placeAnchored({
  anchor,
  viewport,
  width,
  height = 0,
  align = 'end',
  margin = ANCHOR_MARGIN,
  gap = ANCHOR_GAP,
}) {
  const vw = viewport.width;
  const vh = viewport.height;

  let top = anchor.bottom + gap;
  let placement = 'below';
  if (height && top + height > vh - margin) {
    const above = anchor.top - gap - height;
    if (above >= margin) {
      top = above;
      placement = 'above';
    } else {
      top = Math.max(margin, vh - margin - height);
      placement = 'pinned';
    }
  }

  const startLeft = anchor.left;
  const endLeft = anchor.right - width;
  const fits = (x) => x >= margin && x + width <= vw - margin;

  let left = align === 'end' ? endLeft : startLeft;
  let flipped = false;
  if (!fits(left)) {
    const other = align === 'end' ? startLeft : endLeft;
    if (fits(other)) {
      left = other;
      flipped = true;
    }
  }
  const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - width));

  return {
    top,
    left: clampedLeft,
    maxHeight: vh - 2 * margin,
    placement,
    flipped,
    clamped: clampedLeft !== left,
  };
}
