import { useRef, useState } from 'react';

// Lightweight hover card (popover). The trigger is always rendered; the card
// floats below it on hover. A short close delay lets the pointer travel from the
// trigger into the card without it dismissing. Reusable across modules.
//
// align: 'start' anchors the card to the trigger's start edge (right in RTL).
export default function HoverCard({ trigger, children, width = 288, align = 'start' }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {trigger}
      {open && (
        <div
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ width }}
          className={`absolute top-full mt-2 z-50 ${
            align === 'start' ? 'start-0' : 'end-0'
          } rounded-xl border border-gray-200 bg-white p-3.5 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
