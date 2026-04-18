import { useEffect, useRef, useState } from 'react';
import { DYNAMIC_FIELDS } from '../lib/dynamicFields.js';
import LinkPopover from './LinkPopover.jsx';
import ColorPicker from './ColorPicker.jsx';
import { uploadMedia } from './mediaUpload.js';

// ---- palette / option tables (stable values, never reference labels) ----

export const TEXT_COLORS = [
  { value: '#111827', name: 'ברירת מחדל כהה' },
  { value: '#6b7280', name: 'אפור' },
  { value: '#dc2626', name: 'אדום' },
  { value: '#ea580c', name: 'כתום' },
  { value: '#ca8a04', name: 'חום-צהוב' },
  { value: '#16a34a', name: 'ירוק' },
  { value: '#0891b2', name: 'טורקיז' },
  { value: '#2563eb', name: 'כחול' },
  { value: '#9333ea', name: 'סגול' },
  { value: '#db2777', name: 'ורוד' },
  { value: '#64748b', name: 'אפור-כחול' },
  { value: '#be185d', name: 'בורדו' },
  { value: '#15803d', name: 'ירוק כהה' },
  { value: '#1e40af', name: 'כחול כהה' },
];

export const HIGHLIGHT_COLORS = [
  { value: '#fef08a', name: 'צהוב' },
  { value: '#bbf7d0', name: 'ירוק בהיר' },
  { value: '#bfdbfe', name: 'כחול בהיר' },
  { value: '#fbcfe8', name: 'ורוד בהיר' },
  { value: '#e9d5ff', name: 'סגול בהיר' },
  { value: '#fed7aa', name: 'כתום בהיר' },
  { value: '#fecaca', name: 'אדום בהיר' },
];

export const FONT_FAMILIES = [
  { value: '', name: 'ברירת מחדל' },
  { value: 'Heebo, system-ui, sans-serif', name: 'Heebo' },
  { value: 'Assistant, system-ui, sans-serif', name: 'Assistant' },
  { value: 'Rubik, system-ui, sans-serif', name: 'Rubik' },
  { value: 'Arial, sans-serif', name: 'Arial' },
  { value: '"Times New Roman", serif', name: 'Times New Roman' },
  { value: '"Courier New", monospace', name: 'Courier New' },
];

export const FONT_SIZES = [
  { value: '', name: 'ברירת מחדל' },
  { value: '12px', name: '12' },
  { value: '14px', name: '14' },
  { value: '16px', name: '16' },
  { value: '18px', name: '18' },
  { value: '20px', name: '20' },
  { value: '24px', name: '24' },
  { value: '32px', name: '32' },
];

// ---- toolbar ----

export default function Toolbar({ editor }) {
  if (!editor) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 p-1.5 bg-gray-50 rounded-b-md"
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
      <FontFamilySelect editor={editor} />
      <FontSizeSelect editor={editor} />
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

      <TextColorButton editor={editor} />
      <HighlightButton editor={editor} />
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

      <Group>
        <ImageUploadButton editor={editor} />
        <VideoUploadButton editor={editor} />
      </Group>
      <Divider />

      <DynamicFieldMenu editor={editor} />
    </div>
  );
}

function ImageUploadButton({ editor }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadMedia(file, 'image');
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .setImage({ src: asset.url, alt: file.name.replace(/\.[^.]+$/, '') })
        .run();
    } catch (err) {
      alert('העלאת תמונה נכשלה: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconBtn
        label={busy ? 'מעלה תמונה…' : 'הוספת תמונה'}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImageSVG />
      </IconBtn>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={onPick}
        style={{ display: 'none' }}
      />
    </>
  );
}

function VideoUploadButton({ editor }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadMedia(file, 'video');
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .insertMediaVideo({ src: asset.url })
        .run();
    } catch (err) {
      alert('העלאת וידאו נכשלה: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconBtn
        label={busy ? 'מעלה וידאו…' : 'הוספת וידאו'}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <VideoSVG />
      </IconBtn>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime"
        onChange={onPick}
        style={{ display: 'none' }}
      />
    </>
  );
}

function Group({ children }) {
  return <div className="flex items-center gap-0.5 shrink-0">{children}</div>;
}

function Divider() {
  return <span className="w-px h-5 bg-gray-300 mx-1 shrink-0" aria-hidden />;
}

