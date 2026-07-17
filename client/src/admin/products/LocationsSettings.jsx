import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { SingleImage } from './ImageUploader.jsx';
import { HomeIcon } from '../common/FieldIcons.jsx';
import LocationDefaultsDialog from './LocationDefaultsDialog.jsx';

// Locations catalog (e.g. "תל אביב - פלורנטין"). Hebrew name required, English
// optional. A location can't be deleted while product variants reference it.
//
// Hierarchy (ONE level): a location may belong to a parent "עיר לתצוגה" —
// external users (agent form) see the parent city; GOS keeps working with the
// operational child. The list renders the hierarchy (children indented with ↳
// under their parent); validation (no self/cycles/deep nesting) is
// server-enforced and mirrored here.
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

  // Hierarchical render order: roots/standalone in catalog order, each parent's
  // children indented directly beneath it.
  const ordered = useMemo(() => {
    const children = new Map();
    for (const r of rows) {
      if (!r.parentLocationId) continue;
      if (!children.has(r.parentLocationId)) children.set(r.parentLocationId, []);
      children.get(r.parentLocationId).push(r);
    }
    const out = [];
    for (const r of rows) {
      if (r.parentLocationId && rows.some((p) => p.id === r.parentLocationId)) continue;
      out.push({ row: r, depth: 0 });
      for (const c of children.get(r.id) || []) out.push({ row: c, depth: 1 });
    }
    return out;
  }, [rows]);

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
        <SettingsChrome />
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
              {ordered.map(({ row, depth }) => (
                <LocationRow key={row.id} row={row} depth={depth} locations={rows} onChange={refresh} />
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

// Server error codes → owner-readable explanations for hierarchy mistakes.
const PARENT_ERRORS = {
  self_parent: 'מיקום לא יכול להיות מיקום האב של עצמו.',
  parent_not_found: 'מיקום האב שנבחר לא נמצא.',
  parent_not_root: 'מיקום האב שנבחר כבר שייך לעיר אחרת — היררכיה היא ברמה אחת בלבד.',
  has_children: 'למיקום הזה משויכים מיקומי בן — לא ניתן לשייך אותו בעצמו לעיר.',
};

function LocationRow({ row, depth = 0, locations, onChange }) {
  const [editing, setEditing] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  const [nameHe, setNameHe] = useState(row.nameHe);
  const [nameEn, setNameEn] = useState(row.nameEn || '');
  const [parentId, setParentId] = useState(row.parentLocationId || '');
  const [meetingHe, setMeetingHe] = useState(row.meetingPointHe || '');
  const [meetingEn, setMeetingEn] = useState(row.meetingPointEn || '');
  const [marketingHe, setMarketingHe] = useState(row.marketingDescHe || '');
  const [marketingEn, setMarketingEn] = useState(row.marketingDescEn || '');
  const [image, setImage] = useState(row.meetingPointImage || null);
  const [busy, setBusy] = useState(false);

  const hasChildren = (row._count?.childLocations ?? 0) > 0;
  // Valid parents (mirrors the server rules): another location, itself a root.
  const parentOptions = locations.filter((l) => l.id !== row.id && !l.parentLocationId);

  // Seed all edit fields from the current row each time edit mode opens, so the
  // form always reflects the latest saved values (no stale state on re-edit).
  function startEdit() {
    setNameHe(row.nameHe);
    setNameEn(row.nameEn || '');
    setParentId(row.parentLocationId || '');
    setMeetingHe(row.meetingPointHe || '');
    setMeetingEn(row.meetingPointEn || '');
    setMarketingHe(row.marketingDescHe || '');
    setMarketingEn(row.marketingDescEn || '');
    setImage(row.meetingPointImage || null);
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.locations.update(row.id, {
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim() || null,
        parentLocationId: parentId || null,
        meetingPointHe: meetingHe || null,
        meetingPointEn: meetingEn || null,
        marketingDescHe: marketingHe || null,
        marketingDescEn: marketingEn || null,
        meetingPointImageId: image?.id || null,
      });
      setEditing(false);
      await onChange();
    } catch (e) {
      alert(PARENT_ERRORS[e.payload?.error] || 'שגיאה: ' + (e.payload?.error || e.message));
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
  // Toggle the single Home Location. Setting one unsets the previous (server-side).
  async function toggleHome() {
    try {
      await api.locations.update(row.id, { isHomeLocation: !row.isHomeLocation });
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  // Edit mode (opened by the pencil). Everything — name + meeting-point text
  // (He/En rich) + R2 image — lives in this one form and saves together. Only
  // "שמור"/"ביטול" close it, so clicking inside the editors never loses edits.
  if (editing) {
    return (
      <li className="py-3">
        <form
          onSubmit={save}
          dir="rtl"
          className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input autoFocus value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם בעברית"
              className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 px-3 text-sm bg-white" />
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" placeholder="Name (EN)"
              className="flex-1 min-w-[7rem] sm:max-w-[12rem] h-10 rounded-lg border border-gray-300 px-3 text-sm bg-white" />
          </div>

          {/* מיקום אב / עיר לתצוגה — one-level hierarchy for external display. */}
          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">מיקום אב / עיר לתצוגה</label>
            {hasChildren ? (
              <p className="text-[12px] text-gray-500">
                למיקום הזה משויכים מיקומי בן — הוא משמש כעיר לתצוגה ולא ניתן לשייך אותו בעצמו לעיר אחרת.
              </p>
            ) : (
              <>
                <ParentPicker options={parentOptions} value={parentId} onChange={setParentId} />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  אם המיקום שייך לעיר רחבה יותר, הסוכן יראה את מיקום האב. לדוגמה: ״תל אביב - פלורנטין״ יכול להשתייך ל״תל אביב״.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">נקודת מפגש (עברית)</label>
            <RichEditor value={meetingHe} onChange={setMeetingHe} ariaLabel="נקודת מפגש בעברית" placeholder="תיאור נקודת המפגש…" minContentHeight={90} />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">נקודת מפגש (אנגלית)</label>
            <RichEditor value={meetingEn} onChange={setMeetingEn} ariaLabel="Meeting point (EN)" placeholder="Meeting point description…" minContentHeight={90} />
            <p className="text-[11px] text-gray-400 mt-1.5">לפסקה באנגלית השתמשו בכפתור כיוון LTR שבסרגל העריכה.</p>
          </div>

          {/* City marketing content — bilingual rich HTML, consumed by the quote
              composer's city_content block. He/En parity. */}
          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">תוכן שיווקי לעיר (עברית)</label>
            <RichEditor value={marketingHe} onChange={setMarketingHe} ariaLabel="תוכן שיווקי לעיר בעברית" placeholder="תוכן שיווקי שיופיע בהצעות מחיר…" minContentHeight={120} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">City marketing content (EN)</label>
            <RichEditor value={marketingEn} onChange={setMarketingEn} ariaLabel="City marketing content (EN)" placeholder="Marketing content for quotes…" minContentHeight={120} />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">תמונת נקודת מפגש</label>
            <SingleImage image={image} onChange={setImage} folder="locations/meeting" />
            <p className="text-[11px] text-gray-400 mt-1.5">מועלה ישירות ל-Cloudflare R2.</p>
          </div>

          <div className="flex gap-1.5">
            <button type="submit" disabled={busy || !nameHe.trim()} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 bg-white">ביטול</button>
          </div>
        </form>
      </li>
    );
  }

  const hasMeeting = !!(row.meetingPointHe || row.meetingPointEn || row.meetingPointImageId);

  return (
    <li className={`group flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-gray-50 ${depth ? 'ps-9' : ''}`}>
      {depth > 0 && <span className="text-gray-300" aria-hidden>↳</span>}
      <span className="font-medium text-gray-900 text-[15px]">{row.nameHe}</span>
      {hasChildren && (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700" title="עיר לתצוגה — מיקומי בן מוצגים תחתיה בטופס הסוכנים">
          עיר לתצוגה · {row._count.childLocations}
        </span>
      )}
      {row.isHomeLocation && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600" title="מיקום הבית">
          <HomeIcon className="w-3.5 h-3.5 text-emerald-600" /> בית
        </span>
      )}
      {row.nameEn && <span className="text-[12px] text-gray-400" dir="ltr">{row.nameEn}</span>}
      <span className="text-[11px] text-gray-500">· {row._count?.variants ?? 0} וריאציות</span>
      {hasMeeting && <span className="text-[11px] text-emerald-600" title="נקודת מפגש מוגדרת">📍</span>}
      <div className="flex-1" />
      <button onClick={toggleHome} title={row.isHomeLocation ? 'בטל מיקום בית' : 'סמן כמיקום הבית'}
        className={`rounded-md p-1.5 ${row.isHomeLocation ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
        <HomeIcon className="w-4 h-4" />
      </button>
      <button onClick={() => setShowDefaults(true)} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md p-1.5" title="ברירות מחדל לתוכן משותף">🧩</button>
      <button onClick={startEdit} className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5" title="עריכה">✎</button>
      <button onClick={remove} className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5" title="מחק">🗑</button>
      {showDefaults && (
        <LocationDefaultsDialog location={row} locations={locations} onClose={() => setShowDefaults(false)} onChanged={onChange} />
      )}
    </li>
  );
}

// Searchable single-select for the parent location — type to filter, clearable.
// Options are pre-filtered to VALID parents (roots, not self); the server
// re-validates regardless.
function ParentPicker({ options, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) =>
        (o.nameHe || '').toLowerCase().includes(q) || (o.nameEn || '').toLowerCase().includes(q))
    : options;

  return (
    <div className="relative max-w-sm">
      <span className="relative block">
        <input
          value={open ? query : selected?.nameHe || ''}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="— ללא (מיקום עצמאי) — הקלידו לחיפוש"
          autoComplete="off"
          className={'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400' + (selected ? ' pe-8' : '')}
        />
        {selected && !open && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="נקה מיקום אב"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </span>
      {open && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-44 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-gray-400">לא נמצאו מיקומים תואמים.</li>
          ) : (
            filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(o.id); setOpen(false); }}
                  className={`block w-full text-right px-3 py-2 text-sm hover:bg-blue-50 ${o.id === value ? 'bg-blue-50 font-medium' : ''}`}
                >
                  {o.nameHe}
                  {o.nameEn && <span className="text-[11px] text-gray-400" dir="ltr"> · {o.nameEn}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
