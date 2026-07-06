import { useEffect, useRef, useState } from 'react';

// Reusable 3-column workspace shell (VS Code / Linear style), RTL-first.
//
//   [ right panel ] | center (grows) | [ left panel ]
//
// Both side panels are collapsible + resizable, and their width / open state is
// persisted in localStorage under `storageKey`. The center always takes the
// remaining width. On mobile (<lg) it degrades to a single vertical stack
// (center first, then the panels' content) — no rails, no resizing.
//
// This is intentionally module-agnostic: pass `right`/`left` (each { title,
// content, defaultWidth, minWidth, maxWidth, defaultOpen }) and the center as
// children. Any GOS module can reuse it.

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function Chevron({ dir }) {
  // Base polyline points LEFT ("<"); rotate 180° to point right.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: dir === 'right' ? 'rotate(180deg)' : 'none' }}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// Thin draggable divider between a panel and the center. Desktop-only.
function Handle({ onMouseDown, active, ariaLabel }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onMouseDown={onMouseDown}
      className={`hidden lg:block shrink-0 cursor-col-resize transition-colors duration-150 ${
        active ? 'bg-blue-500' : 'bg-gray-200 hover:bg-blue-400 focus:bg-blue-400'
      }`}
      style={{ width: 4 }}
    />
  );
}

// Collapsed state: a slim vertical rail with an inward arrow + vertical title.
// Desktop-only — on mobile the panel content is always shown instead.
function CollapsedRail({ side, title, onExpand }) {
  return (
    <div
      className={`hidden lg:flex w-9 shrink-0 flex-col bg-gray-50 ${
        side === 'right' ? 'border-l' : 'border-r'
      } border-gray-200`}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={`פתח ${title}`}
        title={title}
        className="flex-1 w-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <div className="flex flex-col items-center gap-3">
          {/* Arrow points INWARD (toward the center). */}
          <Chevron dir={side === 'right' ? 'left' : 'right'} />
          <span className="text-[11px] text-gray-500 tracking-wide [writing-mode:vertical-rl]">
            {title}
          </span>
        </div>
      </button>
    </div>
  );
}

