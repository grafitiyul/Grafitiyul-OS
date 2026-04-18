import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import {
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  LIST_FILTERS,
} from '../bank/config.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';

// Modal picker: lists all Item Bank items with search + type filter.
// Clicking an item calls onPick(kind, itemId) and closes.
export default function ItemPicker({ open, onClose, onPick }) {
  const [content, setContent] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setFilter('all');
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [c, q] = await Promise.all([
          api.contentItems.list(),
          api.questionItems.list(),
        ]);
        if (!cancelled) {
          setContent(c);
          setQuestions(q);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const combined = useMemo(() => {
    const all = [
      ...content.map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...questions.map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ];
    all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return all;
  }, [content, questions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combined.filter((i) => {
      if (filter !== 'all' && i.kind !== filter) return false;
      if (q && !i.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [combined, search, filter]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="בחירת פריט"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        className="bg-white w-full sm:max-w-xl sm:rounded-lg shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh', minHeight: '60vh' }}
      >
        <div className="p-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
          <div className="flex-1 font-semibold text-gray-900">בחירת פריט</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="text-gray-500 hover:bg-gray-100 rounded px-2 py-1"
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-2 border-b border-gray-200 shrink-0">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש פריט..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <div className="flex gap-1 bg-gray-100 rounded-md p-1">
            {LIST_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex-1 text-center px-2 py-1 text-[12px] rounded transition ${
                  filter === f.key
                    ? 'bg-white shadow-sm text-gray-900 font-semibold'
                    : 'text-gray-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
          )}
          {error && !loading && (
            <div className="p-6 text-center text-sm text-red-600">
              שגיאה: {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500">
              {combined.length === 0
                ? 'אין פריטים בבנק. יש ליצור פריט תחילה.'
                : 'לא נמצאו פריטים תואמים.'}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {filtered.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    onClick={() => onPick(item.kind, item.id, item)}
                    className="w-full text-right px-3 py-3 hover:bg-gray-50 transition block"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          item.kind === ITEM_KINDS.QUESTION
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {ITEM_KIND_LABELS[item.kind]}
                      </span>
                      <span className="font-medium text-gray-900 truncate flex-1">
                        {item.title || '(ללא כותרת)'}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {relativeHebrew(item.updatedAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
