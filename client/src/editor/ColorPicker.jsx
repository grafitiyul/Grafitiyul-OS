import { useEffect, useRef, useState } from 'react';

// Small swatch popover used for both text color and highlight color.
// Anchored to a toolbar button via getBoundingClientRect.
export default function ColorPicker({
  open,
  anchorEl,
  onClose,
  onPick,
  onClear,
  colors,
  title,
  currentColor,
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    // Toolbar sits at the bottom of the editor; open the swatch panel UP.
    setPos({ anchorTop: rect.top, left: rect.left });
  }, [open, anchorEl]);

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

  return (
    <div
      ref={popRef}
      dir="rtl"
      role="dialog"
      aria-label={title || 'בחירת צבע'}
      style={{
        position: 'fixed',
        top: pos.anchorTop,
        left: pos.left,
        transform: 'translateY(calc(-100% - 6px))',
        zIndex: 60,
      }}
      className="bg-white border border-gray-200 rounded-md shadow-lg p-2"
    >
      {title && (
        <div className="text-[11px] text-gray-500 mb-1.5 px-1">{title}</div>
      )}
      <div className="grid grid-cols-7 gap-1.5">
        {colors.map((c) => {
          const selected = currentColor && currentColor.toLowerCase() === c.value.toLowerCase();
          return (
            <button
              key={c.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c.value);
              }}
              title={c.name}
              aria-label={c.name}
              className={`w-6 h-6 rounded border transition hover:scale-110 ${
                selected ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-gray-300'
              }`}
              style={{ background: c.value }}
            />
          );
        })}
      </div>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onClear();
        }}
        className="w-full mt-2 text-[12px] text-gray-700 border border-gray-200 rounded py-1 hover:bg-gray-50"
      >
        נקה צבע
      </button>
    </div>
  );
}
