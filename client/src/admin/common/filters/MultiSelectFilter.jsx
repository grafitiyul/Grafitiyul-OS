import { useMemo, useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';

// THE shared multi-select filter dropdown — one implementation for every
// multi-select filter surface (payroll report years/months/guides, future
// screens). Compact trigger with a summary; AnchoredMenu popover with
// optional search, checkbox per option, בחר הכל / נקה הכול, selected count.
// RTL-correct via the shared menu.
//
// Selection semantics (one convention for all consumers):
//   • values = the explicitly checked option values.
//   • [] (nothing checked) OR every option checked ⇒ UNRESTRICTED — the
//     summary shows `allLabel` and consumers apply no filtering.
//     Use isUnrestricted(values, options) instead of re-deriving.

export function isUnrestricted(values, options) {
  return values.length === 0 || values.length >= options.length;
}

export default function MultiSelectFilter({
  label,
  options,
  values,
  onChange,
  allLabel,
  noun,
  searchable = false,
  width = 240,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = new Set(values);
  const summary = isUnrestricted(values, options)
    ? allLabel
    : values.length === 1
      ? options.find((o) => o.value === values[0])?.label || String(values[0])
      : `${values.length} ${noun?.many || label}`;

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return options;
    return options.filter((o) => String(o.label).includes(q));
  }, [options, query]);

  const toggle = (value) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  };

  const restricted = !isUnrestricted(values, options);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] transition ${
          restricted
            ? 'border-blue-300 bg-blue-50 text-blue-800'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span className={restricted ? 'text-blue-500' : 'text-gray-400'}>{label}:</span>
        <span className="font-medium">{summary}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-60">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={width} align="start">
        {searchable && (
          <div className="px-2 pb-1 pt-0.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש…"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        )}
        <div className="flex items-center justify-between px-2.5 py-1 text-[11px] border-b border-gray-100">
          <span className="text-gray-400">
            {restricted ? `${values.length} נבחרו` : 'הכל נכלל'}
          </span>
          <span className="flex gap-2.5">
            <button
              type="button"
              onClick={() => onChange(options.map((o) => o.value))}
              className="text-blue-600 hover:underline"
            >
              בחר הכל
            </button>
            <button type="button" onClick={() => onChange([])} className="text-gray-500 hover:underline">
              נקה הכול
            </button>
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-400">אין תוצאות</div>
          ) : (
            visible.map((o) => (
              <label
                key={String(o.value)}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-gray-800 hover:bg-gray-50 cursor-pointer"
              >
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate flex-1">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </AnchoredMenu>
    </>
  );
}
