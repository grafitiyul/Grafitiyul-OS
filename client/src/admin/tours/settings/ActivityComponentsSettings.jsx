import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import ReorderableList from '../../common/ReorderableList.jsx';
import { COMPONENT_TONES, COMPONENT_TONE_DOTS, componentToneStyle } from '../config.js';

// Settings → Tours → "מרכיבי פעילות". The reusable catalog of operational
// building blocks a Product / TourEvent is made of. Drag to reorder; toggle
// active to retire a component without losing tour history; workshop components
// carry a location per-tour (Slice C). Matches the Tours-settings card language.

const INPUT =
  'h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

const emptyDraft = { nameHe: '', icon: '', color: 'slate', isWorkshop: false };

export default function ActivityComponentsSettings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.activityComponents.list());
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
      await api.activityComponents.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.activityComponents.update(item.id, { isActive: !item.isActive });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    if (!confirm(`למחוק את מרכיב הפעילות "${item.nameHe}"?`)) return;
    try {
      await api.activityComponents.remove(item.id);
      await refresh();
    } catch (e) {
      alert(
        e.payload?.error === 'component_in_use'
          ? 'לא ניתן למחוק מרכיב שכבר בשימוש במוצר או בסיור — כבו אותו במקום זאת.'
          : 'שגיאה במחיקה: ' + (e.payload?.error || e.message),
      );
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">מרכיבי פעילות</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            אבני הבניין שמרכיבות כל סיור. מרכיב מסוג סדנה מקבל מיקום סדנה משלו בכל סיור.
          </p>
        </div>
        {!adding && !loading && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="h-9 shrink-0 rounded-lg bg-blue-600 px-3.5 text-[13px] font-semibold text-white hover:bg-blue-700"
          >
            + מרכיב
          </button>
        )}
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="px-5 py-6 text-center text-sm text-red-600">
          שגיאה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <div className="px-3 py-3">
          {adding && (
            <div className="mb-2">
              <ComponentForm
                draft={emptyDraft}
                onClose={() => setAdding(false)}
                onSubmit={async (data) => {
                  await api.activityComponents.create(data);
                  setAdding(false);
                  await refresh();
                }}
              />
            </div>
          )}
          <ReorderableList
            items={items}
            onReorder={reorder}
            emptyText="עדיין אין מרכיבי פעילות — הוסיפו את הראשון."
            renderRow={(item, { handle }) =>
              editingId === item.id ? (
                <ComponentForm
                  draft={item}
                  onClose={() => setEditingId(null)}
                  onSubmit={async (data) => {
                    await api.activityComponents.update(item.id, data);
                    setEditingId(null);
                    await refresh();
                  }}
                />
              ) : (
                <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-50">
                  {handle}
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${componentToneStyle(
                      item.color,
                    )} ${item.isActive ? '' : 'opacity-50'}`}
                  >
                    {item.icon && <span aria-hidden>{item.icon}</span>}
                    {item.nameHe}
                  </span>
                  {item.isWorkshop && (
                    <span className="text-[11px] rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5">
                      סדנה
                    </span>
                  )}
                  <div className="flex-1" />
                  {!item.isActive && (
                    <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                      לא פעיל
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => toggleActive(item)}
                      className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                    >
                      {item.isActive ? 'כבה' : 'הפעל'}
                    </button>
                    <button
                      onClick={() => setEditingId(item.id)}
                      title="עריכה"
                      className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => remove(item)}
                      title="מחק"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            }
          />
        </div>
      )}
    </section>
  );
}

function ComponentForm({ draft, onClose, onSubmit }) {
  const [f, setF] = useState({
    nameHe: draft.nameHe || '',
    icon: draft.icon || '',
    color: draft.color || 'slate',
    isWorkshop: !!draft.isWorkshop,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!f.nameHe.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ ...f, nameHe: f.nameHe.trim(), icon: f.icon.trim() || null });
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 px-3 py-3 space-y-2.5"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={f.icon}
          onChange={(e) => set('icon', e.target.value)}
          placeholder="😀"
          maxLength={4}
          className={`${INPUT} w-14 text-center text-base`}
          title="אימוג'י / אייקון"
        />
        <input
          value={f.nameHe}
          onChange={(e) => set('nameHe', e.target.value)}
          placeholder="שם המרכיב"
          className={`${INPUT} min-w-[10rem] flex-1`}
          autoFocus
        />
        <label className="flex items-center gap-1.5 text-[13px] text-gray-700">
          <input
            type="checkbox"
            checked={f.isWorkshop}
            onChange={(e) => set('isWorkshop', e.target.checked)}
          />
          סדנה
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-gray-500">צבע:</span>
        {COMPONENT_TONES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set('color', t)}
            title={t}
            className={`h-6 w-6 rounded-full ${COMPONENT_TONE_DOTS[t]} ${
              f.color === t ? 'ring-2 ring-offset-1 ring-gray-700' : 'opacity-70 hover:opacity-100'
            }`}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
        <button
          type="submit"
          disabled={busy || !f.nameHe.trim()}
          className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור'}
        </button>
      </div>
    </form>
  );
}
