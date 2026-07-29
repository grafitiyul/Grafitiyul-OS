import { useEffect, useRef } from 'react';

// Modal shell: fixed overlay, backdrop click + Esc to close, RTL, Hebrew.
// Caller passes the content and the footer buttons. We don't make assumptions
// about the shape — this is just the chrome.
//
// Sizing modes:
//   - default: `w-full` up to one of the `size` max-width presets (stretches
//     to the max on desktop). Good for form dialogs.
//   - fitContent: `w-auto` on desktop — the panel sizes to its content between
//     `minWidthPx` and `maxWidthPx` (both capped at 95vw so it never overflows
//     the viewport). Good for matrices/tables that must not stretch to fill a
//     wide screen. Mobile stays near-full-width.
export default function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  ariaLabel,
  size = 'md',
  fitContent = false,
  maxWidthPx = null,
  minWidthPx = null,
  contentClassName,
  panelClassName = '',
}) {
  const panelRef = useRef(null);

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

  // Focus management: on open, move focus into the panel (unless an element
  // inside already grabbed it via autoFocus). Trap Tab so keyboard focus can't
  // leave the dialog. Purely additive — a dialog with no focusable content is
  // simply left alone.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const FOCUSABLE =
      'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
    if (!panel.contains(document.activeElement)) {
      panel.querySelector(FOCUSABLE)?.focus?.();
    }
    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const maxW =
    size === 'sm'
      ? 'sm:max-w-sm'
      : size === '2xl'
      ? 'sm:max-w-7xl'
      : size === 'xl'
      ? 'sm:max-w-6xl'
      : size === 'lg'
      ? 'sm:max-w-xl'
      : size === 'md-wide'
      ? 'sm:max-w-lg'
      : 'sm:max-w-md';

  // Cap requested widths at 95vw so the panel never overflows a small viewport.
  const panelStyle = { maxHeight: '90vh' };
  if (maxWidthPx != null) panelStyle.maxWidth = `min(${maxWidthPx}px, 95vw)`;
  if (minWidthPx != null) panelStyle.minWidth = `min(${minWidthPx}px, 95vw)`;

  const widthCls = fitContent ? 'w-full sm:w-auto' : `w-full ${maxWidthPx != null ? '' : maxW}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title || 'דיאלוג'}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        dir="rtl"
        className={`bg-white ${widthCls} sm:rounded-lg shadow-xl overflow-hidden flex flex-col ${panelClassName}`}
        style={panelStyle}
      >
        {title && (
          <div className="p-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
            <div className="flex-1 font-semibold text-gray-900">{title}</div>
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
        <div className={contentClassName ?? 'flex-1 overflow-y-auto p-4'}>{children}</div>
        {footer && (
          <div className="p-3 border-t border-gray-200 flex items-center gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
