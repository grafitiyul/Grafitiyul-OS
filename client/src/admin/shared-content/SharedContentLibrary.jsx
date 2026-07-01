import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Dialog from '../common/Dialog.jsx';
import SharedContentEditorDialog from './SharedContentEditorDialog.jsx';
import { SHARED_CONTENT_TYPES, TYPE_LABEL, htmlPreview } from './sharedContentMeta.js';

// CRM Settings → Shared Content Library (Slice 4). The central management screen
// for reusable content. List + filter (type / location / active) + search,
// create/edit (bilingual rich content, image, optional location, location-default
// flag), and a Where-Used panel that lists every linked variant — the safety view
// before editing content shared across variants.

const CTRL =
  'h-9 rounded-lg border border-gray-300 bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function SharedContentLibrary() {
  const [rows, setRows] = useState(null);
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ type: '', locationId: '', active: 'active' });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // block | 'new' | null
  const [busy, setBusy] = useState(false);
  const [whereUsed, setWhereUsed] = useState(null); // block for the panel

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const params = {};
      if (filters.type) params.type = filters.type;
      if (filters.locationId) params.locationId = filters.locationId;
      if (filters.active === 'active') params.active = true;
      else if (filters.active === 'archived') params.active = false;
      setRows(await api.sharedContent.list(params));
    } catch (e) {
      setError(e.message);
      setRows([]);
    }
  }, [filters]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { api.locations.list().then(setLocations).catch(() => {}); }, []);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const visible = (rows || []).filter((r) => {
    if (!q.trim()) return true;
    const hay = `${r.internalName} ${htmlPreview(r.bodyHe)} ${htmlPreview(r.bodyEn)}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  async function submitEditor(data) {
    setBusy(true);
    try {
      if (editing && editing !== 'new') await api.sharedContent.update(editing.id, data);
      else await api.sharedContent.create(data);
      setEditing(null);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(block, active) {
    try {
      await api.sharedContent.update(block.id, { active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function remove(block) {
    if (!confirm(`למחוק לצמיתות את "${block.internalName}"?`)) return;
    try {
      await api.sharedContent.remove(block.id);
      await refresh();
    } catch (e) {
      if (e.payload?.error === 'has_references') {
        alert(`לא ניתן למחוק — התוכן בשימוש ב־${e.payload.count} וריאציות. יש לנתק אותן או להעביר לארכיון.`);
      } else {
        alert('שגיאה: ' + (e.payload?.error || e.message));
      }
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <header className="mb-6">
        <SettingsChrome />
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">ספריית תוכן משותף</h1>
            <p className="text-[15px] text-gray-500 mt-1.5">תוכן תפעולי לשימוש חוזר — נקודות מפגש/סיום ועוד — מקור אמת אחד, בהפניה.</p>
          </div>
          <button onClick={() => setEditing('new')} className="h-10 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
            + תוכן חדש
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filters.type} onChange={(e) => setF('type', e.target.value)} className={CTRL}>
          <option value="">כל הסוגים</option>
          {SHARED_CONTENT_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
        </select>
        <select value={filters.locationId} onChange={(e) => setF('locationId', e.target.value)} className={CTRL}>
          <option value="">כל המיקומים</option>
          {locations.map((l) => (<option key={l.id} value={l.id}>{l.nameHe}</option>))}
        </select>
        <select value={filters.active} onChange={(e) => setF('active', e.target.value)} className={CTRL}>
          <option value="active">פעיל</option>
          <option value="archived">בארכיון</option>
          <option value="all">הכל</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש…" className={`${CTRL} flex-1 min-w-[140px]`} />
      </div>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {rows === null ? (
          <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-red-600">שגיאה: {error}</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">אין פריטים. הוסיפו תוכן חדש.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((r) => (
              <li key={r.id} className="flex gap-3 px-3 py-3 hover:bg-gray-50">
                {r.image?.url && <img src={r.image.url} alt="" className="h-11 w-11 rounded object-cover border border-gray-200 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium text-gray-900 truncate">{r.internalName}</span>
                    <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{TYPE_LABEL[r.type] || r.type}</span>
                    {r.isLocationDefault && <span className="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">ברירת מחדל למיקום</span>}
                    {r.location && <span className="text-[11px] text-gray-400">· {r.location.nameHe}</span>}
                    {!r.active && <span className="text-[11px] text-amber-600">· בארכיון</span>}
                  </div>
                  <div className="text-[12px] text-gray-500 line-clamp-1 mt-0.5">{htmlPreview(r.bodyHe || r.bodyEn) || '(ללא תוכן)'}</div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <button onClick={() => setWhereUsed(r)} className="text-[12px] font-medium text-blue-700 hover:underline">
                      בשימוש ב־{r.usedByCount ?? 0} וריאציות
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 self-start">
                  <RowBtn onClick={() => setEditing(r)}>עריכה</RowBtn>
                  <RowBtn onClick={() => setActive(r, !r.active)}>{r.active ? 'ארכיון' : 'הפעלה'}</RowBtn>
                  <RowBtn danger onClick={() => remove(r)}>מחיקה</RowBtn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <SharedContentEditorDialog
          open
          onClose={() => { setEditing(null); refresh(); }}
          initial={editing === 'new' ? null : editing}
          locations={locations}
          usedByCount={editing !== 'new' ? editing.usedByCount || 0 : 0}
          showLocationDefault
          onSubmit={submitEditor}
          submitting={busy}
          onLinksChanged={refresh}
        />
      )}

      {whereUsed && <WhereUsedDialog block={whereUsed} onClose={() => setWhereUsed(null)} />}
    </div>
  );
}

function RowBtn({ children, onClick, danger }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-[12px] font-medium px-2 py-1 rounded hover:bg-gray-100 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:text-gray-900'}`}>
      {children}
    </button>
  );
}

// Where-Used panel — the safety view. Lists every linked variant (Product /
// Location / active status). "Variant" identity = its Product × Location.
function WhereUsedDialog({ block, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.sharedContent.whereUsed(block.id).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData({ count: 0, consumers: [] }); });
    return () => { alive = false; };
  }, [block.id]);

  const items = data?.consumers?.find((c) => c.kind === 'product_variant')?.items || [];

  return (
    <Dialog open onClose={onClose} title={`בשימוש — ${block.internalName}`} size="lg">
      {data === null ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <>
          <p className="text-[13px] text-gray-600 mb-3">
            תוכן זה בשימוש ב־<b>{data.count}</b> וריאציות. עריכת התוכן תשפיע על כל הטיוטות המקושרות (הצעות מחיר שהופקו נשארות קפואות).
          </p>
          {items.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">אין וריאציות מקושרות.</div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {items.map((it) => (
                <li key={it.productVariantId} className="flex items-center gap-2 px-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-gray-800 truncate">{it.productName || '(מוצר)'}</div>
                    <div className="text-[12px] text-gray-500 truncate">{it.locationName || '(מיקום)'}</div>
                  </div>
                  <span className={`text-[11px] font-medium shrink-0 ${it.active ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {it.active ? 'פעיל' : 'לא פעיל'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
