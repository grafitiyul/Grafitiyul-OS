import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import ReorderableList from '../../common/ReorderableList.jsx';
import AlertDialog from '../../common/AlertDialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import BilingualField from '../../common/BilingualField.jsx';

// Settings → Tours → "מיקומי סדנה". Physical places a workshop component can take
// place in; chosen per workshop component on each tour (Slice C). Drag to
// reorder; toggle active to retire a location without losing tour history.

const emptyDraft = {
  nameHe: '', address: '', instructions: '',
  nameEn: '', addressEn: '', instructionsEn: '',
};

export default function WorkshopLocationsSettings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert
  const [confirmRemove, setConfirmRemove] = useState(null); // item | null

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.workshopLocations.list());
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
      await api.workshopLocations.reorder(ids);
    } catch (e) {
      setAlertMsg('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }
  async function toggleActive(item) {
    try {
      await api.workshopLocations.update(item.id, { isActive: !item.isActive });
      await refresh();
    } catch (e) {
      setAlertMsg('שגיאה: ' + e.message);
    }
  }
  async function remove(item) {
    setConfirmRemove(null);
    try {
      await api.workshopLocations.remove(item.id);
      await refresh();
    } catch (e) {
      setAlertMsg(
        e.payload?.error === 'location_in_use'
          ? 'לא ניתן למחוק מיקום שכבר בשימוש בסיור — כבו אותו במקום זאת.'
          : 'שגיאה במחיקה: ' + (e.payload?.error || e.message),
      );
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm mb-6">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">מיקומי סדנה</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            מיקומים בהם מתקיימות סדנאות. נבחרים לכל מרכיב סדנה בנפרד בתוך הסיור.
            מדריך דובר אנגלית רואה את הגרסה האנגלית בפורטל.
          </p>
        </div>
        {!adding && !loading && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="h-9 shrink-0 rounded-lg bg-blue-600 px-3.5 text-[13px] font-semibold text-white hover:bg-blue-700"
          >
            + מיקום
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
              <LocationForm
                draft={emptyDraft}
                onClose={() => setAdding(false)}
                onSubmit={async (data) => {
                  await api.workshopLocations.create(data);
                  setAdding(false);
                  await refresh();
                }}
              />
            </div>
          )}
          <ReorderableList
            items={items}
            onReorder={reorder}
            emptyText="עדיין אין מיקומי סדנה — הוסיפו את הראשון."
            renderRow={(item, { handle }) =>
              editingId === item.id ? (
                <LocationForm
                  draft={item}
                  onClose={() => setEditingId(null)}
                  onSubmit={async (data) => {
                    await api.workshopLocations.update(item.id, data);
                    setEditingId(null);
                    await refresh();
                  }}
                />
              ) : (
                <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-50">
                  {handle}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[14px] font-medium ${item.isActive ? 'text-gray-900' : 'text-gray-400'}`}
                    >
                      📍 {item.nameHe}
                    </div>
                    {item.address && (
                      <div className="truncate text-[12px] text-gray-500">{item.address}</div>
                    )}
                  </div>
                  {/* Operator-visible content gap: this location has no English,
                      so an English-speaking guide would read it in Hebrew. */}
                  {item.isActive && !String(item.nameEn || '').trim() && (
                    <span
                      className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                      title="אין תוכן באנגלית — מדריך דובר אנגלית יראה את הטקסט בעברית"
                    >
                      חסר אנגלית
                    </span>
                  )}
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
                      onClick={() => setConfirmRemove(item)}
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

      <ConfirmDialog
        open={!!confirmRemove}
        title="מחיקת מיקום סדנה"
        body={confirmRemove ? `למחוק את מיקום הסדנה "${confirmRemove.nameHe}"? לא ניתן לבטל פעולה זו.` : ''}
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => remove(confirmRemove)}
      />
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </section>
  );
}

function LocationForm({ draft, onClose, onSubmit }) {
  const [f, setF] = useState({
    nameHe: draft.nameHe || '',
    address: draft.address || '',
    instructions: draft.instructions || '',
    nameEn: draft.nameEn || '',
    addressEn: draft.addressEn || '',
    instructionsEn: draft.instructionsEn || '',
  });
  const [busy, setBusy] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!f.nameHe.trim()) return;
    setBusy(true);
    try {
      // Empty English CLEARS the column (back to "no English content yet") —
      // it is never backfilled from the Hebrew.
      await onSubmit({
        nameHe: f.nameHe.trim(),
        address: f.address.trim() || null,
        instructions: f.instructions.trim() || null,
        nameEn: f.nameEn.trim() || null,
        addressEn: f.addressEn.trim() || null,
        instructionsEn: f.instructionsEn.trim() || null,
      });
    } catch (e) {
      setAlertMsg('שגיאה בשמירה: ' + (e.payload?.error || e.message));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 px-3 py-3 space-y-2"
      dir="rtl"
    >
      {/* One shared bilingual pair per field — He right/RTL, En left/LTR. */}
      <BilingualField
        label="שם המיקום"
        he={f.nameHe}
        en={f.nameEn}
        onHe={(v) => set('nameHe', v)}
        onEn={(v) => set('nameEn', v)}
        placeholderHe="שם המיקום"
        placeholderEn="Location name"
        autoFocus
      />
      <BilingualField
        label="כתובת"
        he={f.address}
        en={f.addressEn}
        onHe={(v) => set('address', v)}
        onEn={(v) => set('addressEn', v)}
        placeholderHe="כתובת (אופציונלי)"
        placeholderEn="Address (optional)"
      />
      <BilingualField
        label="הוראות הגעה / חניה / הקמה"
        render="textarea"
        rows={2}
        he={f.instructions}
        en={f.instructionsEn}
        onHe={(v) => set('instructions', v)}
        onEn={(v) => set('instructionsEn', v)}
        placeholderHe="הוראות הגעה / חניה / הקמה (אופציונלי)"
        placeholderEn="Arrival / parking / setup notes (optional)"
      />
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
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </form>
  );
}
