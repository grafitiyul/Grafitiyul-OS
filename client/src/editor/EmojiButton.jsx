import { useEffect, useRef, useState } from 'react';
import EmojiPickerPanel from '../lib/EmojiPickerPanel.jsx';

// The emoji BUTTON for rich-text surfaces: the body editor's toolbar
// (RichEditor via Toolbar.jsx), the single-line TitleEditor and the WhatsApp
// body editor. The picker itself is EmojiPickerPanel — the one catalog shared
// with the chat composer and message reactions; this file only owns the button
// and where its popup sits.
//
// Insertion is a plain Unicode character via `insertContent`: it works in any
// TipTap editor, in RTL and LTR content alike, never creates a block node and
// NEVER an <img> — an emoji is just a character.
export default function EmojiButton({ editor, placement = 'up' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      // The picker lives in the host's light DOM subtree — contains() covers it.
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const menuPos = placement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1';

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="אימוג'י"
        title="אימוג'י"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 flex items-center justify-center rounded-md text-[15px] text-gray-700 hover:bg-gray-200 transition"
      >
        🙂
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="בחירת אימוג'י"
          dir="ltr"
          className={`absolute ${menuPos} left-0 z-30 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg`}
        >
          <EmojiPickerPanel
            width={320}
            height={352}
            onPick={(emoji) => {
              if (editor) editor.chain().focus().insertContent(emoji).run();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
