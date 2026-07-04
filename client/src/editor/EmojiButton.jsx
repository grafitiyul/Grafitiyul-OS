import { useEffect, useRef, useState } from 'react';

// The one shared emoji list + picker for GOS. Used by BOTH the body editor's
// toolbar (RichEditor via Toolbar.jsx) and the single-line TitleEditor, so
// there is exactly one emoji implementation — no per-screen duplication.
//
// Insertion is a plain character via `insertContent`: it works in any TipTap
// editor, in RTL and LTR content alike (an emoji is just a character), and it
// never creates a new block — so it's safe even in the single-paragraph title.
export const EMOJIS = [
  '😀', '🙂', '😅', '😎', '🤝', '👍', '👌', '🙏',
  '🎉', '✅', '✔️', '❗', '❓', '⚠️', '⭐', '🔥',
  '❤️', '💡', '📌', '📞', '✉️', '📅', '🕒', '💰',
];

// `placement` controls which way the popup opens: 'up' (default) suits a
// bottom toolbar; 'down' suits a control near the top of a form (the title row).
export default function EmojiButton({ editor, placement = 'up' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
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

  function insert(emoji) {
    if (!editor) return;
    editor.chain().focus().insertContent(emoji).run();
    setOpen(false);
  }

  const menuPos =
    placement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1';

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
          role="menu"
          dir="ltr"
          className={`absolute ${menuPos} left-0 bg-white border border-gray-200 rounded-md shadow-lg z-30 p-2 grid grid-cols-8 gap-0.5 w-[18rem]`}
        >
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(em)}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-[18px]"
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
