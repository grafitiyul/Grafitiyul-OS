import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';

// שעות שבת וחג — define WHEN a date/time counts as שבת / חג / ערב חג. Weekly
// recurring windows + an imported/manual holiday calendar with review/approval.
// NOT wired to pricing yet. Admin-only.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TYPE_LABEL = { erev_chag: 'ערב חג', chag: 'חג', other: 'אחר' };
const TYPE_OPTS = [
  { value: 'chag', name: 'חג' },
  { value: 'erev_chag', name: 'ערב חג' },
  { value: 'other', name: 'אחר' },
];

const minToTime = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
function timeToMin(s) {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.max(0, Math.min(1439, h * 60 + m));
}
const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');

function Field({ label, children }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}</label>;
}
function Select({ value, onChange, options, className = '' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${className}`}>
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.name}</option>)}
    </select>
  );
}

export default function SabbathHoursSettings() {
  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto space-y-6">
      <header>
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">שעות שבת וחג</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הגדרת חלונות הזמן שמגדירים מתי תאריך/שעה נחשבים שבת / חג / ערב חג. בהמשך, תוספת שבת/חג בכרטיסי התמחור תחול אוטומטית לפי ההגדרות כאן.
        </p>
      </header>
      <WeeklyRulesCard />
      <HolidayCalendarCard />
      <MarkersSection />
    </div>
  );
}

// ─────────────────────────────── Weekly rules ──────────────────────────────

function WeeklyRulesCard() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRules(await api.sabbathHours.listWeekly()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function reorder(ids) {
    try { await api.sabbathHours.reorderWeekly(ids); } catch { refresh(); }
  }

  return (
    <SettingsCard
      title="חלונות שבועיים"
      description='חלונות חוזרים, למשל "שישי מ-15:00" או "שבת — כל היום". גררו לשינוי הסדר.'
      footer={adding ? null : (
        <button onClick={() => setAdding(true)} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700">+ חלון חדש</button>
      )}
    >
      {adding && <WeeklyForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <ReorderableList
          items={rules}
          onReorder={reorder}
          emptyText="עדיין אין חלונות. הוסיפו את הראשון למטה."
          renderRow={(r, { handle }) =>
            editingId === r.id ? (
              <WeeklyForm rule={r} onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); refresh(); }} />
            ) : (
              <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
                {handle}
                <div className="flex-1 min-w-0">
                  <span className={`font-medium text-[15px] ${r.active ? 'text-gray-900' : 'text-gray-400'}`}>{r.nameHe}</span>
                  <div className="text-[12px] text-gray-500 mt-0.5">
                    {DAYS[r.dayOfWeek]} · {r.allDay ? 'כל היום' : `${minToTime(r.startMinute) || '00:00'}–${minToTime(r.endMinute) || 'סוף היום'}`}
                  </div>
                </div>
                {!r.active && <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעיל</span>}
                <button onClick={() => setEditingId(r.id)} className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                <button onClick={async () => { if (confirm('למחוק חלון זה?')) { await api.sabbathHours.removeWeekly(r.id); refresh(); } }}
                  className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
              </div>
            )
          }
        />
      )}
    </SettingsCard>
  );
}

function WeeklyForm({ rule, onClose, onSaved }) {
  const [d, setD] = useState({
    nameHe: rule?.nameHe || '', nameEn: rule?.nameEn || '',
    dayOfWeek: rule?.dayOfWeek ?? 6,
    allDay: rule?.allDay ?? false,
    startTime: minToTime(rule?.startMinute), endTime: minToTime(rule?.endMinute),
    active: rule?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!d.nameHe.trim()) return;
    setBusy(true);
    try {
      const payload = {
        nameHe: d.nameHe.trim(), nameEn: d.nameEn.trim() || null,
        dayOfWeek: Number(d.dayOfWeek), allDay: d.allDay,
        startMinute: d.allDay ? null : timeToMin(d.startTime),
        endMinute: d.allDay ? null : timeToMin(d.endTime),
        active: d.active,
      };
      if (rule) await api.sabbathHours.updateWeekly(rule.id, payload);
      else await api.sabbathHours.createWeekly(payload);
      onSaved();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="שם"><input value={d.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} /></Field>
      <Field label="יום"><Select value={String(d.dayOfWeek)} onChange={(v) => set('dayOfWeek', v)} options={DAYS.map((n, i) => ({ value: i, name: n }))} /></Field>
      {!d.allDay && <Field label="משעה"><input dir="ltr" type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} className={INPUT} /></Field>}
      {!d.allDay && <Field label="עד שעה"><input dir="ltr" type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} className={INPUT} /></Field>}
      <label className="flex items-center gap-2 mt-6 text-sm text-gray-700"><input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} /> כל היום</label>
      <label className="flex items-center gap-2 mt-6 text-sm text-gray-700"><input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} /> פעיל</label>
      <div className="col-span-2 sm:col-span-4 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}

// ───────────────────────────── Holiday calendar ────────────────────────────

const STATUS_STYLE = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  pending: 'bg-amber-50 text-amber-700 ring-amber-100',
  ignored: 'bg-gray-100 text-gray-400 ring-gray-200',
};
const STATUS_LABEL = { approved: '✓ מאושר', pending: 'ממתין לאישור', ignored: 'מושבת' };

function HolidayCalendarCard() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [months, setMonths] = useState(12);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [addingManual, setAddingManual] = useState(false);

  // `silent` re-fetches without blanking the list to "טוען…" (avoids a jump).
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setHolidays(await api.sabbathHours.listHolidays(filter || undefined)); }
    finally { if (!silent) setLoading(false); }
  }, [filter]);
  useEffect(() => { refresh(); }, [refresh]);

  // Patch one row in place — keeps its position and does NOT drop it from a
  // filtered view on a status change (the row stays until the user re-filters).
  const patchRow = (updated) => setHolidays((cur) => cur.map((h) => (h.id === updated.id ? updated : h)));
  const dropRow = (id) => setHolidays((cur) => cur.filter((h) => h.id !== id));

  async function runImport() {
    setImporting(true);
    try {
      const r = await api.sabbathHours.importHolidays(Number(months) || 12);
      alert(`ייבוא הושלם: ${r.created} חדשים, ${r.refreshed} עודכנו, ${r.locked} מוגנים${r.markersUpserted ? ` · ${r.markersUpserted} סמני חול המועד` : ''}.`);
      await refresh();
    } catch (e) {
      const code = e.payload?.error;
      alert(code === 'hebcal_unreachable' ? 'מקור החגים (Hebcal) אינו זמין כרגע. לא בוצע שינוי.' : 'שגיאת ייבוא: ' + (code || e.message));
    } finally { setImporting(false); }
  }

  async function review(id, action) {
    try { patchRow(await api.sabbathHours.reviewHoliday(id, action)); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  const pendingCount = holidays.filter((h) => h.status === 'pending').length;

  return (
    <SettingsCard
      title="לוח חגים"
      description="ייבוא חגים עתידיים מ-Hebcal לבדיקה ואישור. חגים מאושרים בלבד ישפיעו על התמחור בהמשך. ייבוא חוזר לא ידרוס שורות שאושרו או נערכו ידנית."
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12px] text-gray-500">חודשים קדימה
            <input dir="ltr" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} className="h-9 w-16 ms-1 rounded-lg border border-gray-300 px-2 text-center text-sm" />
          </label>
          <button onClick={runImport} disabled={importing} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {importing ? 'מייבא…' : 'ייבא חגים'}
          </button>
          <button onClick={() => setAddingManual(true)} className="h-9 rounded-lg border border-gray-300 px-4 text-sm text-gray-600 hover:bg-gray-50">+ יום מיוחד ידני</button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <span className="text-[12px] text-gray-500">סינון:</span>
        {[
          { v: '', n: `הכל (${holidays.length})` },
          { v: 'pending', n: `ממתינים${!filter && pendingCount ? ` (${pendingCount})` : ''}` },
          { v: 'approved', n: 'מאושרים' },
          { v: 'ignored', n: 'מושבתים' },
        ].map((o) => (
          <button key={o.v} onClick={() => setFilter(o.v)}
            className={`h-8 rounded-full px-3 text-[12px] ${filter === o.v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {o.n}
          </button>
        ))}
      </div>

      {addingManual && <HolidayForm onClose={() => setAddingManual(false)} onSaved={() => { setAddingManual(false); refresh(true); }} />}

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : holidays.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">אין חגים להצגה. לחצו "ייבא חגים".</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {holidays.map((h) =>
            editingId === h.id ? (
              <li key={h.id} className="py-2"><HolidayForm holiday={h} onClose={() => setEditingId(null)} onSaved={(saved) => { setEditingId(null); if (saved) patchRow(saved); }} /></li>
            ) : (
              <li key={h.id} className={`flex items-center gap-3 px-2 py-2.5 min-h-[3.25rem] ${h.status === 'ignored' ? 'opacity-60' : ''}`}>
                <div className="w-24 shrink-0 text-[13px] text-gray-500" dir="ltr">{dateOnly(h.date)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[14px] ${h.status === 'ignored' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{h.nameHe}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {TYPE_LABEL[h.type] || h.type} · {h.allDay ? 'כל היום' : `${minToTime(h.startMinute) || ''}${h.endMinute != null ? '–' + minToTime(h.endMinute) : ''}`}
                    {h.source === 'manual' && ' · ידני'}
                    {h.manuallyEdited && ' · נערך'}
                    {h.reviewedBy === 'system' && ' · אוטומטי'}
                  </div>
                </div>
                {/* Fixed-width badge so different status labels don't reflow the row */}
                <span className={`shrink-0 w-28 text-center whitespace-nowrap text-[11px] rounded-full px-2 py-0.5 ring-1 ${STATUS_STYLE[h.status] || ''}`}>{STATUS_LABEL[h.status] || h.status}</span>
                {/* Fixed-width action cluster (always 5 buttons) so the row never reflows */}
                <div className="flex items-center justify-end gap-1 shrink-0 w-[150px]">
                  <button onClick={() => review(h.id, 'mark_chag')} title="סמן כיום חג"
                    className={`rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 ${h.status === 'approved' && h.type === 'chag' ? 'bg-emerald-100' : ''}`}>✓</button>
                  <button onClick={() => review(h.id, 'mark_erev')} title="סמן כערב חג"
                    className={`rounded-md p-1.5 text-amber-600 hover:bg-amber-50 ${h.status === 'approved' && h.type === 'erev_chag' ? 'bg-amber-100' : ''}`}>🌙</button>
                  {h.status !== 'ignored'
                    ? <button onClick={() => review(h.id, 'ignore')} title="התעלם" className="text-gray-500 hover:bg-gray-100 rounded-md p-1.5">⊘</button>
                    : <button onClick={() => review(h.id, 'pending')} title="החזר" className="text-blue-600 hover:bg-blue-50 rounded-md p-1.5">↺</button>}
                  <button onClick={() => setEditingId(h.id)} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                  <button onClick={async () => { if (confirm('למחוק שורה זו?')) { await api.sabbathHours.removeHoliday(h.id); dropRow(h.id); } }} title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </SettingsCard>
  );
}

function HolidayForm({ holiday, onClose, onSaved }) {
  const [d, setD] = useState({
    nameHe: holiday?.nameHe || '', nameEn: holiday?.nameEn || '',
    date: dateOnly(holiday?.date), type: holiday?.type || 'chag',
    allDay: holiday?.allDay ?? true,
    startTime: minToTime(holiday?.startMinute), endTime: minToTime(holiday?.endMinute),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!d.nameHe.trim() || !d.date) return;
    setBusy(true);
    try {
      const payload = {
        nameHe: d.nameHe.trim(), nameEn: d.nameEn.trim() || null,
        date: d.date, type: d.type, allDay: d.allDay,
        startMinute: d.allDay ? null : timeToMin(d.startTime),
        endMinute: d.allDay ? null : timeToMin(d.endTime),
      };
      const saved = holiday
        ? await api.sabbathHours.updateHoliday(holiday.id, payload)
        : await api.sabbathHours.createHoliday(payload);
      onSaved(saved);
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 p-3 m-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="שם"><input value={d.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} /></Field>
      <Field label="תאריך"><input dir="ltr" type="date" value={d.date} onChange={(e) => set('date', e.target.value)} className={INPUT} /></Field>
      <Field label="סוג"><Select value={d.type} onChange={(v) => set('type', v)} options={TYPE_OPTS} /></Field>
      <label className="flex items-center gap-2 mt-6 text-sm text-gray-700"><input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} /> כל היום</label>
      {!d.allDay && <Field label="משעה"><input dir="ltr" type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} className={INPUT} /></Field>}
      {!d.allDay && <Field label="עד שעה"><input dir="ltr" type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} className={INPUT} /></Field>}
      <div className="col-span-2 sm:col-span-4 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}

// ─────────────────────── Calendar Markers (operational) ────────────────────
// A SEPARATE dimension from the pricing classification above — these never
// affect pricing; they are for planning / Gantt / calendar display later.

function MarkersSection() {
  const [types, setTypes] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([api.sabbathHours.listMarkerTypes(), api.sabbathHours.listMarkers()]);
      setTypes(t); setMarkers(m);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SettingsCard
      title="סמני לוח (תפעולי — לא משפיע על תמחור)"
      description="סימונים אינפורמטיביים על תאריכים (חול המועד, חופשות, יום בחירות, אירועים עירוניים…). מיועדים לתצוגת לוח/גאנט עתידית בלבד — אינם משנים מחיר ואינם חג/ערב חג."
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <div className="space-y-4 p-1">
          <MarkerTypes types={types} onChanged={refresh} />
          <MarkerList markers={markers} types={types} onChanged={refresh} />
        </div>
      )}
    </SettingsCard>
  );
}

