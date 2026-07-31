import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeAnchored } from './anchoredPosition.js';

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
export default function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  width = 176,
  align = 'end',
  overlay = true,
  onMouseEnter,
  onMouseLeave,
  panelClassName = 'rounded-lg py-1',
  children,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchorRef.current;
      if (!a) return;
      // ALL geometry lives in the pure, unit-tested placer (flip + clamp +
      // height cap) — this effect only feeds it measurements.
      setPos(
        placeAnchored({
          anchor: a.getBoundingClientRect(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          width,
          height: menuRef.current?.offsetHeight || 0,
          align,
        }),
      );
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
  }, [open, anchorRef, width, align]);

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
      {overlay && <div className="fixed inset-0 z-[90]" onClick={onClose} />}
      <div
        ref={menuRef}
        dir="rtl"
        style={{
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
          maxHeight: pos?.maxHeight,
          overflowY: 'auto',
        }}
        className={`z-[91] border border-gray-200 bg-white shadow-lg ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