function IconBtn({ children, label, shortcut, active, onClick, disabled, style }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ? 'true' : 'false'}
      title={shortcut ? `${label} (${shortcut})` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`relative w-9 h-9 flex items-center justify-center rounded-md text-[13px] transition ${
        active
          ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
          : 'text-gray-700 hover:bg-gray-200'
      } disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Select({ value, onChange, options, label, minWidth = 110 }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-9 px-2 text-sm border border-gray-200 rounded-md hover:bg-gray-100 bg-white shrink-0"
      style={{ minWidth }}
      aria-label={label}
      title={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.name}
        </option>
      ))}
    </select>
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
    <Select
      value={value}
      onChange={set}
      label="סגנון כותרת"
      minWidth={100}
      options={[
        { value: 'p', name: 'טקסט' },
        { value: 'h1', name: 'כותרת 1' },
        { value: 'h2', name: 'כותרת 2' },
        { value: 'h3', name: 'כותרת 3' },
      ]}
    />
  );
}

function FontFamilySelect({ editor }) {
  const current = editor.getAttributes('textStyle').fontFamily || '';
  function set(v) {
    const chain = editor.chain().focus();
    if (!v) chain.unsetFontFamily().run();
    else chain.setFontFamily(v).run();
  }
  return (
    <Select
      value={current}
      onChange={set}
      label="גופן"
      minWidth={120}
      options={FONT_FAMILIES}
    />
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
    <Select
      value={current}
      onChange={set}
      label="גודל גופן"
      minWidth={70}
      options={FONT_SIZES}
    />
  );
}

function TextColorButton({ editor }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const current = editor.getAttributes('textStyle').color;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="צבע טקסט"
        title="צבע טקסט"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex flex-col items-center justify-center rounded-md text-[13px] transition text-gray-700 hover:bg-gray-200 shrink-0"
      >
        <span className="font-bold leading-none">A</span>
        <span
          className="mt-0.5 h-[3px] w-5 rounded"
          style={{ background: current || '#111827' }}
        />
      </button>
      <ColorPicker
        open={open}
        anchorEl={btnRef.current}
        onClose={() => setOpen(false)}
        onPick={(c) => {
          editor.chain().focus().setColor(c).run();
          setOpen(false);
        }}
        onClear={() => {
          editor.chain().focus().unsetColor().run();
          setOpen(false);
        }}
        colors={TEXT_COLORS}
        currentColor={current}
        title="צבע טקסט"
      />
    </>
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
        className={`relative w-9 h-9 flex flex-col items-center justify-center rounded-md text-[13px] transition shrink-0 ${
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

function LinkButton({ editor }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="קישור"
        aria-pressed={editor.isActive('link') ? 'true' : 'false'}
        title="קישור"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`relative w-9 h-9 flex items-center justify-center rounded-md text-[13px] transition shrink-0 ${
          editor.isActive('link')
            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
            : 'text-gray-700 hover:bg-gray-200'
        }`}
      >
        <LinkSVG />
      </button>
      <LinkPopover
        editor={editor}
        open={open}
        anchorEl={btnRef.current}
        onClose={() => setOpen(false)}
      />
    </>
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
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .insertDynamicField(key)
      .run();
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="h-9 px-3 text-[13px] rounded-md bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 flex items-center gap-1 font-medium"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>+ שדה דינמי</span>
        <span className="text-[9px] opacity-70">▼</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-1 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1 min-w-[260px]"
        >
          {DYNAMIC_FIELDS.map((f) => (
            <button
              role="menuitem"
              type="button"
              key={f.key}
              onClick={() => insert(f.key)}
              className="w-full text-right px-3 py-2 hover:bg-gray-50 flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium text-gray-900">
                  {f.label}
                </span>
                <span
                  className="text-[10px] text-gray-500 font-mono bg-gray-100 rounded px-1.5 py-0.5"
                  dir="ltr"
                >
                  {`{{${f.key}}}`}
                </span>
              </div>
              {f.description && (
                <div className="text-[11px] text-gray-500">{f.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- inline SVG icons --------

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
    right: [[6, 6, 21, 6], [3, 12, 21, 12], [9, 18, 21, 18]],
    center: [[6, 6, 18, 6], [3, 12, 21, 12], [6, 18, 18, 18]],
    left: [[3, 6, 18, 6], [3, 12, 21, 12], [3, 18, 15, 18]],
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
function ImageSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M21 15l-5-5-11 11" />
    </svg>
  );
}
function VideoSVG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="15" height="14" rx="2" />
      <path d="M22 7l-5 5 5 5z" fill="currentColor" />
    </svg>
  );
}
