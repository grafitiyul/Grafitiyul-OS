import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createGalleryUploader, getGalleryUploader } from '../lib/galleryUpload.js';
import GalleryGrid from '../gallery/GalleryGrid.jsx';
import GalleryLightbox from '../gallery/GalleryLightbox.jsx';
import UploadQueuePanel from '../gallery/UploadQueuePanel.jsx';

// Guide Portal → one tour's gallery. MOBILE-FIRST: guides shoot on phones and
// upload big real-world batches over unstable connections — the huge upload
// button is the hero, the queue survives navigation (module-registry
// uploader), every failure retries per file. Delete/cover/share appear only
// when the server says so (and are enforced server-side regardless).

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* not json */
    }
    const err = new Error(payload?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

export default function GuideTourGallery() {
  const { token, tourEventId } = useParams();
  const base = `/api/portal/${encodeURIComponent(token)}/tours/${encodeURIComponent(tourEventId)}/gallery`;

  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | error | blocked
  const [selected, setSelected] = useState(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [queueSnap, setQueueSnap] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);

  const uploader = useMemo(
    () =>
      getGalleryUploader(`guide:${tourEventId}`, () =>
        createGalleryUploader({
          endpoints: {
            initiate: (files) =>
              jsonFetch(`${base}/uploads`, { method: 'POST', body: JSON.stringify({ files }) }),
            urls: (mediaId, body) =>
              jsonFetch(`${base}/uploads/${mediaId}/urls`, {
                method: 'POST',
                body: JSON.stringify(body || {}),
              }),
            complete: (mediaId, body) =>
              jsonFetch(`${base}/uploads/${mediaId}/complete`, {
                method: 'POST',
                body: JSON.stringify(body || {}),
              }),
            abort: (mediaId) => jsonFetch(`${base}/uploads/${mediaId}/abort`, { method: 'POST', body: '{}' }),
          },
        }),
      ),
    [base, tourEventId],
  );

  const load = useCallback(async () => {
    try {
      setData(await jsonFetch(base));
      setPhase('ready');
    } catch (e) {
      setPhase(e.status === 403 || e.status === 404 ? 'blocked' : 'error');
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const doneRef = useRef(0);
  useEffect(() => {
    let timer = null;
    const unsub = uploader.subscribe((snap) => {
      setQueueSnap(snap);
      if ((snap.totals.done || 0) !== doneRef.current) {
        doneRef.current = snap.totals.done || 0;
        clearTimeout(timer);
        timer = setTimeout(load, 600);
      }
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [uploader, load]);

  const media = data?.media || [];
  const perms = data?.permissions || {};

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteMedia(ids) {
    if (!ids.length) return;
    const label = ids.length === 1 ? 'פריט אחד' : `${ids.length} פריטים`;
    if (!window.confirm(`למחוק ${label}? הקבצים יימחקו לצמיתות.`)) return;
    try {
      await jsonFetch(`${base}/media/delete`, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      setSelected(new Set());
      setLightboxIndex(null);
      load();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }
  const deleteSelected = () => deleteMedia([...selected]);

  async function setCover(mediaId) {
    try {
      await jsonFetch(`${base}/cover`, { method: 'PUT', body: JSON.stringify({ mediaId }) });
      load();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  async function copyCustomerLink() {
    try {
      let t = data?.linkToken;
      if (!t) {
        const out = await jsonFetch(`${base}/link`, { method: 'POST', body: '{}' });
        t = out.token;
      }
      await navigator.clipboard.writeText(`${window.location.origin}/g/${t}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (!data?.linkToken) load();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  if (phase === 'loading') {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
        טוען…
      </div>
    );
  }
  if (phase !== 'ready') {
    return (
      <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
        <div className="text-3xl" aria-hidden>🔒</div>
        <p className="text-[14px] text-gray-600">
          {phase === 'blocked' ? 'הגלריה אינה זמינה — ייתכן שאינך משובץ לסיור זה.' : 'שגיאה בטעינת הגלריה.'}
        </p>
        <Link
          to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(tourEventId)}`}
          className="text-[13px] font-semibold text-blue-700"
        >
          ← חזרה לסיור
        </Link>
      </div>
    );
  }

  const lightboxMedia = lightboxIndex != null ? media[lightboxIndex] : null;
  const canUpload = data.tourStatus !== 'cancelled';

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 pb-28">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-3 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          <Link
            to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(tourEventId)}`}
            aria-label="חזרה לסיור"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100"
          >
            →
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold text-gray-900">{data.title}</h1>
            <div className="text-[11.5px] text-gray-500">
              {fmtDate(data.date)} · <span dir="ltr" className="tabular-nums">{data.startTime}</span>
              {media.length > 0 && ` · ${media.length} פריטים`}
            </div>
          </div>
          {perms.canShareCustomerLink && canUpload && (
            <button
              type="button"
              onClick={copyCustomerLink}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 active:bg-gray-100"
            >
              {copied ? '✓ הועתק' : '🔗 קישור ללקוח'}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-3 py-4">
        {/* Selection toolbar */}
        {selected.size > 0 && (
          <div className="sticky top-14 z-10 mb-3 flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
            <span className="text-[13px] font-semibold text-blue-800">{selected.size} נבחרו</span>
            <div className="flex items-center gap-1.5">
              {perms.canDelete && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-red-600 active:bg-red-50"
                >
                  🗑 מחיקה
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-lg px-2 py-1 text-[12px] font-semibold text-blue-700"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        <GalleryGrid
          media={media}
          coverMediaId={data.coverMediaId}
          selectable={perms.canDelete}
          selected={selected}
          onToggleSelect={toggleSelect}
          onOpen={(i) => setLightboxIndex(i)}
          emptyText={canUpload ? 'עדיין אין מדיה מהסיור — התחילו להעלות!' : 'אין מדיה בגלריה'}
        />

        {/* Upload queue */}
        {queueSnap?.totals?.total > 0 && (
          <div className="mt-3">
            <UploadQueuePanel snapshot={queueSnap} uploader={uploader} />
          </div>
        )}
      </main>

      {/* Hero upload action — fixed bottom, thumb-reach on phones. */}
      {canUpload && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-blue-600/25 active:bg-blue-700"
            >
              📷 העלאת תמונות וסרטונים
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploader.addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {lightboxMedia && (
        <GalleryLightbox
          media={media}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          actions={
            <>
              <a
                href={`${base}/media/${lightboxMedia.id}/download`}
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/20"
              >
                ⬇
              </a>
              {perms.canSetCover && (
                <button
                  type="button"
                  onClick={() => setCover(lightboxMedia.id)}
                  className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/20"
                >
                  ★
                </button>
              )}
              {perms.canDelete && (
                <button
                  type="button"
                  onClick={() => deleteMedia([lightboxMedia.id])}
                  className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-red-300 hover:bg-red-500/30"
                >
                  🗑
                </button>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
