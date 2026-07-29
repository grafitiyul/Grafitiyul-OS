import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Premium searchable dropdown for the Communication Center selectors —
// the GOS OrgPicker/TargetCombobox pattern, upgraded: portal-rendered list
// (never clipped inside the editor), immediate search input, debounced async
// search, full keyboard navigation, avatars/subtitles, loading/empty/error/
// disabled states, RTL-correct. One component for WhatsApp accounts, groups,
// contacts, staff and deals — never a weaker per-screen duplicate.
//
// Props:
//   value       {id,label,subtitle?,avatar?} | null
//   onSelect    (item|null)
//   search      async (q) => [{id,label,subtitle?,avatar?,disabled?,disabledReason?}]
//   placeholder string
//   emptySearch bool — run search('') on open (small/global lists)
//   disabled    bool
//   wrapLabel   bool — labels WRAP instead of truncating (long names stay fully
//               readable, both on the trigger and in the list). Off by default so
//               every existing single-line caller keeps its exact layout.
//   compact     bool — ~30% shorter trigger (tighter padding, smaller type) for
//               toolbar-style rows where the control sits beside other controls
//               rather than being the focus of a form. Off by default.
export default function SearchSelect({
  value, onSelect, search, placeholder = 'חיפוש…', emptySearch = true, disabled = false,
  wrapLabel = false, compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const anchorRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const mySeq = ++seq.current;
    const needle = q.trim();
    if (!needle && !emptySearch) { setItems([]); setLoading(false); return undefined; }
    setLoading(true);
    setError(false);
    const t = setTimeout(async () => {
      try {
        const r = await search(needle);
        if (seq.current !== mySeq) return;
        setItems(Array.isArray(r) ? r : []);
        setActive(r?.length ? 0 : -1);
      } catch {
        if (seq.current === mySeq) { setItems([]); setError(true); }
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, needle ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, open, search, emptySearch]);

  // Anchor-position the portal list; close on outside click / Escape / scroll away.
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      setPos({
        left: r.left,
        width: r.width,
        top: below > 280 ? r.bottom + 4 : null,
        bottom: below > 280 ? null : window.innerHeight - r.top + 4,
      });
    };
    place();
    const onDoc = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelectorAll('[data-opt]')?.[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function choose(item) {
    if (item?.disabled) return;
    onSelect(item);
    setOpen(false);
    setQ('');
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // stopPropagation, not just preventDefault: the list is PORTALLED to
      // <body>, so the event would otherwise bubble to a host dialog's
      // document-level Escape handler and close the whole modal behind us.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(items[active]); }
  }

  return (
    <div dir="rtl" ref={anchorRef} className="relative">
      {/* trigger — selected value stays clearly visible after closing */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center rounded-lg border text-right transition-colors ${
          compact ? 'gap-1.5 px-2.5 py-1 text-[12.5px]' : 'gap-2 px-3 py-2 text-[13.5px]'
        } ${
          disabled
            ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
            : open
              ? 'border-blue-400 bg-white ring-2 ring-blue-100'
              : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value?.avatar && (
          <img src={value.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
        )}
        {/* leading-tight in compact mode — the inherited 18.75px line box is
            what keeps the trigger tall; nothing here has a fixed height, so a
            wrapped label can still grow it. */}
        <span className={`min-w-0 flex-1 ${compact ? 'leading-tight' : ''}`}>
          {value ? (
            <>
              <span className={`block font-medium text-gray-900 ${compact ? 'leading-tight' : ''} ${wrapLabel ? 'whitespace-normal break-words' : 'truncate'}`}>
                {value.label}
              </span>
              {value.subtitle && (
                <span className={`block text-[11.5px] text-gray-500 ${wrapLabel ? 'whitespace-normal break-words' : 'truncate'}`}>
                  {value.subtitle}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        {value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onSelect(null); }}
            // The ✕ exists ONLY when a value is selected, so its line box was
            // what made the compact trigger jump 29px -> 33px on selection.
            className={`shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${compact ? 'leading-none' : ''}`}
            title="נקה בחירה"
          >
            ✕
          </span>
        )}
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={listRef}
          dir="rtl"
          role="listbox"
          className="fixed z-[95] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ left: pos.left, width: Math.max(pos.width, 260), top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto' }}
        >
          <div className="border-b border-gray-100 p-2">
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {loading && <div className="px-3 py-3 text-center text-[12px] text-gray-400">טוען…</div>}
            {!loading && error && <div className="px-3 py-3 text-center text-[12px] text-red-500">שגיאה בחיפוש — נסו שוב</div>}
            {!loading && !error && !items.length && (
              <div className="px-3 py-3 text-center text-[12px] text-gray-400">
                {q.trim() ? `אין תוצאות עבור "${q.trim()}"` : 'אין תוצאות'}
              </div>
            )}
            {!loading && items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                data-opt
                role="option"
                aria-selected={value?.id === item.id}
                disabled={item.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-right text-[13px] ${
                  item.disabled
                    ? 'cursor-not-allowed opacity-45'
                    : i === active
                      ? 'bg-blue-50'
                      : 'hover:bg-gray-50'
                } ${value?.id === item.id ? 'font-semibold text-blue-700' : 'text-gray-800'}`}
              >
                {item.avatar ? (
                  <img src={item.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : item.icon ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[13px]">{item.icon}</span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className={`block ${wrapLabel ? 'whitespace-normal break-words leading-snug' : 'truncate'}`}>
                    {item.label}
                  </span>
                  {(item.subtitle || item.disabledReason) && (
                    <span className={`block text-[11px] text-gray-400 ${wrapLabel ? 'whitespace-normal break-words' : 'truncate'}`}>
                      {item.disabled && item.disabledReason ? item.disabledReason : item.subtitle}
                    </span>
                  )}
                </span>
                {value?.id === item.id && <span className="shrink-0 text-blue-600">✓</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
