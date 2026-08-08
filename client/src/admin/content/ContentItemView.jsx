import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import BilingualField from '../common/BilingualField.jsx';
import {
  CONTENT_TYPE_LABELS,
  contentTypeLabel,
  sourceLabel,
  storageStrategyLabel,
  TRANSCRIPT_LABELS,
  fmtBytes,
  fmtDuration,
  reasonText,
  typeGlyph,
} from './contentLabels.js';

// One content item. Player/preview on the left, everything that describes it on
// the right, transcript underneath — the order an operator actually works in.

function Player({ playback, media }) {
  if (!playback || playback.mode === 'unavailable') {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-500">
        {reasonText(playback?.reason) || 'אין תצוגה מקדימה'}
      </div>
    );
  }
  if (playback.mode === 'embed') {
    return (
      <div className="aspect-video overflow-hidden rounded-xl bg-black">
        <iframe
          src={playback.embedUrl}
          title="נגן"
          className="h-full w-full"
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  if (media?.mediaType === 'audio') {
    return (
      <div className="rounded-xl bg-gray-50 p-6">
        <audio controls src={playback.url} className="w-full" />
      </div>
    );
  }
  if (media?.mediaType === 'image') {
    return (
      <img src={playback.url} alt={media.originalFileName} className="w-full rounded-xl object-contain" />
    );
  }
  return (
    <div className="aspect-video overflow-hidden rounded-xl bg-black">
      {/* Range requests are served by R2 directly from the presigned URL, so a
          large video streams instead of downloading in full before playing. */}
      <video controls preload="metadata" src={playback.url} className="h-full w-full" />
    </div>
  );
}

function TranscriptPanel({ item, onChanged }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const t = item.transcript;
  const state = item.transcriptState;
  const tx = item.transcription || {};

  async function transcribe() {
    setBusy(true);
    setError(null);
    try {
      await api.contentLibrary.transcribe(item.id);
      await onChanged();
    } catch (e) {
      setError(reasonText(e?.payload?.error) || 'ההפעלה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const chip = TRANSCRIPT_LABELS[state?.status] || TRANSCRIPT_LABELS.not_started;

  return (
    <section className="rounded-2xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold text-gray-900">תמלול</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${chip.className}`}>{chip.label}</span>
        <div className="ms-auto flex gap-2">
          {t && (
            <button
              onClick={() => {
                navigator.clipboard?.writeText(t.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              {copied ? 'הועתק' : 'העתק תמלול'}
            </button>
          )}
          {tx.canTranscribe && (
            <button
              onClick={transcribe}
              disabled={busy || state?.status === 'queued' || state?.status === 'processing'}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t ? 'תמלל מחדש' : 'תמלל'}
            </button>
          )}
        </div>
      </div>

      {/* Honest unavailability: the button is absent AND the reason is stated. */}
      {!tx.canTranscribe && tx.blockedReason && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {reasonText(tx.blockedReason)}
        </p>
      )}
      {state?.status === 'failed' && state.error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {reasonText(state.error) || state.error}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {t ? (
        <>
          <p className="mt-3 text-xs text-gray-500">
            נוצר {new Date(t.generatedAt).toLocaleString('he-IL')} · {t.provider} · {t.model}
            {t.language ? ` · ${t.language}` : ''}
          </p>
          <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-[15px] leading-relaxed text-gray-800">
            {t.text}
          </div>
        </>
      ) : (
        state?.status !== 'queued' &&
        state?.status !== 'processing' && (
          <p className="mt-3 text-sm text-gray-500">אין עדיין תמלול לפריט הזה.</p>
        )
      )}

      {item.transcriptHistory?.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            גרסאות קודמות ({item.transcriptHistory.length})
          </summary>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {item.transcriptHistory.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 text-gray-600">
                  {new Date(h.generatedAt).toLocaleString('he-IL')} · {h.model}
                </span>
                <button
                  onClick={async () => {
                    await api.contentLibrary.restoreTranscript(item.id, h.id);
                    await onChanged();
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  שחזר כנוכחי
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            תמלול מחדש לא מוחק את הקודם — הוא נשמר כאן כדי שאפשר יהיה להשוות ולחזור אחורה.
          </p>
        </details>
      )}
    </section>
  );
}

export default function ContentItemView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [meta, setMeta] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [it, m] = await Promise.all([
        api.contentLibrary.getItem(id),
        meta ? Promise.resolve(meta) : api.contentLibrary.meta(),
      ]);
      setItem(it);
      setMeta(m);
      setDraft({
        internalName: it.internalName,
        description: it.description || '',
        language: it.language || '',
        publicTitleHe: it.publicTitleHe || '',
        publicTitleEn: it.publicTitleEn || '',
        publicDescriptionHe: it.publicDescriptionHe || '',
        publicDescriptionEn: it.publicDescriptionEn || '',
        categoryIds: it.categories.map((c) => c.id),
        workspaceIds: it.workspaces.map((w) => w.id),
      });
      setError(null);
      return it;
    } catch (e) {
      setError(e?.payload?.error || 'טעינה נכשלה');
      return null;
    }
  }, [id, meta]);

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a transcription job is live, poll — the worker runs out of band and
  // the operator should see it land without refreshing.
  useEffect(() => {
    const s = item?.transcriptState?.status;
    const live = s === 'queued' || s === 'processing';
    clearInterval(pollRef.current);
    if (live) pollRef.current = setInterval(load, 10_000);
    return () => clearInterval(pollRef.current);
  }, [item?.transcriptState?.status, load]);

  async function save() {
    setSaving(true);
    try {
      await api.contentLibrary.updateItem(id, {
        ...draft,
        language: draft.language || null,
      });
      await load();
    } catch (e) {
      setError(e?.payload?.error || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  if (error && !item) {
    return (
      <div dir="rtl" className="px-5 py-8 lg:px-10">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!item || !draft) {
    return (
      <div dir="rtl" className="px-5 py-8 lg:px-10">
        <p className="text-sm text-gray-500">טוען…</p>
      </div>
    );
  }

  const m = item.media;

  return (
    <div dir="rtl" className="px-5 py-8 lg:px-10 lg:py-10 max-w-[1500px] mx-auto">
      <header className="mb-6">
        <Link to="/admin/content-library" className="text-sm text-gray-500 hover:text-gray-900">
          → ספריית תוכן
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            <span className="me-2">{typeGlyph(item.contentType)}</span>
            {item.internalName}
          </h1>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await api.contentLibrary.setItemArchived(id, !item.archived);
                load();
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {item.archived ? 'הוצא מארכיון' : 'העבר לארכיון'}
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('למחוק את הפריט מהספרייה?')) return;
                const res = await api.contentLibrary.deleteItem(id, { deleteAsset: true });
                if (!res.assetDeleted && res.stillReferencedBy?.length) {
                  window.alert('הפריט נמחק, אך הקובץ עצמו נשמר — הוא בשימוש במקום נוסף במערכת.');
                }
                navigate('/admin/content-library');
              }}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              מחק
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? 'שומר…' : 'שמור'}
            </button>
          </div>
        </div>
        {item.archived && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            הפריט בארכיון — הוא לא מופיע ברשימה הרגילה, אך כל ההפניות אליו נשמרות.
          </p>
        )}
      </header>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Player playback={item.playback} media={m} />
          <TranscriptPanel item={item} onChanged={load} />
        </div>

        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">פרטים</h2>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">שם פנימי</span>
              <input
                value={draft.internalName}
                onChange={(e) => setDraft({ ...draft, internalName: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">הערות פנימיות</span>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:border-gray-900 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">שפת התוכן</span>
              <select
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px]"
              >
                <option value="">לא צוין</option>
                <option value="he">עברית</option>
                <option value="en">אנגלית</option>
              </select>
              <span className="mt-1 block text-xs text-gray-500">משמש גם כרמז לתמלול.</span>
            </label>
          </section>

          {/* Customer/consumer-facing text. Separate from the internal fields
              above on purpose: these are the only ones that ever leave GOS
              (the Content API serves them to Challenge / Recruitment), so they
              are a real He/En pair with the shared translate action. */}
          <section className="rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">טקסט ללקוח / למערכות אחרות</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              רק הטקסט הזה נחשף החוצה. ההערות הפנימיות למעלה נשארות בתוך GOS.
            </p>
            <div className="mt-4 space-y-4">
              <BilingualField
                label="כותרת"
                he={draft.publicTitleHe}
                en={draft.publicTitleEn}
                onHe={(v) => setDraft({ ...draft, publicTitleHe: v })}
                onEn={(v) => setDraft({ ...draft, publicTitleEn: v })}
              />
              <BilingualField
                label="תיאור"
                render="textarea"
                rows={3}
                he={draft.publicDescriptionHe}
                en={draft.publicDescriptionEn}
                onHe={(v) => setDraft({ ...draft, publicDescriptionHe: v })}
                onEn={(v) => setDraft({ ...draft, publicDescriptionEn: v })}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">קטגוריות</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(meta?.categories || []).map((c) => {
                const on = draft.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        categoryIds: on
                          ? draft.categoryIds.filter((x) => x !== c.id)
                          : [...draft.categoryIds, c.id],
                      })
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      on ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
                    }`}
                  >
                    {c.nameHe}
                  </button>
                );
              })}
              {(meta?.categories || []).length === 0 && (
                <p className="text-sm text-gray-500">אין קטגוריות עדיין.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">גישה למערכות</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              מערכת שלא מסומנת כאן פשוט לא רואה את הפריט.
            </p>
            <div className="mt-3 space-y-2">
              {(meta?.workspaces || []).map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={draft.workspaceIds.includes(w.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        workspaceIds: e.target.checked
                          ? [...draft.workspaceIds, w.id]
                          : draft.workspaceIds.filter((x) => x !== w.id),
                      })
                    }
                  />
                  {w.name}
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 p-5">
            <h2 className="text-[15px] font-semibold text-gray-900">מקור ומדיה</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">סוג</dt>
                <dd className="text-gray-900">{contentTypeLabel(item.contentType)}</dd>
              </div>
              {m && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">מקור</dt>
                    <dd className="text-gray-900">{sourceLabel(m)}</dd>
                  </div>
                  {m.sourceTitle && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">כותרת במקור</dt>
                      <dd className="truncate text-gray-900" title={m.sourceTitle}>{m.sourceTitle}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">אחסון</dt>
                    <dd className="text-gray-900">{storageStrategyLabel(m.storageStrategy)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">אורך</dt>
                    <dd className="text-gray-900" dir="ltr">{fmtDuration(m.durationSeconds)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">גודל</dt>
                    <dd className="text-gray-900" dir="ltr">{fmtBytes(m.byteSize)}</dd>
                  </div>
                  {m.sourceUrl && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">קישור</dt>
                      <dd>
                        <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          פתח במקור
                        </a>
                      </dd>
                    </div>
                  )}
                  {m.mirroredAt && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">הועתק אלינו</dt>
                      <dd className="text-gray-900">{new Date(m.mirroredAt).toLocaleDateString('he-IL')}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            {item.playback?.downloadUrl && (
              <a
                href={item.playback.downloadUrl}
                className="mt-3 inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                הורד קובץ
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
