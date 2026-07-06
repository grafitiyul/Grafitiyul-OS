import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';
import { taskIcon, TASK_ICONS } from '../../deals/tasks/taskConfig.js';

// CRM settings → Task Types (סוגי משימות). The catalog behind the Deal task
// composer. Drag to reorder; toggle active to retire a type without losing task
// history. System defaults can be renamed/re-iconed/deactivated but not deleted.

const ICON_KEYS = Object.keys(TASK_ICONS);
const OFFSETS = [
  { value: 'today', label: 'היום' },
  { value: 'tomorrow', label: 'מחר' },
  { value: 'days_from_now', label: 'בעוד X ימים' },
  { value: 'none', label: 'ללא ברירת מחדל' },
];

const emptyDraft = {
  nameHe: '',
  icon: 'check',
  defaultText: '',
  channel: 'none',
  defaultDueOffsetType: 'today',
  defaultDueOffsetDays: 0,
  defaultTime: '',
  requiresTime: false,
};

export default function TaskTypesSettings() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setTypes(await api.taskTypes.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function reorder(ids) {
    try {
      await api.taskTypes.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.taskTypes.update(item.id, { isActive: !item.isActive });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    if (!confirm(`למחוק את סוג המשימה "${item.nameHe}"?`)) return;
    try {
      await api.taskTypes.remove(item.id);
      await refresh();
    } catch (e) {
      alert('שגיאה במחיקה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סוגי משימות</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          הסוגים שמופיעים בבורר המשימות של הדיל. אפשר לשנות שם, אייקון, טקסט ברירת
          מחדל, ערוץ (וואטסאפ) והתנהגות מועד. סוגי מערכת אפשר לכבות אך לא למחוק.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <SettingsCard
          title="קטלוג סוגי משימות"
          description="גררו לשינוי הסדר."
          footer={
            adding ? (
              <TypeForm
                draft={emptyDraft}
                onClose={() => setAdding(false)}
                onSubmit={async (data) => {
                  await api.taskTypes.create(data);
                  setAdding(false);
                  await refresh();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              >
                הוסף סוג משימה
              </button>
            )
          }
        >
          <ReorderableList
            items={types}
            onReorder={reorder}
            emptyText="עדיין אין סוגי משימות."
            renderRow={(item, { handle }) =>
              editingId === item.id ? (
                <TypeForm
                  draft={item}
                  onClose={() => setEditingId(null)}
                  onSubmit={async (data) => {
                    await api.taskTypes.update(item.id, data);
                    setEditingId(null);
                    await refresh();
                  }}
                />
              ) : (
                <div className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
                  {handle}
                  <span aria-hidden className="text-[16px]">{taskIcon(item.icon)}</span>
                  <div className="min-w-0 flex-1">
                    <span className={`font-medium text-[15px] ${item.isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {item.nameHe}
                    </span>
                    {item.channel === 'whatsapp' && (
                      <span className="ms-2 text-[11px] rounded-full bg-green-50 text-green-700 px-2 py-0.5">וואטסאפ</span>
                    )}
                    {item.isSystem && (
                      <span className="ms-2 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">מערכת</span>
                    )}
                  </div>
                  {!item.isActive && (
                    <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעיל</span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleActive(item)} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium">
                      {item.isActive ? 'כבה' : 'הפעל'}
                    </button>
                    <button onClick={() => setEditingId(item.id)} title="עריכה" className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                    {!item.isSystem && (
                      <button onClick={() => remove(item)} title="מחק" className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5">🗑</button>
                    )}
                  </div>
                </div>
              )
            }
          />
        </SettingsCard>
      )}
    </div>
  );
}

function TypeForm({ draft, onClose, onSubmit }) {
  const [f, setF] = useState({
    nameHe: draft.nameHe || '',
    icon: draft.icon || 'check',
    defaultText: draft.defaultText || '',
    channel: draft.channel || 'none',
    defaultDueOffsetType: draft.defaultDueOffsetType || 'today',
    defaultDueOffsetDays: draft.defaultDueOffsetDays || 0,
    defaultTime: draft.defaultTime || '',
    requiresTime: !!draft.requiresTime,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!f.nameHe.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        ...f,
        nameHe: f.nameHe.trim(),
        defaultText: f.defaultText.trim() || null,
        defaultDueOffsetDays: Number(f.defaultDueOffsetDays) || 0,
        defaultTime: f.defaultTime || null,
      });
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
      setBusy(false);
    }
  }

  const INPUT = 'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 px-3 py-3 space-y-2" dir="rtl">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input value={f.nameHe} onChange={(e) => set('nameHe', e.target.value)} placeholder="שם הסוג" className={`${INPUT} col-span-2 sm:col-span-1`} autoFocus />
        <select value={f.icon} onChange={(e) => set('icon', e.target.value)} className={INPUT}>
          {ICON_KEYS.map((k) => (
            <option key={k} value={k}>{taskIcon(k)} {k}</option>
          ))}
        </select>
        <select value={f.channel} onChange={(e) => set('channel', e.target.value)} className={INPUT}>
          <option value="none">רגיל</option>
          <option value="whatsapp">וואטסאפ</option>
        </select>
      </div>
      <input value={f.defaultText} onChange={(e) => set('defaultText', e.target.value)} placeholder="טקסט ברירת מחדל" className={`${INPUT} w-full`} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select value={f.defaultDueOffsetType} onChange={(e) => set('defaultDueOffsetType', e.target.value)} className={INPUT}>
          {OFFSETS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {f.defaultDueOffsetType === 'days_from_now' && (
          <input type="number" min="0" value={f.defaultDueOffsetDays} onChange={(e) => set('defaultDueOffsetDays', e.target.value)} placeholder="ימים" className={INPUT} />
        )}
        <input type="time" value={f.defaultTime} onChange={(e) => set('defaultTime', e.target.value)} className={INPUT} title="שעת ברירת מחדל" />
        <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
          <input type="checkbox" checked={f.requiresTime} onChange={(e) => set('requiresTime', e.target.checked)} />
          מחייב שעה
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
        <button type="submit" disabled={busy || !f.nameHe.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור'}
        </button>
      </div>
    </form>
  );
}
