import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import {
  ActiveBadge, Loading, ErrorBox, alertError, Field, TextInput, primaryBtn, ghostBtn,
} from './kit.jsx';

export default function ToursPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [titleHe, setTitleHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.tourContent.listTours());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const shown = rows.filter((t) => showArchived || t.active);

  async function createTour() {
    if (!titleHe.trim()) return;
    setBusy(true);
    try {
      const t = await api.tourContent.createTour({ titleHe: titleHe.trim() });
      setShowCreate(false);
      setTitleHe('');
      nav(`/admin/tour-content/tours/${t.id}`);
    } catch (e) {
      alertError('שגיאה ביצירת סיור', e);
    } finally {
      setBusy(false);
    }
  }

  async function reorder(ids) {
    try {
      await api.tourContent.reorderTours(ids);
    } catch (e) {
      alertError('שגיאה בעדכון הסדר', e);
      refresh();
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div dir="rtl" className="max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <p className="text-sm text-gray-500">סיורים — כל סיור מורכב מתחנות מסודרות.</p>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[13px] text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          הצג ארכיון
        </label>
        <button className={primaryBtn} onClick={() => setShowCreate(true)}>+ סיור חדש</button>
      </div>

      {shown.length === 0 ? (
        <div className="px-3 py-16 text-center text-sm text-gray-400">
          {rows.length === 0 ? 'אין עדיין סיורים. צרו את הסיור הראשון.' : 'אין סיורים פעילים.'}
        </div>
      ) : (
        <ReorderableList
          items={shown}
          onReorder={reorder}
          emptyText="אין סיורים"
          renderRow={(tour, { handle }) => (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 hover:border-gray-300">
              {handle}
              <button
                className="flex-1 text-right min-w-0"
                onClick={() => nav(`/admin/tour-content/tours/${tour.id}`)}
              >
                <div className="font-semibold text-gray-900 truncate">{tour.titleHe}</div>
                {tour.descriptionHe && (
                  <div className="text-[12px] text-gray-500 truncate">{tour.descriptionHe}</div>
                )}
              </button>
              <ActiveBadge active={tour.active} />
              <span className="text-gray-300 text-sm">‹</span>
            </div>
          )}
        />
      )}

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="סיור חדש"
        size="md"
        footer={
          <>
            <button className={ghostBtn} onClick={() => setShowCreate(false)} disabled={busy}>ביטול</button>
            <button className={primaryBtn} onClick={createTour} disabled={busy || !titleHe.trim()}>
              {busy ? 'יוצר…' : 'צור סיור'}
            </button>
          </>
        }
      >
        <Field label="שם הסיור (עברית)">
          <TextInput
            autoFocus
            value={titleHe}
            onChange={(e) => setTitleHe(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createTour(); }}
            placeholder="לדוגמה: סיור פלורנטין"
          />
        </Field>
      </Dialog>
    </div>
  );
}
