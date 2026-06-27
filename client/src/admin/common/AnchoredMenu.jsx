import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Anchored dropdown rendered in a portal on <body>, so it escapes any
// overflow-x/overflow-hidden clipping from ancestor containers (tables, cards).
// It positions under the anchor, flips above when the bottom is tight, and
// clamps fully inside the viewport on both axes — correct in RTL and LTR alike.
export default function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  width = 176,
  align = 'end',
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
      const r = a.getBoundingClientRect();
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = menuRef.current?.offsetHeight || 0;
      // Vertical: prefer below; flip above if it would overflow the bottom.
      let top = r.bottom + 4;
      if (h && top + h > vh - margin) {
        const above = r.top - 4 - h;
        top = above >= margin ? above : Math.max(margin, vh - margin - h);
      }
      // Horizontal: align the menu's end/start edge to the anchor, then clamp
      // into the viewport so it is never clipped on either side.
      let left = align === 'end' ? r.right - width : r.left;
      left = Math.min(Math.max(margin, left), vw - margin - width);
      setPos({ top, left });
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
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div
        ref={menuRef}
        dir="rtl"
        style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
        className="z-[91] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
