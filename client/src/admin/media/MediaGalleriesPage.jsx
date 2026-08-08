import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SettingsShell from '../settings/SettingsShell.jsx';

// "תיקיות תמונות וסרטונים" — the operator's list of customer-facing media
// folders. Creating one asks for the minimum that makes it real (an internal
// name), because everything else is editable inside the folder and demanding it
// up front would be a form standing between the operator and the work.

function LinkPill({ link }) {
  if (!link) return <span className="text-xs text-gray-400">אין קישור</span>;
  if (link.status === 'disabled') {
    return (
      <span className="text-xs rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 border border-amber-200">
        קישור מושבת
      </span>
    );
  }
  return (
    <span className="text-xs rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 border border-emerald-200">
      קישור פעיל
    </span>
  );
}

function CreateDialog({ onClose, onCreated }) {
  const [internalName, setInternalName] = useState('');
  const [titleHe, setTitleHe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!internalName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.mediaGalleries.create({
        internalName: internalName.trim(),
        titleHe: titleHe.trim() || null,
        titleEn: titleEn.trim() || null,
      });
      onCreated(res.id);
    } catch (err) {
      setError(err?.payload?.error || 'שמירה נכשלה');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        dir="rtl"
      >
        <h2 className="text-lg font-bold text-gray-900">תיקייה חדשה</h2>
        <p className="mt-1 text-sm text-gray-500">
          השם הפנימי הוא לזיהוי שלך בלבד — הלקוח לעולם לא רואה אותו.
        </p>

        <label className="mt-5 block">
          <span className="text-sm font-medium text-gray-700">שם פנימי</span>
          <input
            autoFocus
            value={internalName}
            onChange={(e) => setInternalName(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
            placeholder="למשל: סדנת גרפיטי — חברת ABC, יולי"
          />
        </label>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">כותרת ללקוח (עברית)</span>
            <input
              value={titleHe}
              onChange={(e) => setTitleHe(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
              placeholder="תמונות מהפעילות"
            />
          </label>
          <label className="block" dir="ltr">
            <span className="block text-sm font-medium text-gray-700 text-right" dir="rtl">
              כותרת ללקוח (אנגלית)
            </span>
            <input
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
              placeholder="Activity Photos"
            />
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            ביטול
          </button>
          <button
            type="submit"
            disabled={!internalName.trim() || busy}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'יוצר…' : 'צור תיקייה'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function MediaGalleriesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.mediaGalleries.list({ search, includeArchived });
      setRows(res.galleries || []);
    } catch (err) {
      setError(err?.payload?.error || 'טעינה נכשלה');
      setRows([]);
    }
  }, [search, includeArchived]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SettingsShell
      width="wide"
      title="תיקיות תמונות וסרטונים"
      subtitle="תיקיות מדיה שנשלחות ללקוח בקישור. כל תיקייה מחזיקה כותרות בעברית ובאנגלית, והרשאות שנאכפות בשרת."
      actions={
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
        >
          תיקייה חדשה
        </button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם"
          className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          הצג גם בארכיון
        </label>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-gray-500">טוען…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-[15px] font-medium text-gray-900">אין עדיין תיקיות</p>
          <p className="mt-1 text-sm text-gray-500">
            תיקייה היא אוסף תמונות וסרטונים שמשתפים עם לקוח בקישור אחד.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="mt-5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
          >
            צור תיקייה ראשונה
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200">
          <table className="w-full text-right">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-3">שם פנימי</th>
                <th className="px-4 py-3">כותרת ללקוח</th>
                <th className="px-4 py-3">פריטים</th>
                <th className="px-4 py-3">קישור</th>
                <th className="px-4 py-3">עודכן</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => navigate(`/admin/settings/crm/media-galleries/${g.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {g.internalName}
                    {g.status === 'archived' && (
                      <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        בארכיון
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{g.titleHe || g.titleEn || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {g.imageCount + g.videoCount === 0
                      ? '—'
                      : `${g.imageCount} תמונות · ${g.videoCount} סרטונים`}
                  </td>
                  <td className="px-4 py-3">
                    <LinkPill link={g.link} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(g.updatedAt).toLocaleDateString('he-IL')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/admin/settings/crm/media-galleries/${id}`)}
        />
      )}
    </SettingsShell>
  );
}
