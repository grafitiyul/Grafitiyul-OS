import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import useDebouncedValue from './useDebouncedValue.js';
import SearchResultRow from './SearchResultRow.jsx';
import CreateDealModal from '../../admin/deals/CreateDealModal.jsx';
import { dealPath } from '../../admin/deals/config.js';
import { useSessionUser } from '../sessionUser.jsx';
import {
  classifySearchInput,
  isCreatable,
  createLeadDescription,
  createLeadPrefill,
  KIND_HINT,
} from './searchIntent.js';
import {
  loadRecents,
  recordRecent,
  removeRecent,
  clearRecents,
} from './recentSearches.js';

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
  const { username } = useSessionUser();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  // Cross-category verification of an empty result page:
  //   null → not needed yet · 'loading' → checking 'all' · number → total hits
  //   found in other categories (0 = genuinely nothing anywhere).
  const [crossTotal, setCrossTotal] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState([]);
  // The classified input for the "+ ליד" flow; non-null mounts the canonical
  // CreateDealModal. Frozen at click time so later typing can't change it.
  const [createIntent, setCreateIntent] = useState(null);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Monotonic request id: only the newest response may render, so a slow
  // early keystroke can never overwrite a fast later one.
  const reqIdRef = useRef(0);
  // The last query that COMPLETED (response rendered). Committed to the
  // recent-search history when the operator acts on it (selects a result,
  // opens "+ ליד") or dismisses the panel — not on every keystroke, so
  // prefixes like "דנ", "דנה" never pollute the history.
  const lastCompletedRef = useRef(null);

  const debouncedQ = useDebouncedValue(q, 250);
  const meaningful = debouncedQ.trim().length >= MIN_QUERY_LENGTH;

  // Per-operator recent searches (localStorage; loads once per login identity).
  useEffect(() => {
    setRecents(loadRecents(window.localStorage, username));
  }, [username]);

  // Flat list of every visible result, in render order — the keyboard walks
  // this, so arrow keys cross group boundaries naturally in "All".
  const flat = useMemo(() => (data?.groups || []).flatMap((g) => g.results), [data]);

  useEffect(() => {
    if (!meaningful) {
      setData(null);
      setLoading(false);
      setError(null);
      setCrossTotal(null);
      lastCompletedRef.current = null;
      return;
    }
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setCrossTotal(null);
    api.search
      .query({ q: debouncedQ, category })
      .then((res) => {
        if (reqIdRef.current !== id) return;
        setData(res);
        setActiveIndex(0);
        setLoading(false);
        lastCompletedRef.current = { q: debouncedQ.trim() };
        const count = (res?.groups || []).reduce((n, g) => n + (g.results?.length || 0), 0);
        if (count > 0) {
          setCrossTotal(null);
          return;
        }
        // Zero results. Before "+ ליד" may appear, verify the OTHER categories
        // are empty too — a contact can exist with no deal, and a formatting
        // difference must never masquerade as "no match". The 'all' category
        // runs every canonical index (normalized phone, email, Hebrew/English
        // names, deal number, organizations) server-side.
        if (category === 'all') {
          setCrossTotal(0);
          return;
        }
        setCrossTotal('loading');
        api.search
          .query({ q: debouncedQ, category: 'all' })
          .then((allRes) => {
            if (reqIdRef.current !== id) return;
            const total = (allRes?.groups || []).reduce((n, g) => n + (g.total || 0), 0);
            setCrossTotal(total);
          })
          .catch(() => {
            if (reqIdRef.current !== id) return;
            // Verification failed → stay honest: no "+ ליד" without proof.
            setCrossTotal(null);
          });
      })
      .catch((e) => {
        if (reqIdRef.current !== id) return;
        setError(e);
        setLoading(false);
      });
  }, [debouncedQ, category, meaningful]);

  // Commit the last completed search to the per-operator history.
  function commitRecent() {
    const done = lastCompletedRef.current;
    if (!done) return;
    lastCompletedRef.current = null;
    const intent = classifySearchInput(done.q);
    setRecents(recordRecent(window.localStorage, username, done.q, intent.kind));
  }

  function dismiss() {
    commitRecent();
    setOpen(false);
  }

  // Close on outside click.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) dismiss();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [username]);

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
    commitRecent();
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    navigate(result.path);
  }

  // A recent-search row was chosen: run that search again.
  function applyRecent(item) {
    setQ(item.q);
    setOpen(true);
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function removeRecentItem(item) {
    setRecents(removeRecent(window.localStorage, username, item.q));
  }

  function clearAllRecents() {
    setRecents(clearRecents(window.localStorage, username));
  }

  function openCreateLead(intent) {
    commitRecent();
    setOpen(false);
    setCreateIntent(intent);
  }

  // ————— what the panel currently shows —————
  const recentsMode = open && q.trim().length === 0;
  const showResultsPanel = open && meaningful;
  const showEmpty = showResultsPanel && !loading && !error && flat.length === 0;
  // "+ ליד" appears ONLY when: the search completed empty, the cross-category
  // check confirmed zero everywhere, and the input classifies as creatable.
  const intent = useMemo(
    () => (showEmpty ? classifySearchInput(debouncedQ) : null),
    [showEmpty, debouncedQ],
  );
  const showCreate = showEmpty && crossTotal === 0 && isCreatable(intent);
  const showCrossHits = showEmpty && typeof crossTotal === 'number' && crossTotal > 0;
  const showPanel = showResultsPanel || (recentsMode && recents.length > 0);
  const grouped = category === 'all';

  // One flat keyboard model over whatever is visible: recents, or results plus
  // the trailing "+ ליד" action.
  const optionCount = recentsMode ? recents.length : flat.length + (showCreate ? 1 : 0);

  function activate(index) {
    if (recentsMode) {
      const item = recents[index];
      if (item) applyRecent(item);
      return;
    }
    if (index < flat.length) select(flat[index]);
    else if (showCreate) openCreateLead(intent);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      dismiss();
      inputRef.current?.blur();
      return;
    }
    if (!open || !optionCount) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % optionCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + optionCount) % optionCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(activeIndex);
    }
  }

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
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="חיפוש בכל המערכת…"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && optionCount ? `gs-opt-${activeIndex}` : undefined}
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
              setActiveIndex(0);
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
            {recentsMode ? (
              <>
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-[11px] text-gray-500">חיפושים אחרונים</span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearAllRecents();
                    }}
                    className="text-[11px] text-gray-400 hover:text-gray-600"
                  >
                    נקה הכל
                  </button>
                </div>
                <ul id="global-search-results" role="listbox" aria-label="חיפושים אחרונים">
                  {recents.map((item, i) => (
                    <li
                      key={`${item.q}:${item.at}`}
                      id={`gs-opt-${i}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      data-active={i === activeIndex}
                      onMouseDown={(e) => {
                        // mousedown, not click: the input's blur would otherwise
                        // close the panel before the click lands.
                        e.preventDefault();
                        applyRecent(item);
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-s-2 ${
                        i === activeIndex
                          ? 'bg-blue-50 border-s-blue-500'
                          : 'border-s-transparent hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-gray-400 shrink-0" aria-hidden>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="9" />
                          <polyline points="12 7 12 12 15.5 14" />
                        </svg>
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[13px] text-gray-800" dir="auto">
                        {item.q}
                      </span>
                      {KIND_HINT[item.kind] && (
                        <span className="text-[11px] text-gray-400 shrink-0">{KIND_HINT[item.kind]}</span>
                      )}
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeRecentItem(item);
                        }}
                        className="text-gray-300 hover:text-gray-500 shrink-0 px-1"
                        aria-label={`הסר את "${item.q}" מהחיפושים האחרונים`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                {error && (
                  <div className="px-3 py-4 text-[13px] text-red-600">
                    החיפוש נכשל. נסה שוב.
                  </div>
                )}
                {showEmpty && (
                  <div className="px-3 pt-4 pb-2 text-[13px] text-gray-500">
                    אין תוצאות עבור “{debouncedQ}”
                  </div>
                )}
                {crossTotal === 'loading' && (
                  <div className="px-3 pb-3 text-[12px] text-gray-400">בודק בכל הקטגוריות…</div>
                )}
                {showCrossHits && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCategory('all');
                    }}
                    className="w-full text-start px-3 pb-3 text-[12px] text-blue-700 hover:underline"
                  >
                    נמצאו תוצאות בקטגוריות אחרות — הצג בהכל
                  </button>
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
                  {showCreate && (
                    <li
                      id={`gs-opt-${flat.length}`}
                      role="option"
                      aria-selected={activeIndex === flat.length}
                      data-active={activeIndex === flat.length}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openCreateLead(intent);
                      }}
                      onMouseEnter={() => setActiveIndex(flat.length)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer border-s-2 border-t border-t-gray-100 ${
                        activeIndex === flat.length
                          ? 'bg-blue-50 border-s-blue-500'
                          : 'border-s-transparent hover:bg-gray-50'
                      }`}
                    >
                      <span className="inline-flex items-center justify-center h-6 rounded-md bg-blue-600 text-white text-[12px] font-semibold px-2 shrink-0">
                        + ליד
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-gray-800" dir="auto">
                          {createLeadDescription(intent)}
                        </span>
                      </span>
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
          {!recentsMode && !grouped && data?.groups?.[0]?.truncated && (
            <div className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100 bg-gray-50">
              מוצגות התוצאות המובילות בלבד — צמצם את החיפוש לתוצאות מדויקות יותר
            </div>
          )}
        </div>
      )}

      {/* The canonical Create Deal modal — the SAME dialog the deals list and
          contact page use. It self-loads its catalogs; nothing is created
          before the operator submits. */}
      {createIntent && (
        <CreateDealModal
          prefill={createLeadPrefill(createIntent)}
          onClose={() => setCreateIntent(null)}
          onCreated={(deal) => {
            setCreateIntent(null);
            setQ('');
            navigate(dealPath(deal));
          }}
        />
      )}
    </div>
  );
}
