import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import BilingualField from '../common/BilingualField.jsx';

// Flat categories (V1 — no folders). Deleting one that is in USE archives it
// instead, so the history of everything filed under it stays readable; an
// unused one is genuinely removed, so a typo does not become permanent clutter.

export default function CategoriesPanel({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.contentLibrary.listCategories(true);
      setRows(res.categories || []);
    } catch (e) {
      setError(e?.payload?.error || 'טעינה נכשלה');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    try {
      await api.contentLibrary.createCategory({ nameHe: nameHe.trim(), nameEn: nameEn.trim() || null });
      setNameHe('');
      setNameEn('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err?.payload?.error || 'שמירה נכשלה');
    }
  }

  async function saveEdit() {
    try {
      await api.contentLibrary.updateCategory(editing.id, {
        nameHe: editing.nameHe,
        nameEn: editing.nameEn || null,
      });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err?.payload?.error || 'שמירה נכשלה');
    }
  }

  async function remove(row) {
    if (!window.confirm(`למחוק את "${row.nameHe}"?`)) return;
    try {
      const res = await api.contentLibrary.deleteCategory(row.id);
      if (res.archived) {
        window.alert(
          `הקטגוריה בשימוש ב-${res.itemCount} פריטים, ולכן הועברה לארכיון במקום להימחק — כך ההיסטוריה של אותם פריטים נשמרת.`,
        );
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err?.payload?.error || 'המחיקה נכשלה');
    }
  }

  async function toggleArchived(row) {
    await api.contentLibrary.updateCategory(row.id, { archived: !row.archived });
    await load();
    onChanged?.();
  }

  return (
    <div className="max-w-3xl">
      {/* A category name reaches EXTERNAL consumers through the Content API
          (Challenge/Recruitment may render it in an English UI), so it is a
          genuine He/En pair and gets the shared translate action. */}
      <form onSubmit={add} className="mb-6 rounded-2xl border border-gray-200 p-4">
        <h3 className="mb-3 text-[15px] font-semibold text-gray-900">קטגוריה חדשה</h3>
        <BilingualField
          label="שם הקטגוריה"
          he={nameHe}
          en={nameEn}
          onHe={setNameHe}
          onEn={setNameEn}
          placeholderHe="למשל: הדרכת מדריכים"
          placeholderEn="e.g. Guide Training"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={!nameHe.trim()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            הוסף
          </button>
        </div>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-gray-500">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          אין עדיין קטגוריות.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              {editing?.id === r.id ? (
                <div className="flex-1">
                  <BilingualField
                    label="שם הקטגוריה"
                    he={editing.nameHe}
                    en={editing.nameEn || ''}
                    onHe={(v) => setEditing({ ...editing, nameHe: v })}
                    onEn={(v) => setEditing({ ...editing, nameEn: v })}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => setEditing(null)} className="text-sm text-gray-500">
                      ביטול
                    </button>
                    <button onClick={saveEdit} className="text-sm font-medium text-gray-900">
                      שמור
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${r.archived ? 'text-gray-400' : 'text-gray-900'}`}>
                    {r.nameHe}
                    {r.nameEn && <span className="ms-2 text-xs text-gray-400" dir="ltr">{r.nameEn}</span>}
                    {r.archived && (
                      <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        בארכיון
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setEditing({ id: r.id, nameHe: r.nameHe, nameEn: r.nameEn })}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    ערוך
                  </button>
                  <button
                    onClick={() => toggleArchived(r)}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    {r.archived ? 'שחזר' : 'ארכב'}
                  </button>
                  <button onClick={() => remove(r)} className="text-sm text-red-600 hover:underline">
                    מחק
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
