import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import { APPROVAL_VIEWS } from '../config.js';

// List pane on the leading edge of the approvals tab. Three segmented views
// of the same underlying data:
//   - inbox: every attempt currently in review (flat, newest first)
//   - by_flow: grouped under each flow title
//   - by_person: grouped under learnerName (best-effort until auth exists)
export default function ApprovalsListPane({
  attempts,
  loading,
  error,
  onRetry,
  viewKey,
  onViewChange,
  statusFilter,
  onStatusFilterChange,
}) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const { id: selectedId } = useParams();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attempts;
    return attempts.filter(
      (a) =>
        (a.learnerName || '').toLowerCase().includes(q) ||
        (a.flowTitle || '').toLowerCase().includes(q),
    );
  }, [attempts, search]);

  const groups = useMemo(() => {
    if (viewKey === 'inbox') {
      return [{ key: '__all', label: null, items: filtered }];
    }
    const byKey = new Map();
    for (const a of filtered) {
      const k = viewKey === 'by_flow' ? a.flowId : a.learnerName || '—';
      const label = viewKey === 'by_flow' ? a.flowTitle : a.learnerName || '—';
      if (!byKey.has(k)) byKey.set(k, { key: k, label, items: [] });
      byKey.get(k).items.push(a);
    }
    return [...byKey.values()].sort((x, y) =>
      String(x.label).localeCompare(String(y.label), 'he'),
    );
  }, [filtered, viewKey]);

  function openAttempt(id) {
    navigate(`/admin/procedures/approvals/${id}`);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-white">
        <div className="flex gap-1 bg-gray-100 rounded-md p-1">
          {APPROVAL_VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => onViewChange(v.key)}
              className={`flex-1 text-center px-2 py-1.5 text-[12px] rounded transition ${
                viewKey === v.key
                  ? 'bg-white shadow-sm text-gray-900 font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[
            { k: 'submitted', label: 'ממתין' },
            { k: 'approved', label: 'אושר' },
            { k: '', label: 'הכל' },
          ].map((f) => (
            <button
              key={f.k || 'all'}
              onClick={() => onStatusFilterChange(f.k)}
              className={`text-[11px] px-2 py-1 rounded border ${
                statusFilter === f.k
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם או זרימה…"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
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
              נסה שוב
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState hasAny={attempts.length > 0} search={search} />
        )}
        {!loading && !error && filtered.length > 0 && (
          <div>
            {groups.map((g) => (
              <div key={g.key}>
                {g.label && (
                  <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-100 sticky top-0">
                    {g.label}
                  </div>
                )}
                <ul className="divide-y divide-gray-100">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => openAttempt(a.id)}
                        className={`w-full text-right px-3 py-3 hover:bg-gray-50 transition block ${
                          selectedId === a.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className="font-medium text-gray-900 truncate flex-1">
                            {a.learnerName}
                          </div>
                          <StatusPill status={a.status} />
                        </div>
                        <div className="text-[12px] text-gray-600 truncate">
                          {a.flowTitle}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                          <span>
                            {a.submittedAt
                              ? `הוגש ${relativeHebrew(a.submittedAt)}`
                              : relativeHebrew(a.updatedAt)}
                          </span>
                          {a.counts.rejected > 0 && (
                            <span className="text-red-700">
                              • {a.counts.rejected} נדחו
                            </span>
                          )}
                          {a.counts.pending > 0 && (
                            <span className="text-amber-700">
                              • {a.counts.pending} ממתינות
                            </span>
                          )}
                          {a.counts.approved > 0 && (
                            <span className="text-green-700">
                              • {a.counts.approved} אושרו
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const m = {
    submitted: { label: 'ממתין', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    approved: { label: 'אושר', cls: 'bg-green-100 text-green-800 border-green-200' },
    in_progress: { label: 'בתהליך', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  }[status] || { label: status, cls: 'bg-gray-100 text-gray-700 border-gray-200' };
  return (
    <span className={`shrink-0 text-[10px] border rounded-full px-2 py-0.5 ${m.cls}`}>
      {m.label}
    </span>
  );
}

function EmptyState({ hasAny, search }) {
  if (search) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        לא נמצאו ניסיונות התואמים לחיפוש.
      </div>
    );
  }
  return (
    <div className="p-8 text-center">
      <div className="text-4xl mb-3 opacity-50">✓</div>
      <div className="font-semibold text-gray-800 mb-1">
        {hasAny ? 'אין תוצאות בתצוגה זו' : 'תיבת הנכנסות ריקה'}
      </div>
      <div className="text-sm text-gray-500">
        תשובות חדשות הממתינות לאישור יופיעו כאן.
      </div>
    </div>
  );
}
