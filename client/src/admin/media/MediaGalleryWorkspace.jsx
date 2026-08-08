import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { createGalleryUploader, getGalleryUploader } from '../../lib/galleryUpload.js';
import { useFileDrop } from '../common/useFileDrop.js';
import SettingsShell from '../settings/SettingsShell.jsx';
import BilingualField from '../common/BilingualField.jsx';

// One media folder. A workspace, not a form: the operator spends real time here
// uploading, arranging and deciding what the customer may do, so the surfaces
// are laid out side by side rather than buried behind tabs.

const PERMISSION_ROWS = [
  { key: 'extCanView', label: 'צפייה', hint: 'לראות את התיקייה בקישור.' },
  { key: 'extCanDownload', label: 'הורדה', hint: 'להוריד קבצים בודדים.' },
  { key: 'extCanUpload', label: 'העלאה', hint: 'להוסיף תמונות וסרטונים לתיקייה.' },
  {
    key: 'extCanDelete',
    label: 'מחיקה',
    hint: 'למחוק — רק את מה שהמבקר עצמו העלה, לעולם לא מדיה שלנו.',
  },
  {
    key: 'extCanEdit',
    label: 'עריכה',
    hint: 'לערוך כיתוב — רק לפריטים שהמבקר עצמו העלה.',
  },
];

function Field({ label, value, onChange, placeholder, dir, textarea }) {
  const Cmp = textarea ? 'textarea' : 'input';
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      <Cmp
        dir={dir}
        rows={textarea ? 2 : undefined}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
      />
    </label>
  );
}

