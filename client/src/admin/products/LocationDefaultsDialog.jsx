import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import SharedContentEditorDialog from '../shared-content/SharedContentEditorDialog.jsx';
import { TYPE_LABEL, htmlPreview } from '../shared-content/sharedContentMeta.js';

// Location Defaults manager. A Location default is the source of truth for a type
// (meeting / ending point); a variant link is an override. Here you choose an
// existing Shared Content item or create a new one as the location's default, and
// run the safe consolidation ("make this the location default" — removes redundant
// variant overrides that point at the same item, leaves different ones untouched).

const TYPES = ['meeting_point', 'ending_point'];

export default function LocationDefaultsDialog({ location, locations = [], onClose, onChanged }) {
  const [defaults, setDefaults] = useState(null);
  const [suggs, setSuggs] = useState({ meeting_point: [], ending_point: [] });
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(null); // type to pick for
  const [editor, setEditor] = useState(null); // { type, block } — block=null → create new
  const [report, setReport] = useState(null);

  const reload = useCallback(async () => {
    const [d, sm, se] = await Promise.all([
      api.locations.sharedDefaults(location.id),
      api.locations.consolidationSuggestions(location.id, 'meeting_point'),
      api.locations.consolidationSuggestions(location.id, 'ending_point'),
    ]);
    setDefaults(d);
    setSuggs({ meeting_point: sm.suggestions || [], ending_point: se.suggestions || [] });
  }, [location.id]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn) {
    setBusy(true);
    try { await fn(); await reload(); onChanged?.(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  const setDefault = (type, scId) => run(() => api.locations.setSharedDefault(location.id, type, scId));

  async function consolidate(type, scId, name) {
    if (!confirm(`להפוך את "${name}" לברירת המחדל של המיקום ל${TYPE_LABEL[type]}? קישורי וריאציות מיותרים שמצביעים על אותו תוכן יוסרו (וריאציות עם תוכן אחר לא ישתנו).`)) return;
    setBusy(true);
    try {
      const rep = await api.locations.consolidate(location.id, type, scId);
      await reload();
      onChanged?.();
      setReport(rep);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  // Save the editor. Editing updates the SAME SharedContent record (no copy) so
  // every inherited variant reflects it immediately by reference. Creating makes a
  // new item and sets it as this location's default.
  async function submitEditor(data) {
    const { type, block } = editor;
    setBusy(true);
    try {
      if (block) {
        await api.sharedContent.update(block.id, data);
      } else {
        const b = await api.sharedContent.create({ ...data, type });
        await api.locations.setSharedDefault(location.id, type, b.id);
      }
      await reload();
      onChanged?.();
      setEditor(null);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`ברירות מחדל לתוכן — ${location.nameHe}`} size="lg">
      {defaults === null ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] text-gray-500">
            ברירת המחדל של המיקום היא מקור האמת. וריאציה יכולה לעקוף אותה עם תוכן משלה.
          </p>
          {TYPES.map((type) => (
            <TypeSection
              key={type}
              type={type}
              current={defaults[type]}
              suggestions={suggs[type]}
              busy={busy}
              onEdit={() => setEditor({ type, block: defaults[type] })}
              onChoose={() => setPicker(type)}
              onCreate={() => setEditor({ type, block: null })}
              onClear={() => setDefault(type, null)}
              onConsolidate={(s) => consolidate(type, s.sharedContentId, s.internalName)}
            />
          ))}
        </div>
      )}

      {picker && (
        <DefaultPicker
          type={picker}
          currentId={defaults?.[picker]?.id || null}
          onClose={() => setPicker(null)}
          onPick={(id) => { setPicker(null); setDefault(picker, id); }}
        />
      )}

      {editor && (
        <SharedContentEditorDialog
          open
          onClose={() => setEditor(null)}
          fixedType={editor.type}
          initial={editor.block}
          locations={locations}
          usedByCount={editor.block?.usedByCount || 0}
          onSubmit={submitEditor}
          submitting={busy}
          onLinksChanged={reload}
        />
      )}

      {report && (
        <Dialog open onClose={() => setReport(null)} title="דוח איחוד" size="md">
          <div className="space-y-2 text-[13px] text-gray-700">
            <p>
              ברירת המחדל עודכנה. הוסרו <b>{report.removedCount}</b> קישורי וריאציות מיותרים.
            </p>
            {report.removed?.length > 0 && (
              <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
                {report.removed.map((r) => (
                  <li key={r.productVariantId} className="px-2 py-1.5 text-[12px] text-gray-600">
                    {r.productName || '(מוצר)'} <span className="text-gray-400">· {r.locationName || '(מיקום)'}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-1">
              <button onClick={() => setReport(null)} className="h-9 px-4 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700">סגירה</button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}

function TypeSection({ type, current, suggestions, busy, onEdit, onChoose, onCreate, onClear, onConsolidate }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="text-[13px] font-semibold text-gray-800 mb-2">{TYPE_LABEL[type]}</div>

      {current ? (
        <div className="flex items-start gap-3">
          {current.image?.url && <img src={current.image.url} alt="" className="h-11 w-11 rounded object-cover border border-gray-200 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-gray-800 truncate">{current.internalName}</div>
            <div className="text-[12px] text-gray-500 line-clamp-2">{htmlPreview(current.bodyHe || current.bodyEn) || '(ללא תוכן)'}</div>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-gray-400">לא הוגדרה ברירת מחדל.</div>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {current && <Btn onClick={onEdit} disabled={busy} primary>ערוך תוכן</Btn>}
        <Btn onClick={onChoose} disabled={busy}>בחר קיים</Btn>
        <Btn onClick={onCreate} disabled={busy}>צור חדש</Btn>
        {current && <Btn onClick={onClear} disabled={busy} danger>הסר ברירת מחדל</Btn>}
      </div>
      {current && (
        <p className="text-[11px] text-gray-400 mt-2">
          עריכה כאן מעדכנת את אותו פריט תוכן — כל הוריאציות שיורשות ברירת מחדל זו יתעדכנו מיד.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-2.5 space-y-1.5">
          <div className="text-[11px] font-medium text-amber-800">איחוד מומלץ:</div>
          {suggestions.map((s) => (
            <div key={s.sharedContentId} className="flex items-center gap-2 text-[12px]">
              <span className="flex-1 min-w-0 truncate text-gray-700">
                {s.variantCount} וריאציות מקושרות ל־<b>{s.internalName}</b>
              </span>
              <button type="button" onClick={() => onConsolidate(s)} disabled={busy}
                className="shrink-0 h-7 px-2.5 rounded-lg border border-amber-300 bg-white text-[12px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                הפוך לברירת מחדל
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, danger, primary }) {
  const cls = primary
    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
    : danger
      ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`h-8 px-3 rounded-lg border text-[12px] font-medium disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

// Compact picker: choose an existing Shared Content item of a type as the default.
function DefaultPicker({ type, currentId, onClose, onPick }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    api.sharedContent.list({ type, active: true }).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [type]);
  const filtered = (rows || []).filter((r) => !q.trim() || `${r.internalName} ${htmlPreview(r.bodyHe)} ${htmlPreview(r.bodyEn)}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onClose={onClose} title={`בחירת ${TYPE_LABEL[type]} כברירת מחדל`} size="lg">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש…"
        className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-200" />
      {rows === null ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">לא נמצא תוכן משותף מסוג זה.</div>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} disabled={r.id === currentId}
                className="w-full text-right flex gap-3 px-2 py-2.5 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                {r.image?.url && <img src={r.image.url} alt="" className="h-10 w-10 rounded object-cover border border-gray-200 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gray-800 truncate">
                    {r.internalName}{r.id === currentId && <span className="text-[11px] text-gray-400"> · ברירת המחדל הנוכחית</span>}
                  </div>
                  <div className="text-[12px] text-gray-500 truncate">{htmlPreview(r.bodyHe || r.bodyEn) || '(ללא תוכן)'}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
