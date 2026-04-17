import { useEffect, useRef, useState } from 'react';

// Inline link panel anchored to a toolbar button. Opens ABOVE the button
// because the toolbar sits at the bottom of the editor widget.
export default function LinkPopover({ editor, open, anchorEl, onClose }) {
  const [url, setUrl] = useState('');
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    // top of anchor in viewport; popover will sit above it via transform
    setPos({ anchorTop: rect.top, left: rect.left });
    const current = editor?.getAttributes('link')?.href || '';
    setUrl(current);
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [open, anchorEl, editor]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (popRef.current?.contains(e.target)) return;
      if (anchorEl?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorEl, onClose]);

  if (!open || !pos) return null;

  const existing = editor?.isActive('link');
  const clean = url.trim();

  function apply() {
    if (!clean) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: clean }).run();
    onClose();
  }
  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }
  function onInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  }

  return (
    <div
      ref={popRef}
      dir="rtl"
      role="dialog"
      aria-label="עריכת קישור"
      style={{
        position: 'fixed',
        top: pos.anchorTop,
        left: pos.left,
        transform: 'translateY(calc(-100% - 6px))',
        zIndex: 60,
      }}
      className="bg-white border border-gray-200 rounded-md shadow-lg p-2 min-w-[300px]"
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onInputKey}
          dir="ltr"
          placeholder="https://..."
          className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        <button
          type="button"
          onClick={apply}
          disabled={!clean}
          className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          החל
        </button>
        {existing && (
          <button
            type="button"
            onClick={remove}
            className="text-sm border border-gray-300 rounded px-3 py-1.5 text-red-600 hover:bg-red-50"
          >
            הסר
          </button>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-gray-500">
        Enter — החל · Esc — ביטול
      </div>
    </div>
  );
}