function MarkerTypes({ types, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [nameHe, setNameHe] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try { await api.sabbathHours.createMarkerType({ nameHe: nameHe.trim() }); setNameHe(''); setAdding(false); await onChanged(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }
  async function toggle(t) {
    try { await api.sabbathHours.updateMarkerType(t.id, { active: !t.active }); onChanged(); }
    catch (e) { alert('שגיאה: ' + e.message); }
  }
  async function remove(t) {
    if (!confirm(`למחוק את סוג הסמן "${t.nameHe}"? כל הסמנים מסוג זה יימחקו.`)) return;
    try { await api.sabbathHours.removeMarkerType(t.id); onChanged(); }
    catch (e) { alert(e.payload?.error === 'system_marker_type' ? 'לא ניתן למחוק סוג מערכת (חול המועד).' : 'שגיאה: ' + e.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[13px] font-semibold text-gray-700">סוגי סמנים</h4>
        {!adding && <button onClick={() => setAdding(true)} className="text-[12px] text-blue-600 hover:underline">+ סוג חדש</button>}
      </div>
      {adding && (
        <form onSubmit={add} className="flex gap-2 mb-2">
          <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם סוג סמן" className={`flex-1 ${INPUT}`} />
          <button type="submit" disabled={busy || !nameHe.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">הוסף</button>
          <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600">ביטול</button>
        </form>
      )}
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <span key={t.id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-gray-200 ${t.active ? 'bg-white text-gray-700' : 'bg-gray-100 text-gray-400'}`}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color || '#9ca3af' }} />
            {t.nameHe}
            <button onClick={() => toggle(t)} title={t.active ? 'כבה' : 'הפעל'} className="text-gray-400 hover:text-gray-700">{t.active ? '◉' : '○'}</button>
            {t.source !== 'system' && <button onClick={() => remove(t)} title="מחק" className="text-red-400 hover:text-red-600">✕</button>}
          </span>
        ))}
      </div>
    </div>
  );
}

function MarkerList({ markers, types, onChanged }) {
  const [adding, setAdding] = useState(false);
  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));

  async function remove(m) {
    if (!confirm('למחוק סמן זה?')) return;
    try { await api.sabbathHours.removeMarker(m.id); onChanged(); }
    catch (e) { alert('שגיאה: ' + e.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[13px] font-semibold text-gray-700">סמנים על תאריכים</h4>
        {!adding && <button onClick={() => setAdding(true)} className="text-[12px] text-blue-600 hover:underline">+ סמן ידני</button>}
      </div>
      {adding && <MarkerForm types={types} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
      {markers.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-3">אין סמנים. הוסיפו ידנית או ייבאו חגים (חול המועד נוצר אוטומטית).</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {markers.map((m) => {
            const t = m.markerType || typeById[m.markerTypeId];
            const range = dateOnly(m.startDate) === dateOnly(m.endDate) ? dateOnly(m.startDate) : `${dateOnly(m.startDate)} – ${dateOnly(m.endDate)}`;
            return (
              <li key={m.id} className="flex items-center gap-3 px-1 py-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t?.color || '#9ca3af' }} />
                <span className="w-44 shrink-0 text-[13px] text-gray-500" dir="ltr">{range}</span>
                <div className="flex-1 min-w-0 text-[14px] text-gray-900 truncate">{m.nameHe || t?.nameHe || 'סמן'}</div>
                <span className="text-[11px] text-gray-400 shrink-0">{t?.nameHe}{m.source === 'imported' ? ' · יובא' : ''}</span>
                <button onClick={() => remove(m)} title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1.5 shrink-0">🗑</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MarkerForm({ types, onClose, onSaved }) {
  const active = types.filter((t) => t.active);
  const [d, setD] = useState({ markerTypeId: active[0]?.id || '', startDate: '', endDate: '', nameHe: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!d.markerTypeId || !d.startDate) return;
    setBusy(true);
    try {
      await api.sabbathHours.createMarker({
        markerTypeId: d.markerTypeId, startDate: d.startDate, endDate: d.endDate || d.startDate,
        nameHe: d.nameHe.trim() || null, note: d.note.trim() || null,
      });
      onSaved();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 p-3 mb-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="סוג"><Select value={d.markerTypeId} onChange={(v) => set('markerTypeId', v)} options={active.map((t) => ({ value: t.id, name: t.nameHe }))} /></Field>
      <Field label="מתאריך"><input dir="ltr" type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} className={INPUT} /></Field>
      <Field label="עד תאריך (אופציונלי)"><input dir="ltr" type="date" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} className={INPUT} /></Field>
      <Field label="כותרת (אופציונלי)"><input value={d.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} /></Field>
      <div className="col-span-2 sm:col-span-4 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}