// The open panel. On mobile it is always full-width and visible; on desktop it
// is hidden when collapsed (the rail takes over).
function SidePanel({ side, title, open, width, onCollapse, children }) {
  const titleEl = (
    <h2 className="text-[13px] font-semibold text-gray-700 flex-1 truncate">{title}</h2>
  );
  const collapseBtn = (
    <button
      type="button"
      onClick={onCollapse}
      aria-label={`כווץ ${title}`}
      title={`כווץ ${title}`}
      className="hidden lg:inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
    >
      {/* Arrow points OUTWARD (collapse direction). */}
      <Chevron dir={side === 'right' ? 'right' : 'left'} />
    </button>
  );
  return (
    <aside
      style={{ '--panel-w': `${width}px` }}
      className={`w-full lg:shrink-0 lg:min-h-0 flex flex-col bg-white ${
        side === 'right' ? 'border-l' : 'border-r'
      } border-gray-200 ${open ? 'lg:w-[var(--panel-w)]' : 'lg:hidden'}`}
    >
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-100 shrink-0">
        {side === 'right' ? (
          <>
            {titleEl}
            {collapseBtn}
          </>
        ) : (
          <>
            {collapseBtn}
            {titleEl}
          </>
        )}
      </div>
      <div className="flex-1 lg:overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

// `seamLeft` — optional floating accessory anchored at the seam between the
// center and the LEFT panel (e.g. the Deal page's WhatsApp bubble). Rendered
// as a zero-width relative container so it never affects the flex layout;
// the accessory positions itself absolutely from that anchor.
export default function WorkspaceLayout({ storageKey, right = {}, left = {}, seamLeft = null, children }) {
  // Either side panel is optional — a page may show only a right details panel
  // (Contact / Organization) or none at all; the center always fills the rest.
  const hasRight = !!(right && right.content);
  const hasLeft = !!(left && left.content);
  const containerRef = useRef(null);
  const defaults = {
    rightWidth: right.defaultWidth ?? 360,
    leftWidth: left.defaultWidth ?? 300,
    rightOpen: right.defaultOpen ?? true,
    leftOpen: left.defaultOpen ?? true,
  };
  const [state, setState] = useState(() => readStored(storageKey, defaults));
  const { rightWidth, leftWidth, rightOpen, leftOpen } = state;
  const [dragging, setDragging] = useState(null); // 'right' | 'left' | null

  // Persist the whole layout state on every change.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [storageKey, state]);

  // Drag-to-resize. Width is derived from the container's physical edge so the
  // math is correct for both panels and independent of RTL/LTR.
  useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (dragging === 'right') {
        const w = clamp(
          rect.right - e.clientX,
          right.minWidth ?? 260,
          right.maxWidth ?? 600,
        );
        setState((s) => ({ ...s, rightWidth: w }));
      } else {
        const w = clamp(
          e.clientX - rect.left,
          left.minWidth ?? 220,
          left.maxWidth ?? 520,
        );
        setState((s) => ({ ...s, leftWidth: w }));
      }
    }
    function onUp() {
      setDragging(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, right.minWidth, right.maxWidth, left.minWidth, left.maxWidth]);

  function startDrag(side) {
    setDragging(side);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  const setRightOpen = (v) => setState((s) => ({ ...s, rightOpen: v }));
  const setLeftOpen = (v) => setState((s) => ({ ...s, leftOpen: v }));

  return (
    <div
      ref={containerRef}
      dir="rtl"
      className="flex flex-col lg:flex-row min-h-0 lg:h-full bg-gray-50"
    >
      {/* RIGHT panel — physically on the right (start) in RTL. Optional: a page
          may pass only one side panel (e.g. details-only Contact/Org pages). */}
      {hasRight && (
        <>
          <SidePanel
            side="right"
            title={right.title}
            open={rightOpen}
            width={rightWidth}
            onCollapse={() => setRightOpen(false)}
          >
            {right.content}
          </SidePanel>
          {!rightOpen && (
            <CollapsedRail side="right" title={right.title} onExpand={() => setRightOpen(true)} />
          )}
          {rightOpen && (
            <Handle
              onMouseDown={() => startDrag('right')}
              active={dragging === 'right'}
              ariaLabel={`שינוי רוחב ${right.title}`}
            />
          )}
        </>
      )}

      {/* CENTER — the workspace. First on mobile, middle on desktop. The cap is
          generous so the center soaks up free space (pipeline labels fit, the
          header breathes) without becoming excessively wide on huge monitors. */}
      {/* overflow-x-hidden: a seam accessory may overhang the content's left
          edge slightly; in RTL that overhang would otherwise mint a
          horizontal scrollbar on narrow-center screens. */}
      <section className="order-first lg:order-none flex-1 min-w-0 lg:overflow-y-auto overflow-x-hidden">
        <div className="relative mx-auto w-full max-w-[1320px] px-4 lg:px-8 py-4 space-y-4">
          {/* Seam accessory — floats in the content's left gutter (inside the
              horizontal padding, hugging the first card's edge), sticky so it
              stays visible while the center scrolls. Zero-size wrapper; the
              accessory handles its own responsive display and must not be
              display:none'd here (it may render fixed-position children). */}
          {seamLeft && <div className="sticky top-3 z-40 h-0">{seamLeft}</div>}
          {children}
        </div>
      </section>

      {/* LEFT panel — physically on the left (end) in RTL. Also optional. */}
      {hasLeft && (
        <>
          {leftOpen && (
            <Handle
              onMouseDown={() => startDrag('left')}
              active={dragging === 'left'}
              ariaLabel={`שינוי רוחב ${left.title}`}
            />
          )}
          {!leftOpen && (
            <CollapsedRail side="left" title={left.title} onExpand={() => setLeftOpen(true)} />
          )}
          <SidePanel
            side="left"
            title={left.title}
            open={leftOpen}
            width={leftWidth}
            onCollapse={() => setLeftOpen(false)}
          >
            {left.content}
          </SidePanel>
        </>
      )}
    </div>
  );
}
