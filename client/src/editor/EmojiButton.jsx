import { useEffect, useRef, useState } from 'react';
import { EMOJI_I18N_HE, loadEmojiPicker } from '../lib/emojiPickerData.js';

// The one shared emoji picker for every rich-text surface. Used by the body
// editor's toolbar (RichEditor via Toolbar.jsx), the single-line TitleEditor
// and the WhatsApp body editor — exactly one emoji implementation.
//
// Backed by emoji-picker-element (the full Unicode catalog, categories,
// search, skin tones, frequently-used via IndexedDB) with the SAME bundled
// dataset + Hebrew i18n as the WhatsApp chat composer — no external service,
// nothing fetched at runtime. Loaded lazily on first open.
//
// Insertion is a plain Unicode character via `insertContent`: it works in any
// TipTap editor, in RTL and LTR content alike, never creates a block node and
// NEVER an <img> — an emoji is just a character.
export default function EmojiButton({ editor, placement = 'up' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hostRef = useRef(null);

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

  // Mount the web component into the popup on open (lazy element + dataset).
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let picker = null;
    let onPick = null;
    loadEmojiPicker().then(({ dataSource }) => {
      if (disposed || !hostRef.current) return;
      picker = document.createElement('emoji-picker');
      picker.dataSource = dataSource;
      picker.i18n = EMOJI_I18N_HE;
      picker.style.width = '100%';
      picker.style.height = '100%';
      onPick = (e) => {
        const emoji = e?.detail?.unicode;
        if (emoji && editor) editor.chain().focus().insertContent(emoji).run();
        setOpen(false);
      };
      picker.addEventListener('emoji-click', onPick);
      hostRef.current.replaceChildren(picker);
    });
    return () => {
      disposed = true;
      if (picker && onPick) picker.removeEventListener('emoji-click', onPick);
    };
  }, [open, editor]);

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
          className={`absolute ${menuPos} left-0 z-30 h-[22rem] w-[20rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg`}
        >
          <div ref={hostRef} className="h-full w-full">
            <div className="flex h-full items-center justify-center text-[12px] text-gray-400">
              טוען אימוג׳ים…
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
