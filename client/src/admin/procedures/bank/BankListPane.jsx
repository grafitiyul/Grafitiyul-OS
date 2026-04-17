import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ITEM_KINDS, ITEM_KIND_LABELS, LIST_FILTERS } from './config.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';

export default function BankListPane({ content, questions, loading, error, onRetry }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { id: selectedId } = useParams();

  const combined = useMemo(() => {
    const withKind = [
      ...content.map((i) => ({ ...i, kind: ITEM_KINDS.CONTENT })),
      ...questions.map((i) => ({ ...i, kind: ITEM_KINDS.QUESTION })),
    ];
    withKind.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return withKind;
  }, [content, questions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combined.filter((i) => {
      if (filter !== 'all' && i.kind !== filter) return false;
      if (q && !i.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [combined, search, filter]);

  function openItem(item) {
    navigate(`/admin/procedures/bank/${item.kind}/${item.id}`);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש פריט..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        <NewItemMenu />
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
          <div className="p-6 text-center">
            <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
            <div className="text-xs text-gray-500 mb-3 font-mono" dir="ltr">
              {error}
            </div>
            <button
              onClick={onRetry}
              className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
            >
              נסו שוב
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyListState hasAny={combined.length > 0} search={search} filter={filter} />
        )}
        {!loading && !error && filtered.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {filtered.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  onClick={() => openItem(item)}
                  className={`w-full text-right px-3 py-3 hover:bg-gray-50 transition block ${
                    selectedId === item.id ? 'bg-blue-50' : ''
                  }`}
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
                  <div className="flex items-center gap-3 text-[11px] text-gray-500">
                    <span>{relativeHebrew(item.updatedAt)}</span>
                    <span className="text-gray-300">·</span>
                    {/* Usage indicator — placeholder until flow builder lands (slice 3+) */}
                    <span title="יוצג בקרוב">— בשימוש</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyListState({ hasAny, search, filter }) {
  if (hasAny && (search || filter !== 'all')) {
    return (
      <div className="p-6 text-center">
        <div className="text-sm text-gray-500">לא נמצאו פריטים תואמים</div>
      </div>
    );
  }
  return (
    <div className="p-6 text-center max-w-xs mx-auto">
      <div className="text-4xl mb-3 opacity-50">☷</div>
      <div className="font-semibold text-gray-800 mb-1">עדיין אין פריטים בבנק</div>
      <div className="text-sm text-gray-500">
        השתמשו בכפתור "+ חדש" כדי ליצור פריט ראשון.
      </div>
    </div>
  );
}

function NewItemMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function choose(kind) {
    setOpen(false);
    navigate(`/admin/procedures/bank/${kind}/new`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium flex items-center justify-between"
      >
        <span>+ חדש</span>
        <span className="text-[10px]">▼</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
          <button
            onClick={() => choose(ITEM_KINDS.CONTENT)}
            className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
          >
            + תוכן חדש
          </button>
          <button
            onClick={() => choose(ITEM_KINDS.QUESTION)}
            className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
          >
            + שאלה חדשה
          </button>
        </div>
      )}
    </div>
  );
}
