import { useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu.jsx';

// Compact "chip" that opens an AnchoredMenu of options on click — a lightweight
// inline picker for header metadata (activity type, org type, subtype, …).
// Reusable across GOS. Generic over option shape via `options: [{ value, label }]`.
//
//   value        currently selected value (or '' / null)
//   options      [{ value, label }]
//   onSelect     (value) => void   — '' when the clear row is chosen
//   placeholder  shown when nothing is selected
//   icon         optional leading node
//   allowClear   show a "— ללא —" row that selects ''
//   readOnly     render as a static chip (no menu) — used when a parent owns the value
//   tone         'default' | 'accent' | 'muted'
const TONES = {
  default: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
  accent: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
  muted: 'bg-gray-50 text-gray-500 border-dashed border-gray-300 hover:bg-gray-100',
};

export default function SelectChip({
  value,
  options = [],
  onSelect,
  placeholder = 'בחר…',
  icon,
  allowClear = false,
  clearLabel = '— ללא —',
  readOnly = false,
  tone = 'default',
  title,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const text = selected ? selected.label : placeholder;
  const isPlaceholder = !selected;

  const base =
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition';
  const toneCls = TONES[tone] || TONES.default;

  if (readOnly) {
    return (
      <span className={`${base} ${toneCls} cursor-default`} title={title}>
        {icon}
        <span className={isPlaceholder ? 'text-gray-400' : ''}>{text}</span>
      </span>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${base} ${toneCls}`}
      >
        {icon}
        <span className={isPlaceholder ? 'text-gray-400' : ''}>{text}</span>
        <span className="text-[10px] text-gray-400">▾</span>
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={200}>
        {allowClear && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSelect('');
            }}
            className="block w-full text-right px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            {clearLabel}
          </button>
        )}
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setOpen(false);
              onSelect(o.value);
            }}
            className={`block w-full text-right px-3 py-2 text-sm hover:bg-gray-50 ${
              o.value === value ? 'font-semibold text-indigo-700' : 'text-gray-700'
            }`}
          >
            {o.label}
          </button>
        ))}
        {options.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-gray-400">אין אפשרויות</div>
        )}
      </AnchoredMenu>
    </>
  );
}
