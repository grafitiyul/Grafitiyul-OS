import { useEffect } from 'react';

// Modal shell: fixed overlay, backdrop click + Esc to close, RTL, Hebrew.
// Caller passes the content and the footer buttons. We don't make assumptions
// about the shape — this is just the chrome.
export default function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  ariaLabel,
  size = 'md',
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

  const maxW =
    size === 'sm'
      ? 'sm:max-w-sm'
      : size === 'lg'
      ? 'sm:max-w-xl'
      : 'sm:max-w-md';

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
        dir="rtl"
        className={`bg-white w-full ${maxW} sm:rounded-lg shadow-xl overflow-hidden flex flex-col`}
        style={{ maxHeight: '90vh' }}
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
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="p-3 border-t border-gray-200 flex items-center gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
