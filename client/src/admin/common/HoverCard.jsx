import { useCallback, useEffect, useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu.jsx';

// Hover-triggered floating card. POSITIONING IS NOT IMPLEMENTED HERE — it
// delegates to AnchoredMenu, the project's canonical anchored surface (portal
// on <body>, fixed positioning, vertical + horizontal flip, viewport clamp,
// height cap). That is what makes the card immune to the clipping this used to
// suffer: it previously positioned itself `absolute` inside its trigger, so any
// ancestor with overflow (a table's scroll container, a card, a sticky region)
// cut it off, a horizontally-scrolled table dragged it out of view, and its
// z-50 could land behind sticky chrome.
//
// A short close delay lets the pointer travel from the trigger into the card;
// the card keeps itself open while hovered. Keyboard users get the same
// content — focus opens the card, blur closes it.
//
// align: 'start' anchors the card to the trigger's start edge (right in RTL);
// AnchoredMenu flips to the other edge when that side has no room.
//
// openDelay: milliseconds of INTENTIONAL hover before the card appears. 0 (the
// default) keeps every existing caller instant. A list whose rows each carry a
// hoverable name needs a delay — otherwise dragging the pointer across the list
// on the way to somewhere else flashes a card per row. `onOpen` fires when the
// card actually opens, which is where a caller loads its content: nothing is
// fetched for a name the operator merely passed over.
export default function HoverCard({
  trigger, children, width = 288, align = 'start', openDelay = 0, onOpen = null, className = 'inline-flex',
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const openRef = useRef(null);
  openRef.current = onOpen;

  const show = useCallback(() => {
    clearTimeout(timer.current);
    if (!openDelay) {
      setOpen(true);
      openRef.current?.();
      return;
    }
    timer.current = setTimeout(() => {
      setOpen(true);
      openRef.current?.();
    }, openDelay);
  }, [openDelay]);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {trigger}
      </span>
      <AnchoredMenu
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={width}
        align={align}
        overlay={false}
        onMouseEnter={show}
        onMouseLeave={hide}
        panelClassName="rounded-xl p-3.5"
      >
        {children}
      </AnchoredMenu>
    </>
  );
}
