import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PAGE_TYPES, normalizeSlug } from '../../../../shared/sitePage.mjs';

// The "דפי אתר" index. Deliberately a management LIST, not a dashboard: the job
// here is to find a page and see whether what is live matches what is drafted.

const typeLabel = (k) => PAGE_TYPES.find((t) => t.key === k)?.label || k;

function StatusChip({ page }) {
  if (page.status !== 'published') {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">טיוטה</span>;
  }
  if (page.draftDirty) {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800">שינויים לא מפורסמים</span>;
  }
  return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800">מפורסם</span>;
}

export default function SitePagesPage() {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ internalName: '', pageType: 'info', slug: '' });
  const navigate = useNavigate();

  useEffect(() => {
    api.sitePages
      .list()
      .then((r) => setPages(r.pages))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  async function create() {
    setError(null);
    try {
      const { page } = await api.sitePages.create(form);
      navigate(`/admin/site-pages/${page.id}`);
    } catch (e) {
      setError(e?.payload?.error === 'slug_taken' ? 'הכתובת כבר תפוסה.' : String(e.message || e));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">דפי אתר</h1>
          <p className="text-sm text-slate-500">
            עמודי תוכן שמנוהלים כאן ומוצגים באתר הציבורי. GOS הוא המקור היחיד לעריכה.
          </p>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() => setCreating((v) => !v)}
        >
          + עמוד חדש
        </button>
      </div>

      {error ? <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {creating ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">שם פנימי</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.internalName}
                onChange={(e) => setForm({ ...form, internalName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">סוג</span>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.pageType}
                onChange={(e) => setForm({ ...form, pageType: e.target.value })}
              >
                {PAGE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">כתובת (slug)</span>
              <input
                dir="ltr"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                onBlur={(e) => setForm((f) => ({ ...f, slug: normalizeSlug(e.target.value) }))}
                placeholder="restaurant-recommendations"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!form.internalName.trim() || !form.slug.trim()}
              onClick={create}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              יצירה
            </button>
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={() => setCreating(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : null}

      {pages === null ? (
        <p className="text-slate-500">טוען…</p>
      ) : pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <p className="text-slate-600">עדיין אין עמודים.</p>
          <p className="mt-1 text-sm text-slate-400">צרו עמוד ראשון כדי לנהל תוכן אתר מתוך GOS.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">שם</th>
                <th className="px-4 py-3 font-medium">סוג</th>
                <th className="px-4 py-3 font-medium">כתובת</th>
                <th className="px-4 py-3 font-medium">תוכן</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">עודכן</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pages.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link className="font-medium text-indigo-700 hover:underline" to={`/admin/site-pages/${p.id}`}>
                      {p.internalName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{typeLabel(p.pageType)}</td>
                  <td className="px-4 py-3 text-slate-500" dir="ltr">/{p.slug}/</td>
                  <td className="px-4 py-3 text-slate-500">
                    {p.summary.sections} מקטעים
                    {p.summary.cards ? ` · ${p.summary.cards} כרטיסים` : ''}
                  </td>
                  <td className="px-4 py-3"><StatusChip page={p} /></td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.updatedAt).toLocaleDateString('he-IL')}
                    {p.updatedByName ? <span className="text-slate-400"> · {p.updatedByName}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
