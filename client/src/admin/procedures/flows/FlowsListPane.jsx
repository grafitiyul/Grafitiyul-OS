import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';

export default function FlowsListPane({ flows, loading, error, onRetry, onCreated }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { id: selectedId } = useParams();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => (f.title || '').toLowerCase().includes(q));
  }, [flows, search]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש זרימה..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        {creating ? (
          <CreateForm
            onCancel={() => setCreating(false)}
            onCreated={async (flow) => {
              setCreating(false);
              await onCreated?.();
              navigate(`/admin/procedures/flows/${flow.id}`);
            }}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium"
          >
            + זרימה חדשה
          </button>
        )}
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
          <EmptyState hasAny={flows.length > 0} search={search} />
        )}
        {!loading && !error && filtered.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {filtered.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => navigate(`/admin/procedures/flows/${f.id}`)}
                  className={`w-full text-right px-3 py-3 hover:bg-gray-50 transition block ${
                    selectedId === f.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="font-medium text-gray-900 truncate mb-1">
                    {f.title || '(ללא שם)'}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{relativeHebrew(f.updatedAt)}</span>
                    <span className="text-gray-300">·</span>
                    <span>
                      {(f._count?.nodes ?? 0)} פריטים
                    </span>
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

function EmptyState({ hasAny, search }) {
  if (hasAny && search) {
    return (
      <div className="p-6 text-center">
        <div className="text-sm text-gray-500">לא נמצאו זרימות תואמות</div>
      </div>
    );
  }
  return (
    <div className="p-6 text-center max-w-xs mx-auto">
      <div className="text-4xl mb-3 opacity-50">◫</div>
      <div className="font-semibold text-gray-800 mb-1">עדיין אין זרימות</div>
      <div className="text-sm text-gray-500">
        השתמשו בכפתור "+ זרימה חדשה" כדי ליצור את הראשונה.
      </div>
    </div>
  );
}

function CreateForm({ onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function submit(e) {
    e?.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const flow = await api.flows.create({ title: clean });
      onCreated(flow);
    } catch (err) {
      alert('יצירה נכשלה: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border border-blue-200 bg-blue-50 rounded-md p-2 flex gap-1"
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="שם הזרימה"
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="bg-blue-600 text-white rounded px-3 text-sm font-medium disabled:opacity-40"
      >
        {busy ? '...' : 'צור'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="border border-gray-300 rounded px-2 text-sm text-gray-600 hover:bg-white"
        aria-label="ביטול"
      >
        ×
      </button>
    </form>
  );
}
