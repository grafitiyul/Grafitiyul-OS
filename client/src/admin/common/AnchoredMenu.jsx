import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeAnchored } from './anchoredPosition.js';
import { FloatingLayer, floatingZ, useFloatingDepth } from './floatingLayer.jsx';

// THE canonical anchored floating surface: rendered in a portal on <body> with
// FIXED positioning, so it escapes every ancestor overflow (table scroll
// containers, cards, sticky headers) and can never be clipped or painted
// behind them. It positions under the anchor, FLIPS above when the bottom is
// tight, flips to the opposite horizontal alignment when the preferred side
// would overflow, then clamps fully inside the viewport on both axes —
// correct in RTL and LTR alike. A menu taller than the viewport is capped and
// scrolls internally instead of running off-screen.
//
// Two modes:
//   * click menus (default) — a full-screen catcher closes on outside click;
//   * hover cards (`overlay={false}` + onMouseEnter/onMouseLeave) — NO catcher,
//     so the page stays interactive and the pointer can travel into the card.
//     This is what HoverCard builds on; there is no second positioning engine.
//
// NESTING: the panel caps its own height and scrolls (`overflowY: auto`), so a
// menu opened from INSIDE it must be a floating surface too — an `absolute`
// child would be clipped by this very box. Depth comes from the shared
// floatingLayer, so each level's catcher paints above the level below and the
// nested menu is both visible AND dismissible by clicking its parent.
//
// `matchAnchorWidth` is what COMBOBOXES need: the list lines up with its input
// exactly. In-flow dropdowns got that free with `w-full`; a portal panel has no
// such parent, so the width is measured from the anchor here — once — instead
// of every combobox re-deriving it.
export default function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  width = 176,
  matchAnchorWidth = false,
  minWidth = 0,
  align = 'end',
  overlay = true,
  onMouseEnter,
  onMouseLeave,
  panelClassName = 'rounded-lg py-1',
  children,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  const depth = useFloatingDepth();
  const z = floatingZ(depth);
  // A caller-supplied fixed width must never exceed the viewport (phones):
  // clamp to viewport minus margins, so the panel always fits on-screen.
  const effWidth =
    typeof window !== 'undefined' ? Math.min(width, window.innerWidth - 16) : width;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchorRef.current;
      if (!a) return;
      const anchor = a.getBoundingClientRect();
      // Anchor-matched widths are measured live (the input can be resized by a
      // responsive layout), then clamped to the viewport like any other width.
      const w = matchAnchorWidth
        ? Math.min(Math.max(anchor.width, minWidth), window.innerWidth - 16)
        : effWidth;
      // ALL geometry lives in the pure, unit-tested placer (flip + clamp +
      // height cap) — this effect only feeds it measurements.
      setPos({
        ...placeAnchored({
          anchor,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          width: w,
          height: menuRef.current?.offsetHeight || 0,
          align,
        }),
        width: w,
      });
    };
    place();
    // Re-place once mounted (height now known) and on scroll/resize so the menu
    // stays attached while the user scrolls the page or window.
    const raf = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, width, align, matchAnchorWidth, minWidth]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      {overlay && (
        <div className="fixed inset-0" style={{ zIndex: z.catcher }} onClick={onClose} />
      )}
      <div
        ref={menuRef}
        dir="rtl"
        // Every panel in the floating layer is marked, so a surface with its
        // own document-level outside-click handler can recognise "this click
        // landed in a panel I opened" without holding a ref to each one. A
        // portalled panel is not a DOM descendant of its trigger, so
        // contains() alone always reads it as an outside click.
        data-floating-panel=""
        style={{
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width: pos?.width ?? effWidth,
          maxHeight: pos?.maxHeight,
          overflowY: 'auto',
          zIndex: z.panel,
        }}
        className={`overscroll-contain border border-gray-200 bg-white shadow-lg ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <FloatingLayer depth={depth}>{children}</FloatingLayer>
      </div>
    </>,
    document.body,
  );
}
