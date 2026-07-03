import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { alertError, Field, TextInput, stationKindLabel, primaryBtn, ghostBtn } from './kit.jsx';

// Middle pane: stations of the selected tour + inline tour-meta editing.
export default function StationsPane({ tourId, activeStationId }) {
  const nav = useNavigate();
  const [tour, setTour] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [newStation, setNewStation] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, st] = await Promise.all([api.tourContent.getTour(tourId), api.tourContent.listStations(tourId)]);
      setTour(t); setRows(st);
    } catch (e) { alertError('שגיאה בטעינת התחנות', e); } finally { setLoading(false); }
  }, [tourId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function addStation() {
    if (!newStation.trim()) return;
    setBusy(true);
    try {
      const s = await api.tourContent.createStation(tourId, { titleHe: newStation.trim() });
      setShowAdd(false); setNewStation('');
      await refresh();
      nav(`/admin/tour-content/tours/${tourId}/stations/${s.id}`);
    } catch (e) { alertError('שגיאה בהוספת תחנה', e); } finally { setBusy(false); }
  }
  async function reorder(ids) {
    try { await api.tourContent.reorderStations(tourId, ids); } catch (e) { alertError('שגיאה בעדכון הסדר', e); refresh(); }
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-[#fcfcfd] border-l border-gray-200">
      <div className="px-3.5 pt-4 pb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-semibold tracking-wide">
          <span className="truncate">{tour?.titleHe || '…'}</span>
          <button className="text-gray-400 hover:text-blue-600" title="עריכת הסיור" onClick={() => setShowTour(true)}>✎</button>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <h2 className="text-[15px] font-bold text-gray-900">תחנות</h2>
          <span className="text-[12px] text-gray-400">({rows.length})</span>
          <div className="flex-1" />
          <button className={ghostBtn + ' !px-3 !py-1.5 !text-[12px]'} onClick={() => setShowAdd(true)}>+ תחנה</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-gray-400">אין עדיין תחנות בסיור.</div>
        ) : (
          <ReorderableList
            items={rows}
            onReorder={reorder}
            emptyText=""
            renderRow={(s, { handle }) => {
              const sel = s.id === activeStationId;
              const n = rows.findIndex((r) => r.id === s.id) + 1;
              return (
                <div className={`flex items-center gap-2 rounded-xl px-2 py-1.5 cursor-pointer border ${sel ? 'bg-white border-gray-200 shadow-sm' : 'border-transparent hover:bg-white'}`}>
                  <span className="opacity-40">{handle}</span>
                  <span className={`w-6 h-6 rounded-md grid place-items-center text-[12px] font-bold tabular-nums ${sel ? 'bg-blue-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}>{n}</span>
                  <button className="flex-1 text-right min-w-0" onClick={() => nav(`/admin/tour-content/tours/${tourId}/stations/${s.id}`)}>
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{s.titleHe}</div>
                    <div className="text-[11px] text-gray-400">{stationKindLabel(s.kind)}{!s.active ? ' · בארכיון' : ''}</div>
                  </button>
                </div>
              );
            }}
          />
        )}
      </div>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)} title="תחנה חדשה"
        footer={<>
          <button className={ghostBtn} onClick={() => setShowAdd(false)} disabled={busy}>ביטול</button>
          <button className={primaryBtn} onClick={addStation} disabled={busy || !newStation.trim()}>{busy ? 'יוצר…' : 'צור תחנה'}</button>
        </>}>
        <Field label="שם התחנה (עברית)">
          <TextInput autoFocus value={newStation} onChange={(e) => setNewStation(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addStation(); }} placeholder="לדוגמה: כיכר פלורנטין" />
        </Field>
      </Dialog>

      {showTour && tour && <TourEditDialog tour={tour} onClose={() => setShowTour(false)} onSaved={async () => { setShowTour(false); await refresh(); }} onArchivedTour={() => { setShowTour(false); nav('/admin/tour-content'); }} />}
    </aside>
  );
}

function TourEditDialog({ tour, onClose, onSaved, onArchivedTour }) {
  const [titleHe, setTitleHe] = useState(tour.titleHe || '');
  const [descriptionHe, setDescriptionHe] = useState(tour.descriptionHe || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try { await api.tourContent.updateTour(tour.id, { titleHe, descriptionHe }); onSaved(); }
    catch (e) { alertError('שגיאה בשמירה', e); setBusy(false); }
  }
  async function toggleArchive() {
    const next = !tour.active;
    if (next === false && !confirm('להעביר את הסיור לארכיון?')) return;
    try { await api.tourContent.updateTour(tour.id, { active: next }); next ? onSaved() : onArchivedTour(); }
    catch (e) { alertError('שגיאה', e); }
  }

  return (
    <Dialog open onClose={onClose} title="עריכת סיור"
      footer={<>
        <button className={ghostBtn} onClick={toggleArchive}>{tour.active ? 'העברה לארכיון' : 'שחזור'}</button>
        <div className="flex-1" />
        <button className={ghostBtn} onClick={onClose} disabled={busy}>ביטול</button>
        <button className={primaryBtn} onClick={save} disabled={busy || !titleHe.trim()}>{busy ? 'שומר…' : 'שמור'}</button>
      </>}>
      <div className="space-y-3">
        <Field label="שם הסיור"><TextInput value={titleHe} onChange={(e) => setTitleHe(e.target.value)} /></Field>
        <Field label="תיאור"><TextInput value={descriptionHe} onChange={(e) => setDescriptionHe(e.target.value)} placeholder="אופציונלי" /></Field>
      </div>
    </Dialog>
  );
}
