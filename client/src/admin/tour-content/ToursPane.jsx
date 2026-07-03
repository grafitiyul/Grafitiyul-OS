import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { alertError, Field, TextInput, primaryBtn, ghostBtn } from './kit.jsx';

// Right pane: the list of tours. Selecting a tour reveals its stations pane.
export default function ToursPane({ activeTourId }) {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [titleHe, setTitleHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setRows(await api.tourContent.listTours()); } catch (e) { alertError('שגיאה בטעינת סיורים', e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const shown = rows.filter((t) => (showArchived || t.active) && (!q.trim() || (t.titleHe || '').includes(q.trim())));

  async function createTour() {
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      const t = await api.tourContent.createTour({ titleHe: titleHe.trim() });
      setShowCreate(false); setTitleHe('');
      await refresh();
      nav(`/admin/tour-content/tours/${t.id}`);
    } catch (e) { alertError('שגיאה ביצירת סיור', e); } finally { setBusy(false); }
  }

  async function reorder(ids) {
    try { await api.tourContent.reorderTours(ids); } catch (e) { alertError('שגיאה בעדכון הסדר', e); refresh(); }
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-white border-l border-gray-200">
      <div className="px-3.5 pt-4 pb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-gray-900">סיורים</h2>
          <div className="flex-1" />
          <button className={primaryBtn + ' !px-3 !py-1.5 !text-[12px]'} onClick={() => setShowCreate(true)}>+ סיור</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש סיור…"
          className="mt-2.5 h-9 w-full rounded-lg border border-gray-300 px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <label className="mt-2 flex items-center gap-1.5 text-[12px] text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> הצג ארכיון
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
        ) : shown.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-gray-400">{rows.length ? 'אין תוצאות' : 'אין עדיין סיורים'}</div>
        ) : (
          <ReorderableList
            items={shown}
            onReorder={reorder}
            emptyText=""
            renderRow={(t, { handle }) => {
              const sel = t.id === activeTourId;
              return (
                <div className={`flex items-center gap-2 rounded-xl px-2 py-2 cursor-pointer border ${sel ? 'bg-blue-50 border-blue-200' : 'border-transparent hover:bg-gray-50'}`}>
                  <span className="opacity-40">{handle}</span>
                  <button className="flex-1 text-right min-w-0" onClick={() => nav(`/admin/tour-content/tours/${t.id}`)}>
                    <div className={`text-[13.5px] font-semibold truncate ${sel ? 'text-blue-800' : 'text-gray-900'}`}>{t.titleHe}</div>
                    <div className="text-[11.5px] text-gray-400">{t.active ? 'פעיל' : 'בארכיון'}</div>
                  </button>
                </div>
              );
            }}
          />
        )}
      </div>

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="סיור חדש"
        footer={<>
          <button className={ghostBtn} onClick={() => setShowCreate(false)} disabled={busy}>ביטול</button>
          <button className={primaryBtn} onClick={createTour} disabled={busy || !titleHe.trim()}>{busy ? 'יוצר…' : 'צור סיור'}</button>
        </>}>
        <Field label="שם הסיור (עברית)">
          <TextInput autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createTour(); }} placeholder="לדוגמה: סיור גרפיטי פלורנטין" />
        </Field>
      </Dialog>
    </aside>
  );
}
