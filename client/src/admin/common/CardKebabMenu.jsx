import { useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu.jsx';

// Standard card-header kebab (⋮) — the same affordance as the deal-header
// actions menu, sized to sit quietly in a card's title row (the header's
// action slot, i.e. the physical LEFT edge in RTL). `children` is a
// render-prop receiving close() so items dismiss the menu before acting.
export default function CardKebabMenu({
  ariaLabel = 'פעולות',
  width = 216,
  align = 'start',
  disabled = false,
  children,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="rounded-lg px-1.5 py-0.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
      >
        ⋮
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={width} align={align}>
        {typeof children === 'function' ? children(() => setOpen(false)) : children}
      </AnchoredMenu>
    </>
  );
}
