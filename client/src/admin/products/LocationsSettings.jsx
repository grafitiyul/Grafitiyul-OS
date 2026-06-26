import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import RichEditor from '../../editor/RichEditor.jsx';
import { SingleImage } from './ImageUploader.jsx';

// Locations catalog (e.g. "תל אביב - פלורנטין"). Hebrew name required, English
// optional. A location can't be deleted while product variants reference it.
export default function LocationsSettings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.locations.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.locations.create({ nameHe: nameHe.trim(), nameEn: nameEn.trim() || null });
      setNameHe(''); setNameEn('');
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <Link to="/admin/settings/crm" className="text-[13px] text-blue-700 hover:underline">← הגדרות CRM</Link>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">מיקומים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">קטלוג המיקומים (עיר / אזור). משמש ליצירת וריאציות מוצר.</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-2 sm:p-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600">שגיאה: {error}</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-gray-400">עדיין אין מיקומים. הוסיפו את הראשון למטה.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <LocationRow key={row.id} row={row} onChange={refresh} />
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 sm:px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
            <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם בעברית"
              className="flex-1 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Name (EN) — אופציונלי" dir="ltr"
              className="sm:w-52 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
            <button type="submit" disabled={busy || !nameHe.trim()}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'מוסיף…' : 'הוסף מיקום'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function LocationRow({ row, onChange }) {
  const [editing, setEditing] = useState(false);
  const [meeting, setMeeting] = useState(false);
  const [nameHe, setNameHe] = useState(row.nameHe);
  const [nameEn, setNameEn] = useState(row.nameEn || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.locations.update(row.id, { nameHe: nameHe.trim(), nameEn: nameEn.trim() || null });
      setEditing(false);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`למחוק את "${row.nameHe}"?`)) return;
    try {
      await api.locations.remove(row.id);
      await onChange();
    } catch (e) {
      if (e.payload?.error === 'location_in_use')
        alert('לא ניתן למחוק מיקום שמשויכות אליו וריאציות מוצר.');
      else alert('שגיאה: ' + e.message);
    }
  }

  if (editing) {
    return (
      <li className="py-2">
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 px-1">
          <input autoFocus value={nameHe} onChange={(e) => setNameHe(e.target.value)}
            className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 px-3 text-sm" />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" placeholder="Name (EN)"
            className="flex-1 min-w-[7rem] sm:max-w-[12rem] h-10 rounded-lg border border-gray-300 px-3 text-sm" />
          <div className="flex gap-1.5 shrink-0 ms-auto">
            <button type="submit" disabled={busy || !nameHe.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
          </div>
        </form>
      </li>
    );
  }

  const hasMeeting = !!(row.meetingPointHe || row.meetingPointEn || row.meetingPointImageId);

  return (
    <li className="group rounded-lg hover:bg-gray-50">
      <div className="flex items-center gap-3 px-2.5 py-2.5">
        <span className="font-medium text-gray-900 text-[15px]">{row.nameHe}</span>
        {row.nameEn && <span className="text-[12px] text-gray-400" dir="ltr">{row.nameEn}</span>}
        <span className="text-[11px] text-gray-500">· {row._count?.variants ?? 0} וריאציות</span>
        {hasMeeting && <span className="text-[11px] text-emerald-600" title="נקודת מפגש מוגדרת">📍</span>}
        <div className="flex-1" />
        <button
          onClick={() => setMeeting((v) => !v)}
          className={`rounded-md px-2 py-1 text-[12px] font-medium ${meeting ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-blue-700 hover:bg-blue-50'}`}
          title="נקודת מפגש"
        >
          נקודת מפגש
        </button>
        <button onClick={() => setEditing(true)} className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5" title="עריכה">✎</button>
        <button onClick={remove} className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5" title="מחק">🗑</button>
      </div>
      {meeting && <MeetingPointPanel row={row} onSaved={onChange} />}
    </li>
  );
}

// Expandable per-location editor for meeting-point text (rich He/En) + a single
// R2-hosted image. Saves through the same locations PUT endpoint; the image goes
// through the shared R2 presigned-upload flow (SingleImage → uploadImage).
function MeetingPointPanel({ row, onSaved }) {
  const [he, setHe] = useState(row.meetingPointHe || '');
  const [en, setEn] = useState(row.meetingPointEn || '');
  const [image, setImage] = useState(row.meetingPointImage || null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await api.locations.update(row.id, {
        meetingPointHe: he || null,
        meetingPointEn: en || null,
        meetingPointImageId: image?.id || null,
      });
      setSaved(true);
      await onSaved();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-2.5 mb-3 rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-gray-700 mb-1.5">נקודת מפגש (עברית)</label>
        <RichEditor value={he} onChange={setHe} ariaLabel="נקודת מפגש בעברית" placeholder="תיאור נקודת המפגש…" minContentHeight={90} />
      </div>
      <div dir="ltr">
        <label className="block text-[13px] font-medium text-gray-700 mb-1.5 text-right" dir="rtl">נקודת מפגש (אנגלית)</label>
        <RichEditor value={en} onChange={setEn} ariaLabel="Meeting point (EN)" placeholder="Meeting point description…" minContentHeight={90} />
      </div>
      <div>
        <label className="block text-[13px] font-medium text-gray-700 mb-1.5">תמונת נקודת מפגש</label>
        <SingleImage image={image} onChange={setImage} folder="locations/meeting" />
        <p className="text-[11px] text-gray-400 mt-1.5">מועלה ישירות ל-Cloudflare R2. דורש הגדרת R2 בשרת.</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור נקודת מפגש'}
        </button>
        {saved && <span className="text-[13px] text-emerald-600">נשמר ✓</span>}
      </div>
    </div>
  );
}
