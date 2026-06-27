import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import BackButton from '../../common/BackButton.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import { SettingsCard } from './catalogKit.jsx';

// CRM settings → Deal Sources. The admin-managed picklist of how a lead/deal
// arrived (Facebook, website, referral, conference, …). Used by the Create Deal
// dialog's required "מקור" dropdown. Drag to reorder; toggle `active` to retire
// a source without deleting history.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function DealSourcesSettings() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSources(await api.dealSources.list());
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
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.dealSources.create({ label: label.trim() });
      setLabel('');
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function reorder(ids) {
    try {
      await api.dealSources.reorder(ids);
    } catch (e) {
      alert('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.dealSources.update(item.id, { active: !item.active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    if (!confirm(`למחוק את המקור "${item.label}"?`)) return;
    try {
      await api.dealSources.remove(item.id);
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
          מקורות דיל
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          רשימת המקורות של פניות חדשות (פייסבוק, אתר, הפניה, כנס…). מקורות אלו
          מופיעים בשדה "מקור" ביצירת דיל חדש.
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
          title="קטלוג מקורות"
          description="גררו לשינוי הסדר. ניתן לערוך, להפעיל/לכבות ולמחוק מקורות."
          footer={
            <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="מקור חדש (לדוגמה: פייסבוק)"
                className={`flex-1 ${INPUT}`}
              />
              <button
                type="submit"
                disabled={busy || !label.trim()}
                className="h-10 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'מוסיף…' : 'הוסף מקור'}
              </button>
            </form>
          }
        >
          <ReorderableList
            items={sources}
            onReorder={reorder}
            emptyText="עדיין אין מקורות. הוסיפו את הראשון למטה."
            renderRow={(item, { handle }) =>
              editingId === item.id ? (
                <SourceEdit
                  item={item}
                  onClose={() => setEditingId(null)}
                  onSaved={refresh}
                />
              ) : (
                <div className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-gray-50">
                  {handle}
                  <div className="flex-1 min-w-0">
                    <span
                      className={`font-medium text-[15px] truncate ${
                        item.active ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {item.label}
                    </span>
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

function SourceEdit({ item, onClose, onSaved }) {
  const [label, setLabel] = useState(item.label || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.dealSources.update(item.id, { label: label.trim() });
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
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder="שם המקור"
        className="flex-1 min-w-[9rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      <div className="flex gap-1.5 shrink-0 ms-auto">
        <button
          type="submit"
          disabled={busy || !label.trim()}
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
