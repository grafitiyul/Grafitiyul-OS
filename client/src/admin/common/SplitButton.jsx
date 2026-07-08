import { useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu.jsx';

// Reusable split button: [ label | ▼ ]. The main segment runs the primary
// action; the narrow arrow segment is its OWN click target and opens an
// AnchoredMenu of secondary actions. Menu items come from the `children`
// render-prop, which receives close() so each item can dismiss the menu.
// Logical utilities (rounded-s/e, border-s) keep the shape correct in RTL
// (arrow visually on the left) and LTR alike.
export default function SplitButton({
  label,
  onPrimary,
  primaryTitle,
  disabled = false,
  menuAriaLabel = 'פעולות נוספות',
  menuWidth = 216,
  align = 'start',
  children,
}) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef(null);
  const close = () => setOpen(false);
  return (
    <div className="inline-flex items-stretch">
      <button
        type="button"
        disabled={disabled}
        onClick={onPrimary}
        title={primaryTitle}
        className="rounded-s-lg border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
      >
        {label}
      </button>
      <button
        ref={arrowRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuAriaLabel}
        className="rounded-e-lg border border-gray-300 border-s-0 px-2 text-[9px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
      >
        ▼
      </button>
      <AnchoredMenu anchorRef={arrowRef} open={open} onClose={close} width={menuWidth} align={align}>
        {typeof children === 'function' ? children(close) : children}
      </AnchoredMenu>
    </div>
  );
}
