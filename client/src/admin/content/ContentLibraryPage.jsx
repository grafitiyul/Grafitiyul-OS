import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useFileDrop } from '../common/useFileDrop.js';
import { createGalleryUploader, getGalleryUploader } from '../../lib/galleryUpload.js';
import CategoriesPanel from './CategoriesPanel.jsx';
import WorldCategoryPicker from './WorldCategoryPicker.jsx';
import ConnectionsPanel from './ConnectionsPanel.jsx';
import {
  CONTENT_TYPE_LABELS,
  TRANSCRIPT_LABELS,
  contentTypeLabel,
  sourceLabel,
  typeGlyph,
} from './contentLabels.js';

// ספריית תוכן — the module's home. Three surfaces, because they are three
// different jobs: the content itself, the categories that organise it, and the
// connections that feed it.

const TABS = [
  { key: 'items', label: 'תוכן' },
  { key: 'categories', label: 'קטגוריות' },
  { key: 'connections', label: 'מקורות וחיבורים' },
];

function TranscriptChip({ state }) {
  if (!state || state.status === 'unavailable') return <span className="text-gray-300">—</span>;
  const s = TRANSCRIPT_LABELS[state.status] || TRANSCRIPT_LABELS.not_started;
  return (
    <span
      title={state.error || undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${s.className}`}
    >
      {s.label}
    </span>
  );
}

function NewItemDialog({ meta, onClose, onCreated }) {
  const [mode, setMode] = useState('upload'); // upload | link
  const [internalName, setInternalName] = useState('');
  const [url, setUrl] = useState('');
  const [worldIds, setWorldIds] = useState([]);
  const [categoryIds, setCategoryIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [uploadedMediaId, setUploadedMediaId] = useState(null);
  const [uploadedType, setUploadedType] = useState(null);

  const uploader = useMemo(
    () =>
      getGalleryUploader('content-library:new', () =>
        createGalleryUploader({
          endpoints: {
            // The library uploads ONE file per item, so the batch initiate is
            // adapted to the single-file endpoint rather than duplicated.
            initiate: async (files) => {
              const f = files[0];
              const res = await api.contentLibrary.initiateUpload(f);
              return { batchId: null, accepted: [{ ...res, clientKey: f.clientKey }], rejected: [] };
            },
            urls: (mediaId, body) => api.contentLibrary.uploadUrls(mediaId, body),
            complete: (mediaId, body) => api.contentLibrary.completeUpload(mediaId, body),
            abort: async () => {},
          },
        }),
      ),
    [],
  );

  useEffect(() => {
    const off = uploader.subscribe((snap) => {
      setProgress(snap.totals);
      const done = snap.items.find((i) => i.status === 'done' && i.mediaId);
      if (done) {
        setUploadedMediaId(done.mediaId);
        setUploadedType(done.kind === 'video' ? 'video' : 'image');
        if (!internalName) setInternalName(done.name.replace(/\.[^.]+$/, ''));
      }
      const failed = snap.items.find((i) => i.status === 'failed' || i.status === 'rejected');
      if (failed) setError(failed.error || 'ההעלאה נכשלה');
    });
    return off;
  }, [uploader, internalName]);

  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: 'image/*,video/*',
    multiple: false,
    onFiles: (files) => {
      setError(null);
      uploader.addFiles(files);
    },
  });

  async function submit(e) {
    e.preventDefault();
    if (!internalName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api.contentLibrary.createItem({
        internalName: internalName.trim(),
        worldIds,
        contentType: mode === 'upload' ? uploadedType || 'video' : 'link',
        mediaId: mode === 'upload' ? uploadedMediaId : null,
        description: mode === 'link' ? url.trim() : null,
        categoryIds,
      });
      onCreated(item.id);
    } catch (err) {
      setError(err?.payload?.error || 'שמירה נכשלה');
      setBusy(false);
    }
  }

  const uploading = progress && (progress.uploading || progress.queued || progress.preparing || progress.processing);
  const canSubmit =
    internalName.trim() && worldIds.length > 0 && !busy && (mode === 'link' ? url.trim() : uploadedMediaId);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} dir="rtl" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">פריט תוכן חדש</h2>

        <div className="mt-4 flex gap-2">
          {[
            { key: 'upload', label: 'העלאת קובץ' },
            { key: 'link', label: 'קישור חיצוני' },
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                mode === m.key ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
              }`}
            >
              {m.label}
            </button>
          ))}
          <Link
            to="/admin/content-library/import"
            className="ms-auto self-center text-sm font-medium text-blue-600 hover:underline"
          >
            ייבוא מיוטיוב / וימאו ←
          </Link>
        </div>

        {mode === 'upload' ? (
          <div
            {...dropProps}
            className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragOver ? 'border-gray-900 bg-gray-50' : 'border-gray-300'
            }`}
          >
            <input {...inputProps} />
            {uploadedMediaId ? (
              <p className="text-sm font-medium text-emerald-700">הקובץ הועלה ואומת ✓</p>
            ) : uploading ? (
              <p className="text-sm text-gray-600">מעלה… {Math.round((progress.bytesSent / Math.max(progress.bytesTotal, 1)) * 100)}%</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">גררו קובץ לכאן</p>
                <button
                  type="button"
                  onClick={open}
                  className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  בחרו קובץ
                </button>
              </>
            )}
          </div>
        ) : (
          <label className="mt-4 block">
            <span className="text-sm font-medium text-gray-700">כתובת</span>
            <input
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
            />
          </label>
        )}

        <label className="mt-4 block">
          <span className="text-sm font-medium text-gray-700">שם פנימי</span>
          <input
            value={internalName}
            onChange={(e) => setInternalName(e.target.value)}
            placeholder="איך תזהו את הפריט הזה בספרייה"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            זה לא שם הקובץ ולא הכותרת מהמקור — שם שאתם בוחרים וניתן לשנות תמיד.
          </span>
        </label>

        <div className="mt-4">
          <WorldCategoryPicker
            worlds={meta?.worlds || []}
            categories={meta?.categories || []}
            selectedWorldIds={worldIds}
            selectedCategoryIds={categoryIds}
            onWorldsChange={setWorldIds}
            onCategoriesChange={setCategoryIds}
            compact
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            ביטול
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'שומר…' : 'צור פריט'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ContentLibraryPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('items');
  const [meta, setMeta] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    worldId: '',
    categoryId: '',
    contentType: '',
    source: '',
    workspaceId: '',
    includeArchived: false,
  });

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await api.contentLibrary.meta());
    } catch (e) {
      setError(e?.payload?.error || 'טעינה נכשלה');
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const res = await api.contentLibrary.listItems(filters);
      setItems(res.items || []);
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || 'טעינה נכשלה');
      setItems([]);
    }
  }, [filters]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    if (tab === 'items') loadItems();
  }, [tab, loadItems]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div dir="rtl" className="px-5 py-8 lg:px-10 lg:py-10 max-w-[1600px] mx-auto">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">ספריית תוכן</h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-gray-500">
              סרטונים, הקלטות, מסמכים ותמונות לשימוש חוזר — במקום אחד.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/admin/content-library/import"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              ייבוא ממקור
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
            >
              פריט חדש
            </button>
          </div>
        </div>

        <nav className="mt-6 flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {tab === 'categories' && <CategoriesPanel onChanged={loadMeta} />}
      {tab === 'connections' && <ConnectionsPanel meta={meta} onChanged={loadMeta} />}

      {tab === 'items' && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <input
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="חיפוש — שם, תיאור, כותרת מקור, ותמלול"
              className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
            <select
              value={filters.worldId}
              onChange={(e) => setFilters((f) => ({ ...f, worldId: e.target.value, categoryId: '' }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">כל עולמות התוכן</option>
              {(meta?.worlds || []).map((w) => (
                <option key={w.id} value={w.id}>{w.nameHe}</option>
              ))}
            </select>
            <select
              value={filters.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">כל הקטגוריות</option>
              {/* Hierarchical: once a world is chosen only ITS categories are
                  offered, so a CHALLENGE category can never be picked while
                  filtering GOS. */}
              {(meta?.categories || [])
                .filter((c) => !filters.worldId || c.worldId === filters.worldId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {filters.worldId ? c.nameHe : `${c.world?.nameHe || ''} · ${c.nameHe}`}
                  </option>
                ))}
            </select>
            <select
              value={filters.contentType}
              onChange={(e) => set('contentType', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">כל הסוגים</option>
              {(meta?.contentTypes || []).map((t) => (
                <option key={t} value={t}>{CONTENT_TYPE_LABELS[t] || t}</option>
              ))}
            </select>
            <select
              value={filters.source}
              onChange={(e) => set('source', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">כל המקורות</option>
              <option value="r2">אחסון שלנו</option>
              <option value="youtube">יוטיוב</option>
              <option value="vimeo">וימאו</option>
            </select>
            {(meta?.workspaces?.length || 0) > 1 && (
              <select
                value={filters.workspaceId}
                onChange={(e) => set('workspaceId', e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">כל המערכות</option>
                {meta.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={filters.includeArchived}
                onChange={(e) => set('includeArchived', e.target.checked)}
              />
              כולל ארכיון
            </label>
          </div>

          {items === null ? (
            <p className="text-sm text-gray-500">טוען…</p>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-[15px] font-medium text-gray-900">אין פריטים תואמים</p>
              <p className="mt-1 text-sm text-gray-500">
                העלו קובץ, הוסיפו קישור, או ייבאו סרטונים מיוטיוב ווימאו.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-200">
              <table className="w-full text-right">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                  <tr>
                    <th className="px-4 py-3">שם פנימי</th>
                    <th className="px-4 py-3">סוג</th>
                    <th className="px-4 py-3">קטגוריות</th>
                    <th className="px-4 py-3">מקור</th>
                    <th className="px-4 py-3">אורך</th>
                    <th className="px-4 py-3">תמלול</th>
                    <th className="px-4 py-3">עודכן</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      onClick={() => navigate(`/admin/content-library/${it.id}`)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <span className="me-2">{typeGlyph(it.contentType)}</span>
                        <span className="font-medium text-gray-900">{it.internalName}</span>
                        {it.archived && (
                          <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                            בארכיון
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {contentTypeLabel(it.contentType)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {it.categories.length ? it.categories.map((c) => c.nameHe).join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {it.media ? sourceLabel(it.media) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500" dir="ltr">
                        {it.media?.durationSeconds
                          ? new Date(it.media.durationSeconds * 1000).toISOString().substring(11, 19).replace(/^00:/, '')
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TranscriptChip state={it.transcriptState} />
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(it.updatedAt).toLocaleDateString('he-IL')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {creating && (
        <NewItemDialog
          meta={meta}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/admin/content-library/${id}`)}
        />
      )}
    </div>
  );
}