function LinkPanel({ gallery, onChanged, onError }) {
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);
  const link = gallery.link;

  async function run(kind, fn) {
    setBusy(kind);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e?.payload?.error || 'הפעולה נכשלה');
    } finally {
      setBusy(null);
    }
  }

  const disabled = link?.status === 'disabled';

  return (
    <section className="rounded-2xl border border-gray-200 p-5">
      <h2 className="text-[15px] font-semibold text-gray-900">קישור ציבורי</h2>
      <p className="mt-1 text-sm text-gray-500">
        זו הכתובת שהלקוח מקבל. הכתובת עצמה היא ההרשאה — מי שמחזיק בה נכנס.
      </p>

      {link ? (
        <>
          <div className="mt-4 flex items-center gap-2">
            <input
              readOnly
              value={link.url || ''}
              dir="ltr"
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
            />
            <button
              onClick={() => {
                navigator.clipboard?.writeText(link.url || '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {copied ? 'הועתק' : 'העתק'}
            </button>
            <a
              href={link.url || '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              פתח
            </a>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                run('toggle', () => api.mediaGalleries.setLinkEnabled(gallery.id, disabled))
              }
              disabled={busy === 'toggle'}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              {disabled ? 'הפעל קישור' : 'השבת קישור'}
            </button>
            <button
              onClick={() => {
                if (
                  !window.confirm(
                    'להחליף את הקישור? הכתובת הנוכחית תפסיק לעבוד לצמיתות, וכל מי שכבר קיבל אותה יאבד גישה.',
                  )
                ) {
                  return;
                }
                run('rotate', () => api.mediaGalleries.rotateLink(gallery.id));
              }}
              disabled={busy === 'rotate'}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              החלף קישור
            </button>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {disabled
              ? 'הקישור מושבת: מי שנכנס רואה עמוד לא־זמין, והמדיה נשמרת. הפעלה מחזירה בדיוק את אותה כתובת.'
              : 'השבתה היא זמנית והפיכה — אותה כתובת תחזור לעבוד. החלפה היא סופית ומייצרת כתובת חדשה.'}
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-500">אין קישור פעיל.</p>
      )}
    </section>
  );
}

// Per-item bilingual caption. Captions are shown to the customer in the
// language they are viewing, so they are a genuine He/En pair and get the
// shared translate action — exactly like the gallery's own title.
function CaptionDialog({ galleryId, media, onClose, onSaved }) {
  const [he, setHe] = useState(media.captionHe || '');
  const [en, setEn] = useState(media.captionEn || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.mediaGalleries.updateMedia(galleryId, media.id, {
        captionHe: he,
        captionEn: en,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e?.payload?.error || 'שמירה נכשלה');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
      <div dir="rtl" className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">כיתוב לפריט</h2>
        <p className="mt-1 text-sm text-gray-500">
          הכיתוב מוצג ללקוח בשפה שהוא צופה בה. אם אין נוסח בשפה מסוימת — לא יוצג כיתוב, ולא
          יוצג הנוסח בשפה השנייה.
        </p>
        <div className="mt-4 flex items-start gap-4">
          {(media.thumbUrl || media.posterUrl) && (
            <img
              src={media.thumbUrl || media.posterUrl}
              alt=""
              className="h-24 w-24 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <BilingualField
              label="כיתוב"
              render="textarea"
              rows={3}
              he={he}
              en={en}
              onHe={setHe}
              onEn={setEn}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'שומר…' : 'שמור כיתוב'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MediaGalleryWorkspace() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const [captionFor, setCaptionFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.mediaGalleries.get(id);
      setData(res);
      setDraft({
        internalName: res.internalName || '',
        titleHe: res.titleHe || '',
        titleEn: res.titleEn || '',
        subtitleHe: res.subtitleHe || '',
        subtitleEn: res.subtitleEn || '',
        defaultLanguage: res.defaultLanguage || 'he',
        permissions: { ...res.permissions },
      });
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || 'טעינה נכשלה');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const uploader = useMemo(
    () =>
      getGalleryUploader(`media-gallery:${id}`, () =>
        createGalleryUploader({
          endpoints: {
            initiate: (files) => api.mediaGalleries.initiateUpload(id, files),
            urls: (mediaId, body) => api.mediaGalleries.uploadUrls(id, mediaId, body),
            complete: (mediaId, body) => api.mediaGalleries.completeUpload(id, mediaId, body),
            abort: (mediaId) => api.mediaGalleries.abortUpload(id, mediaId),
          },
        }),
      ),
    [id],
  );

  useEffect(() => {
    const off = uploader.subscribe((snap) => {
      setUploadState(snap);
      // Refresh only when the queue has fully drained, so the grid does not
      // re-render on every progress tick during a large batch.
      if (snap.totals.total > 0 && snap.totals.queued === 0 && snap.totals.uploading === 0
        && snap.totals.preparing === 0 && snap.totals.processing === 0) {
        load();
      }
    });
    return off;
  }, [uploader, load]);

  const onFiles = useCallback((files) => uploader.addFiles(files), [uploader]);
  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: 'image/*,video/*',
    multiple: true,
    onFiles,
  });

  async function save() {
    setSaving(true);
    try {
      await api.mediaGalleries.update(id, draft);
      await load();
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(media) {
    if (!window.confirm(`להסיר את "${media.originalFileName}" מהתיקייה?`)) return;
    try {
      const res = await api.mediaGalleries.removeMedia(id, media.id, { deleteAsset: true });
      if (!res.assetDeleted && res.stillReferencedBy?.length) {
        // Honest, not silent: the operator asked for the file to go and it did
        // not, because something else still points at the same bytes.
        window.alert(
          'הפריט הוסר מהתיקייה, אבל הקובץ עצמו נשמר — הוא בשימוש במקום נוסף במערכת.',
        );
      }
      await load();
    } catch (e) {
      setError(e?.payload?.error || 'המחיקה נכשלה');
    }
  }

  if (error && !data) {
    return (
      <SettingsShell width="wide" title="תיקיית מדיה">
        <p className="text-sm text-red-600">{error}</p>
      </SettingsShell>
    );
  }
  if (!data || !draft) {
    return (
      <SettingsShell width="wide" title="תיקיית מדיה">
        <p className="text-sm text-gray-500">טוען…</p>
      </SettingsShell>
    );
  }

  const totals = uploadState?.totals;
  const busyUploading =
    totals && (totals.uploading || totals.queued || totals.preparing || totals.processing);

  return (
    <SettingsShell
      width="wide"
      title={data.internalName}
      subtitle="שם פנימי לזיהוי שלך. הלקוח רואה רק את הכותרות שמוגדרות למטה."
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              await api.mediaGalleries.setArchived(id, data.status !== 'archived');
              load();
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            {data.status === 'archived' ? 'הוצא מארכיון' : 'העבר לארכיון'}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </div>
      }
    >
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {data.status === 'archived' && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          התיקייה בארכיון — הקישור מושבת והמדיה נשמרת. הוצאה מארכיון מחזירה את אותה כתובת.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ── Upload ─────────────────────────────────────────────── */}
          <section
            {...dropProps}
            className={`relative rounded-2xl border-2 border-dashed p-6 transition ${
              dragOver ? 'border-gray-900 bg-gray-50' : 'border-gray-300'
            }`}
          >
            <input {...inputProps} />
            <div className="text-center">
              <p className="text-[15px] font-medium text-gray-900">
                גררו לכאן תמונות וסרטונים
              </p>
              <p className="mt-1 text-sm text-gray-500">או</p>
              <button
                onClick={open}
                className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
              >
                בחרו קבצים
              </button>
            </div>
            {busyUploading ? (
              <p className="mt-4 text-center text-sm text-gray-600">
                מעלה {totals.done}/{totals.total}…
              </p>
            ) : totals?.failed ? (
              <p className="mt-4 text-center text-sm text-red-600">
                {totals.failed} קבצים נכשלו.
              </p>
            ) : null}
          </section>

          {/* ── Media grid ─────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-gray-900">
              פריטים ({data.media.length})
            </h2>
            {data.media.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                אין עדיין מדיה בתיקייה.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {data.media.map((m) => (
                  <figure
                    key={m.id}
                    className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                  >
                    {m.thumbUrl || m.posterUrl ? (
                      <img
                        src={m.thumbUrl || m.posterUrl}
                        alt={m.originalFileName}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center text-3xl">
                        {m.mediaType === 'video' ? '🎬' : '🖼️'}
                      </div>
                    )}
                    <figcaption className="truncate px-2 py-1.5 text-[11px] text-gray-500">
                      {m.originalFileName}
                    </figcaption>
                    <button
                      onClick={() => removeItem(m)}
                      title="הסר מהתיקייה"
                      className="absolute left-1.5 top-1.5 hidden rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-red-600 shadow group-hover:block"
                    >
                      הסר
                    </button>
                    <button
                      onClick={() => setCaptionFor(m)}
                      title="כיתוב"
                      className={`absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-1 text-xs font-medium shadow ${
                        m.captionHe || m.captionEn
                          ? 'text-emerald-700'
                          : 'hidden text-gray-600 group-hover:block'
                      }`}
                    >
                      {m.captionHe || m.captionEn ? '✎ כיתוב' : 'כיתוב'}
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Right column: identity, link, permissions ─────────────── */}
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">מה הלקוח רואה</h2>
            {/* Internal name is ONE field, deliberately. It is an operator
                label, not customer-facing content, so it gets no English twin
                and no translate action. */}
            <Field
              label="שם פנימי (לא מוצג ללקוח)"
              value={draft.internalName}
              onChange={(v) => setDraft({ ...draft, internalName: v })}
            />
            <BilingualField
              label="כותרת"
              he={draft.titleHe}
              en={draft.titleEn}
              onHe={(v) => setDraft({ ...draft, titleHe: v })}
              onEn={(v) => setDraft({ ...draft, titleEn: v })}
              placeholderHe="תמונות מהפעילות"
              placeholderEn="Activity Photos"
            />
            <BilingualField
              label="תת-כותרת"
              render="textarea"
              rows={2}
              he={draft.subtitleHe}
              en={draft.subtitleEn}
              onHe={(v) => setDraft({ ...draft, subtitleHe: v })}
              onEn={(v) => setDraft({ ...draft, subtitleEn: v })}
            />
            <label className="block">
              <span className="block text-sm font-medium text-gray-700">שפת ברירת מחדל</span>
              <select
                value={draft.defaultLanguage}
                onChange={(e) => setDraft({ ...draft, defaultLanguage: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
              >
                <option value="he">עברית</option>
                <option value="en">אנגלית</option>
              </select>
              <span className="mt-1 block text-xs text-gray-500">
                המבקר תמיד יכול להחליף שפה בעצמו.
              </span>
            </label>
          </section>

          <LinkPanel gallery={data} onChanged={load} onError={setError} />

          <section className="rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">מה מותר למי שנכנס בקישור</h2>
            <p className="mt-1 text-sm text-gray-500">
              ההרשאות נאכפות בשרת, לא רק בהסתרת כפתורים.
            </p>
            <div className="mt-4 space-y-3">
              {PERMISSION_ROWS.map((row) => (
                <label key={row.key} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!!draft.permissions[row.key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        permissions: { ...draft.permissions, [row.key]: e.target.checked },
                      })
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">{row.label}</span>
                    <span className="block text-xs leading-relaxed text-gray-500">{row.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>

      {captionFor && (
        <CaptionDialog
          galleryId={id}
          media={captionFor}
          onClose={() => setCaptionFor(null)}
          onSaved={load}
        />
      )}
    </SettingsShell>
  );
}
