import { useEffect, useRef, useState } from 'react';

// Searchable destination picker — the GOS OrgPicker pattern (free-typed input +
// suggestion dropdown) with keyboard navigation added. Server-driven: `search(q)`
// returns the COMPLETE destination population (registry + standalone legacy orgs),
// so no client-side list — and no virtualization needed: the server caps results
// and reports truncation, which is rendered honestly.
//
// value: { key, label } | null. onSelect(entry|null) — entry is {key,name,kind}.
const KIND_LABEL = {
  proposal: 'מתור הארגונים',
  gos: 'קיים ב-GOS',
  legacy: 'ארגון מקור — ייובא כפי שהוא',
};

export default function TargetCombobox({ value, onSelect, search, placeholder = 'הקלד שם ארגון…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const listRef = useRef(null);

  // Debounced server search; stale responses are dropped by sequence number.
  useEffect(() => {
    const needle = q.trim();
    if (!needle) { setMatches([]); setTruncated(false); setLoading(false); return undefined; }
    setLoading(true);
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await search(needle);
        if (seq.current !== mySeq) return;
        setMatches(r.matches || []);
        setTruncated(!!r.truncated);
        setActive((r.matches || []).length ? 0 : -1);
      } catch {
        if (seq.current === mySeq) { setMatches([]); setTruncated(false); }
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, search]);

  // Keep the active option visible while arrowing through the list.
  useEffect(() => {
    listRef.current?.children?.[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function choose(entry) {
    onSelect(entry);
    setQ('');
    setOpen(false);
    setMatches([]);
  }
  function onKeyDown(e) {
    if (!open || !matches.length) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(matches[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  // A chosen value is preserved and displayed as a chip until explicitly cleared.
  if (value) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] bg-blue-50 border border-blue-200 rounded-md px-2 py-1">
        <span className="text-gray-900">{value.label}</span>
        <button type="button" onClick={() => onSelect(null)} title="נקה בחירה"
          className="text-blue-700 hover:text-blue-900 font-bold leading-none">✕</button>
      </span>
    );
  }

  return (
    <div className="relative flex-1 min-w-56">
      <input
        type="text" value={q} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      {open && q.trim() && (
        <ul ref={listRef} className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {loading && <li className="px-3 py-2 text-[12px] text-gray-400">מחפש…</li>}
          {!loading && !matches.length && (
            <li className="px-3 py-2 text-[12px] text-gray-400">אין תוצאות עבור "{q.trim()}"</li>
          )}
          {!loading && matches.map((m, i) => (
            <li key={m.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m)}
                className={`flex w-full items-baseline justify-between gap-2 text-right px-3 py-2 text-[13px] ${i === active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <span className="text-gray-900 truncate">{m.name}</span>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">{KIND_LABEL[m.kind] || m.kind}</span>
              </button>
            </li>
          ))}
          {!loading && truncated && (
            <li className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100">יש עוד תוצאות — דייק את החיפוש</li>
          )}
        </ul>
      )}
    </div>
  );
}
