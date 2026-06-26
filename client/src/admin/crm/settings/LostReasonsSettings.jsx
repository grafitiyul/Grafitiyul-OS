import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import BackButton from '../../common/BackButton.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';

// CRM settings → Lost Reasons. A reusable list of why a Deal was lost.
// Catalog only — NOT yet wired to Deals. Hebrew name required; English optional.
// Drag to reorder; toggle `active` to retire a reason without deleting it.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function LostReasonsSettings() {
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setReasons(await api.lostReasons.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.lostReasons.create({
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim() || null,
      });
      setNameHe('');
      setNameEn('');
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function reorder(ids) {
    try {
      await api.lostReasons.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.lostReasons.update(item.id, { active: !item.active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    if (!confirm(`למחוק את הסיבה "${item.nameHe}"?`)) return;
    try {
      await api.lostReasons.remove(item.id);
      await refresh();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          סיבות LOST
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          רשימה לשימוש חוזר של סיבות לאובדן דיל. כרגע ניהול תוכן בלבד — עדיין לא
          משויך לדילים.
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
          title="קטלוג סיבות"
          description="גררו לשינוי הסדר. ניתן לערוך, להפעיל/לכבות ולמחוק סיבות."
          footer={
            <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
              <input
                value={nameHe}
                onChange={(e) => setNameHe(e.target.value)}
                placeholder="סיבה חדשה"
                className={`flex-1 ${INPUT}`}
              />
              <input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Reason (EN) — אופציונלי"
                dir="ltr"
                className={`sm:w-56 ${INPUT}`}
              />
              <button
                type="submit"
                disabled={busy || !nameHe.trim()}
                className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'מוסיף…' : 'הוסף סיבה'}
              </button>
            </form>
          }
        >
          <ReorderableList
            items={reasons}
            onReorder={reorder}
            emptyText="עדיין אין סיבות. הוסיפו את הראשונה למטה."
            renderRow={(item, { handle }) =>
              editingId === item.id ? (
                <ReasonEdit
                  item={item}
                  onClose={() => setEditingId(null)}
                  onSaved={refresh}
                />
              ) : (
                <div className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
                  {handle}
                  <div className="flex-1 min-w-0 flex items-baseline gap-2.5">
                    <span
                      className={`font-medium text-[15px] truncate ${
                        item.active ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {item.nameHe}
                    </span>
                    {item.nameEn && (
                      <span className="text-[12px] text-gray-400 truncate" dir="ltr">
                        {item.nameEn}
                      </span>
                    )}
                  </div>
                  {!item.active && (
                    <span className="shrink-0 text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                      לא פעיל
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(item)}
                      title={item.active ? 'כבה' : 'הפעל'}
                      className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 text-[12px] font-medium"
                    >
                      {item.active ? 'כבה' : 'הפעל'}
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
        </SettingsCard>
      )}
    </div>
  );
}

function ReasonEdit({ item, onClose, onSaved }) {
  const [nameHe, setNameHe] = useState(item.nameHe || '');
  const [nameEn, setNameEn] = useState(item.nameEn || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.lostReasons.update(item.id, {
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim() || null,
      });
      onClose();
      await onSaved();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 px-2.5 py-2.5 flex flex-wrap items-center gap-2"
    >
      <input
        autoFocus
        value={nameHe}
        onChange={(e) => setNameHe(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder="שם"
        className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      <input
        value={nameEn}
        onChange={(e) => setNameEn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Reason (EN) — אופציונלי"
        dir="ltr"
        className="flex-1 min-w-[7rem] sm:max-w-[14rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      <div className="flex gap-1.5 shrink-0 ms-auto">
        <button
          type="submit"
          disabled={busy || !nameHe.trim()}
          className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'שומר…' : 'שמור'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
