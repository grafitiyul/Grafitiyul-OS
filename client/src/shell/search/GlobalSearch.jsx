import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import useDebouncedValue from './useDebouncedValue.js';
import SearchResultRow from './SearchResultRow.jsx';

// Categories, in header order. 'deals' is FIRST and is the default on every
// fresh admin session — deliberately not 'all' (spec), and deliberately not
// persisted, so each session starts on Deals.
const CATEGORIES = [
  { key: 'deals', label: 'עסקאות' },
  { key: 'contacts', label: 'אנשי קשר' },
  { key: 'organizations', label: 'ארגונים' },
  { key: 'tasks', label: 'משימות' },
  { key: 'timeline', label: 'הערות' },
  { key: 'all', label: 'הכל' },
];

const DEFAULT_CATEGORY = 'deals';
const MIN_QUERY_LENGTH = 2;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Monotonic request id: only the newest response may render, so a slow
  // early keystroke can never overwrite a fast later one.
  const reqIdRef = useRef(0);

  const debouncedQ = useDebouncedValue(q, 250);
  const meaningful = debouncedQ.trim().length >= MIN_QUERY_LENGTH;

  // Flat list of every visible result, in render order — the keyboard walks
  // this, so arrow keys cross group boundaries naturally in "All".
  const flat = useMemo(() => (data?.groups || []).flatMap((g) => g.results), [data]);

  useEffect(() => {
    if (!meaningful) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    api.search
      .query({ q: debouncedQ, category })
      .then((res) => {
        if (reqIdRef.current !== id) return;
        setData(res);
        setActiveIndex(0);
        setLoading(false);
      })
      .catch((e) => {
        if (reqIdRef.current !== id) return;
        setError(e);
        setLoading(false);
      });
  }, [debouncedQ, category, meaningful]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Ctrl/⌘+K focuses search from anywhere in the admin.
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function select(result) {
    if (!result?.path) return;
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    navigate(result.path);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || !flat.length) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(flat[activeIndex]);
    }
  }

  // The panel only exists once there is meaningful input — never on focus
  // alone, and never for a single stray character.
  const showPanel = open && meaningful;
  const showEmpty = showPanel && !loading && !error && flat.length === 0;
  const grouped = category === 'all';

  let cursor = -1;

  return (
    <div ref={boxRef} className="relative w-full max-w-2xl">
      <div className="flex items-center h-9 rounded-lg border border-gray-300 bg-gray-50/70 focus-within:bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-200 transition-colors">
        {/* Category select. Changing it keeps the query — the effect just
            re-runs against the new category. */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="קטגוריית חיפוש"
          className="h-full bg-transparent text-[12px] text-gray-600 ps-2 pe-1 rounded-s-lg focus:outline-none cursor-pointer shrink-0"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="w-px h-5 bg-gray-200 shrink-0" aria-hidden />
        <span className="text-gray-400 px-2 shrink-0" aria-hidden>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="חיפוש בכל המערכת…"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && flat.length ? `gs-opt-${activeIndex}` : undefined}
          className="flex-1 min-w-0 h-full bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none pe-2"
        />
        {loading && (
          <span className="pe-2 shrink-0" aria-label="טוען">
            <svg className="animate-spin text-gray-400" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {q && !loading && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              inputRef.current?.focus();
            }}
            className="pe-2 text-gray-400 hover:text-gray-600 shrink-0"
            aria-label="נקה חיפוש"
          >
            ✕
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div ref={listRef} className="max-h-[70vh] overflow-y-auto overscroll-contain">
            {error && (
              <div className="px-3 py-4 text-[13px] text-red-600">
                החיפוש נכשל. נסה שוב.
              </div>
            )}
            {showEmpty && (
              <div className="px-3 py-4 text-[13px] text-gray-500">אין תוצאות עבור “{debouncedQ}”</div>
            )}
            <ul id="global-search-results" role="listbox" aria-label="תוצאות חיפוש">
              {(data?.groups || []).map((g) => (
                <li key={g.category}>
                  {grouped && (
                    <div className="sticky top-0 bg-gray-50 px-3 py-1 text-[11px] text-gray-500 border-y border-gray-100">
                      {g.label}
                      <span className="text-gray-400">
                        {' '}
                        · {g.total}
                        {g.truncated ? '+' : ''}
                      </span>
                    </div>
                  )}
                  <ul>
                    {g.results.map((r) => {
                      cursor += 1;
                      const i = cursor;
                      return (
                        <div key={`${r.type}:${r.id}`} data-active={i === activeIndex}>
                          <SearchResultRow
                            id={`gs-opt-${i}`}
                            result={r}
                            active={i === activeIndex}
                            onSelect={select}
                            onHover={() => setActiveIndex(i)}
                          />
                        </div>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          {!grouped && data?.groups?.[0]?.truncated && (
            <div className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100 bg-gray-50">
              מוצגות התוצאות המובילות בלבד — צמצם את החיפוש לתוצאות מדויקות יותר
            </div>
          )}
        </div>
      )}
    </div>
  );
}
