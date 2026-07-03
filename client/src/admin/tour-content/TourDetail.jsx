import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import Dialog from '../common/Dialog.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import {
  ActiveBadge, Loading, ErrorBox, alertError, Field, TextInput, SectionTitle,
  stationKindLabel, primaryBtn, ghostBtn,
} from './kit.jsx';

export default function TourDetail() {
  const { tourId } = useParams();
  const nav = useNavigate();
  const [tour, setTour] = useState(null);
  const [stations, setStations] = useState([]);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newStation, setNewStation] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [t, st] = await Promise.all([
        api.tourContent.getTour(tourId),
        api.tourContent.listStations(tourId),
      ]);
      setTour(t);
      setStations(st);
      const init = { titleHe: t.titleHe || '', descriptionHe: t.descriptionHe || '', active: t.active };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tourId]);
  useEffect(() => { refresh(); }, [refresh]);

  useDirtyWhen(form, original, { active: !!form && !!original });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await api.tourContent.updateTour(tourId, form);
      await refresh();
    } catch (e) {
      alertError('שגיאה בשמירה', e);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active) {
    try {
      await api.tourContent.updateTour(tourId, { active });
      await refresh();
    } catch (e) {
      alertError('שגיאה', e);
    }
  }

  async function addStation() {
    if (!newStation.trim()) return;
    setBusy(true);
    try {
      const s = await api.tourContent.createStation(tourId, { titleHe: newStation.trim() });
      setShowAdd(false);
      setNewStation('');
      nav(`/admin/tour-content/stations/${s.id}`);
    } catch (e) {
      alertError('שגיאה בהוספת תחנה', e);
    } finally {
      setBusy(false);
    }
  }

  async function reorderStations(ids) {
    try {
      await api.tourContent.reorderStations(tourId, ids);
    } catch (e) {
      alertError('שגיאה בעדכון הסדר', e);
      refresh();
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <div dir="rtl" className="max-w-3xl space-y-8">
      <div className="text-[13px] text-gray-400">
        <Link to="/admin/tour-content/tours" className="hover:text-gray-600">סיורים</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-600">{tour.titleHe}</span>
      </div>

      {/* Tour meta */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <SectionTitle>פרטי הסיור</SectionTitle>
          <div className="flex-1" />
          <ActiveBadge active={tour.active} />
        </div>
        <Field label="שם הסיור (עברית)">
          <TextInput value={form.titleHe} onChange={(e) => set('titleHe', e.target.value)} />
        </Field>
        <Field label="תיאור (עברית)">
          <TextInput value={form.descriptionHe} onChange={(e) => set('descriptionHe', e.target.value)} placeholder="אופציונלי" />
        </Field>
        <div className="flex gap-2 pt-1">
          <button className={primaryBtn} onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמור'}</button>
          {tour.active ? (
            <button className={ghostBtn} onClick={() => { if (confirm('להעביר את הסיור לארכיון?')) setActive(false); }}>
              העברה לארכיון
            </button>
          ) : (
            <button className={ghostBtn} onClick={() => setActive(true)}>שחזור מארכיון</button>
          )}
        </div>
      </section>

      {/* Stations */}
      <section>
        <SectionTitle count={stations.length} action={<button className={primaryBtn} onClick={() => setShowAdd(true)}>+ תחנה</button>}>
          תחנות
        </SectionTitle>
        <ReorderableList
          items={stations}
          onReorder={reorderStations}
          emptyText="אין עדיין תחנות בסיור הזה."
          renderRow={(st, { handle }) => (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 hover:border-gray-300">
              {handle}
              <button className="flex-1 text-right min-w-0" onClick={() => nav(`/admin/tour-content/stations/${st.id}`)}>
                <div className="font-medium text-gray-900 truncate">{st.titleHe}</div>
                <div className="text-[12px] text-gray-500">{stationKindLabel(st.kind)}</div>
              </button>
              <ActiveBadge active={st.active} />
              <span className="text-gray-300 text-sm">‹</span>
            </div>
          )}
        />
      </section>

      <Dialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="תחנה חדשה"
        footer={
          <>
            <button className={ghostBtn} onClick={() => setShowAdd(false)} disabled={busy}>ביטול</button>
            <button className={primaryBtn} onClick={addStation} disabled={busy || !newStation.trim()}>
              {busy ? 'יוצר…' : 'צור תחנה'}
            </button>
          </>
        }
      >
        <Field label="שם התחנה (עברית)">
          <TextInput
            autoFocus
            value={newStation}
            onChange={(e) => setNewStation(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addStation(); }}
            placeholder="לדוגמה: קיר הגרפיטי המרכזי"
          />
        </Field>
      </Dialog>
    </div>
  );
}
