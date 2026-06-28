import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker.jsx';
import { FONT_SIZES, HIGHLIGHT_COLORS } from './Toolbar.jsx';

// A deliberately minimal toolbar for lightweight working notes (e.g. the Deal's
// "מידע חשוב על הלקוח"). Reuses the SAME RichEditor / TipTap instance — only the
// chrome is reduced. Tools: Bold · Underline · Highlight · Emoji · Font size.
// No headings, colors, lists, alignment, links, images, video, tables.
const EMOJIS = [
  '😀', '🙂', '😅', '😎', '🤝', '👍', '👌', '🙏',
  '🎉', '✅', '✔️', '❗', '❓', '⚠️', '⭐', '🔥',
  '❤️', '💡', '📌', '📞', '✉️', '📅', '🕒', '💰',
];

export default function LiteToolbar({ editor }) {
  if (!editor) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1 p-1.5 bg-gray-50 rounded-b-md"
      role="toolbar"
      aria-label="סרגל עיצוב"
    >
      <Group>
        <IconBtn
          label="מודגש"
          shortcut="Ctrl+B"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <span className="font-extrabold">B</span>
        </IconBtn>
        <IconBtn
          label="קו תחתון"
          shortcut="Ctrl+U"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span className="underline font-semibold">U</span>
        </IconBtn>
      </Group>
      <Divider />

      <HighlightButton editor={editor} />
      <EmojiButton editor={editor} />
      <Divider />

      <FontSizeSelect editor={editor} />
    </div>
  );
}

function FontSizeSelect({ editor }) {
  const current = editor.getAttributes('textStyle').fontSize || '';
  function set(v) {
    const chain = editor.chain().focus();
    if (!v) chain.unsetFontSize().run();
    else chain.setFontSize(v).run();
  }
  return (
    <select
      value={current}
      onChange={(e) => set(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-9 px-2 text-sm border border-gray-200 rounded-md hover:bg-gray-100 bg-white shrink-0"
      style={{ minWidth: 70 }}
      aria-label="גודל גופן"
      title="גודל גופן"
    >
      {FONT_SIZES.map((o) => (
        <option key={o.value} value={o.value}>{o.name}</option>
      ))}
    </select>
  );
}

function HighlightButton({ editor }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const current = editor.getAttributes('highlight').color;
  const active = editor.isActive('highlight');
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="הדגשת רקע"
        aria-pressed={active ? 'true' : 'false'}
        title="הדגשת רקע"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`relative w-9 h-9 flex items-center justify-center rounded-md text-[13px] transition shrink-0 ${
          active ? 'ring-1 ring-blue-200' : 'text-gray-700 hover:bg-gray-200'
        }`}
      >
        <span
          className="font-bold leading-none px-1 rounded"
          style={{ background: current || '#fef08a' }}
        >
          A
        </span>
      </button>
      <ColorPicker
        open={open}
        anchorEl={btnRef.current}
        onClose={() => setOpen(false)}
        onPick={(c) => {
          editor.chain().focus().setHighlight({ color: c }).run();
          setOpen(false);
        }}
        onClear={() => {
          editor.chain().focus().unsetHighlight().run();
          setOpen(false);
        }}
        colors={HIGHLIGHT_COLORS}
        currentColor={current}
        title="צבע רקע"
      />
    </>
  );
}

function EmojiButton({ editor }) {
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
    editor.chain().focus().insertContent(emoji).run();
    setOpen(false);
  }

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
          className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 p-2 grid grid-cols-8 gap-0.5 w-[18rem]"
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

function Group({ children }) {
  return <div className="flex items-center gap-0.5 shrink-0">{children}</div>;
}

function Divider() {
  return <span className="w-px h-5 bg-gray-300 mx-1 shrink-0" aria-hidden />;
}

function IconBtn({ children, label, shortcut, active, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ? 'true' : 'false'}
      title={shortcut ? `${label} (${shortcut})` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`relative w-9 h-9 flex items-center justify-center rounded-md text-[13px] transition ${
        active ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
