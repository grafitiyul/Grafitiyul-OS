import { useEffect, useRef, useState } from 'react';
import { DYNAMIC_FIELDS } from '../lib/dynamicFields.js';

export default function Toolbar({ editor }) {
  if (!editor) return null;

  return (
    <div
      className="flex items-center gap-0.5 p-1 border-b border-gray-200 bg-gray-50/80 rounded-t-md overflow-x-auto"
      role="toolbar"
      aria-label="סרגל עיצוב"
    >
      <Group>
        <IconBtn
          label="בטל"
          shortcut="Ctrl+Z"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <UndoSVG />
        </IconBtn>
        <IconBtn
          label="חזור"
          shortcut="Ctrl+Shift+Z"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <RedoSVG />
        </IconBtn>
      </Group>
      <Divider />

      <HeadingSelect editor={editor} />
      <Divider />

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
          label="נטוי"
          shortcut="Ctrl+I"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <span className="italic font-semibold">I</span>
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

      <Group>
        <IconBtn
          label="רשימת תבליטים"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <BulletSVG />
        </IconBtn>
        <IconBtn
          label="רשימה ממוספרת"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <OrderedSVG />
        </IconBtn>
      </Group>
      <Divider />

      <Group>
        <IconBtn
          label="יישור לימין"
          active={editor.isActive({ textAlign: 'right' })}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignSVG side="right" />
        </IconBtn>
        <IconBtn
          label="יישור למרכז"
          active={editor.isActive({ textAlign: 'center' })}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignSVG side="center" />
        </IconBtn>
        <IconBtn
          label="יישור לשמאל"
          active={editor.isActive({ textAlign: 'left' })}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignSVG side="left" />
        </IconBtn>
      </Group>
      <Divider />

      <LinkButton editor={editor} />
      <Divider />

      <DynamicFieldMenu editor={editor} />
    </div>
  );
}

function Group({ children }) {
  return <div className="flex items-center gap-0.5 shrink-0">{children}</div>;
}

function Divider() {
  return <span className="w-px h-5 bg-gray-300 mx-1 shrink-0" aria-hidden />;
}

function IconBtn({ children, label, shortcut, active, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded text-[13px] transition ${
        active ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-200'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function HeadingSelect({ editor }) {
  let value = 'p';
  for (const level of [1, 2, 3]) {
    if (editor.isActive('heading', { level })) value = `h${level}`;
  }
  function set(v) {
    const chain = editor.chain().focus();
    if (v === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(v.slice(1)) }).run();
  }
  return (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-8 px-2 text-sm border border-gray-200 rounded hover:bg-gray-100 bg-white shrink-0"
      aria-label="סגנון כותרת"
    >
      <option value="p">טקסט</option>
      <option value="h1">כותרת 1</option>
      <option value="h2">כותרת 2</option>
      <option value="h3">כותרת 3</option>
    </select>
  );
}

function LinkButton({ editor }) {
  function run() {
    const current = editor.getAttributes('link').href || '';
    // Prompt is a simple but adequate UX for slice 3.
    const url = window.prompt('הקישו כתובת (ריק = הסרה):', current);
    if (url === null) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url === '') chain.unsetLink().run();
    else chain.setLink({ href: url }).run();
  }
  return (
    <IconBtn label="קישור" active={editor.isActive('link')} onClick={run}>
      <LinkSVG />
    </IconBtn>
  );
}

function DynamicFieldMenu({ editor }) {
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

  function insert(key) {
    setOpen(false);
    editor.chain().focus().insertDynamicField(key).run();
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-2 text-[13px] rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 flex items-center gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>+ שדה דינמי</span>
        <span className="text-[9px]">▼</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1 min-w-[200px]"
        >
          {DYNAMIC_FIELDS.map((f) => (
            <button
              role="menuitem"
              type="button"
              key={f.key}
              onClick={() => insert(f.key)}
              className="w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-3"
            >
              <span className="flex-1">{f.label}</span>
              <span
                className="text-[10px] text-gray-500 font-mono bg-gray-100 rounded px-1.5 py-0.5"
                dir="ltr"
              >
                {`{{${f.key}}}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- inline SVG icons (16px, currentColor) --------

function UndoSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}
function RedoSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  );
}
function BulletSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" />
    </svg>
  );
}
function OrderedSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      <text x="1" y="8" fontSize="6" fill="currentColor" stroke="none">1</text>
      <text x="1" y="14" fontSize="6" fill="currentColor" stroke="none">2</text>
      <text x="1" y="20" fontSize="6" fill="currentColor" stroke="none">3</text>
    </svg>
  );
}
function AlignSVG({ side }) {
  const lines = {
    right: [
      [6, 6, 21, 6],
      [3, 12, 21, 12],
      [9, 18, 21, 18],
    ],
    center: [
      [6, 6, 18, 6],
      [3, 12, 21, 12],
      [6, 18, 18, 18],
    ],
    left: [
      [3, 6, 18, 6],
      [3, 12, 21, 12],
      [3, 18, 15, 18],
    ],
  }[side];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {lines.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </svg>
  );
}
function LinkSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
