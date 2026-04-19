import { useEffect } from 'react';

// Full-height slide-in panel. Used where a centered modal would feel cramped
// (e.g. creating a full item editor from inside the flow builder). Wider
// than Dialog and stretches to the viewport height.
//
// Behavior: Esc + backdrop click close. No close button; consumer renders its
// own action buttons in `footer` so the panel stays close to the in-app
// editor look.
export default function SidePanel({
  open,
  onClose,
  title,
  children,
  footer,
  ariaLabel,
  side = 'end', // 'end' (away from leading edge) — in RTL this is the left edge
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const panelAttach =
    side === 'end'
      ? 'inset-y-0 end-0 border-s border-gray-200'
      : 'inset-y-0 start-0 border-e border-gray-200';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title || 'פאנל'}
      className="fixed inset-0 z-40 bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        dir="rtl"
        className={`absolute ${panelAttach} bg-white shadow-2xl w-full sm:w-[min(760px,90vw)] flex flex-col`}
      >
        {title && (
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
            <div className="flex-1 font-semibold text-gray-900 truncate">
              {title}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="סגירה"
              className="text-gray-500 hover:bg-gray-100 rounded px-2 py-1"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
