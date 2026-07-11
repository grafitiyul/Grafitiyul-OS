import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createGalleryUploader, getGalleryUploader } from '../lib/galleryUpload.js';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryLightbox from './GalleryLightbox.jsx';
import UploadQueuePanel from './UploadQueuePanel.jsx';
import DownloadAllButton from './DownloadAllButton.jsx';

// PUBLIC customer gallery — /g/:token. Design direction (2026-07 redesign):
// light, clean, photos-first. A COMPACT header (subtle branding, tour title,
// date, count) with the two primary actions right under it — upload and
// download-all — then the grid starts immediately. No oversized hero, no dark
// canvas; the media itself is the visual hero. Mobile keeps a floating upload
// pill once the header scrolls away. Permissions/security are untouched: the
// token is the credential, customers can never delete or manage anything.

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
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

function CenteredNote({ emoji, title, sub }) {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
      <div className="text-4xl" aria-hidden>{emoji}</div>
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      {sub && <p className="max-w-sm text-[14px] leading-relaxed text-gray-500">{sub}</p>}
    </div>
  );
}

export default function CustomerGalleryPage() {
  const { token } = useParams();
  const base = `/api/gallery/${encodeURIComponent(token)}`;

  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | gone | error
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [queueSnap, setQueueSnap] = useState(null);
  const [headerAway, setHeaderAway] = useState(false);
  const fileInputRef = useRef(null);
  const actionsRef = useRef(null);

  const uploader = useMemo(
    () =>
      getGalleryUploader(`customer:${token}`, () =>
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
            abort: (mediaId) =>
              jsonFetch(`${base}/uploads/${mediaId}/abort`, { method: 'POST', body: '{}' }),
          },
        }),
      ),
    [base, token],
  );

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch(base);
      setData(d);
      setPhase('ready');
      document.title = `${d.title} · גרפיטיול`;
    } catch (e) {
      setPhase(e.status === 404 ? 'gone' : 'error');
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  // Customer uploads appear immediately — refresh as files finish.
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

  // Floating upload pill appears once the header actions scroll out of view
  // (mobile-reachability: the primary action is never more than a thumb away).
  useEffect(() => {
    const el = actionsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(([entry]) => setHeaderAway(!entry.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, [phase]);

  if (phase === 'loading') {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" aria-hidden />
          <span className="text-[13px] text-gray-400">טוען את הגלריה…</span>
        </div>
      </div>
    );
  }
  if (phase === 'gone') {
    return (
      <CenteredNote
        emoji="🔍"
        title="הגלריה אינה זמינה"
        sub="ייתכן שהקישור הוחלף או שהגלריה הוסרה. פנו אלינו לקבלת קישור מעודכן."
      />
    );
  }
  if (phase === 'error') {
    return <CenteredNote emoji="⚠️" title="שגיאה בטעינת הגלריה" sub="נסו לרענן את העמוד." />;
  }

  const media = data.media || [];
  const lightboxMedia = lightboxIndex != null ? media[lightboxIndex] : null;
  const hasMedia = media.length > 0;

  const uploadButton = (extra = '') => (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:bg-gray-700 active:scale-[0.98] ${extra}`}
    >
      📷 העלאת תמונות וסרטונים
    </button>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">
      {/* Compact header — branding is quiet, the tour is the headline. */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 pb-5 pt-6 sm:px-6">
          <div className="text-[11px] font-bold tracking-[0.3em] text-gray-400">גרפיטיול</div>
          <h1 className="mt-1.5 text-[22px] font-black leading-tight tracking-tight text-gray-900 sm:text-[26px]">
            {data.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-gray-500">
            {data.date && <span>{fmtDate(data.date)}</span>}
            {hasMedia && (
              <>
                <span className="text-gray-300">·</span>
                <span>{media.length} תמונות וסרטונים</span>
              </>
            )}
            {data.brandingText && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{data.brandingText}</span>
              </>
            )}
          </div>

          {/* Primary actions — always visible at the top, never buried. */}
          <div ref={actionsRef} className="mt-4 flex flex-wrap items-center gap-2">
            {data.canUpload && uploadButton()}
            {hasMedia && (
              <DownloadAllButton
                className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-[13.5px] font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                endpoints={{
                  request: () => jsonFetch(`${base}/export`, { method: 'POST', body: '{}' }),
                  status: (id) => jsonFetch(`${base}/export/${id}`),
                  downloadHref: (id) => `${base}/export/${id}/download`,
                }}
              />
            )}
          </div>
        </div>
      </header>

      {/* Body — the grid starts right away; media is the hero. */}
      <main className="mx-auto max-w-6xl px-3 pb-24 pt-4 sm:px-5 sm:pt-5">
        {queueSnap?.totals?.total > 0 && (
          <div className="mb-4">
            <UploadQueuePanel snapshot={queueSnap} uploader={uploader} />
          </div>
        )}

        {!hasMedia ? (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
            <div className="text-3xl" aria-hidden>🖼️</div>
            <h2 className="mt-3 text-[16px] font-bold text-gray-900">הגלריה עדיין ריקה</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-500">
              התמונות והסרטונים מהסיור יופיעו כאן.
              {data.canUpload && ' יש לכם תמונות משלכם? הוסיפו אותן עכשיו.'}
            </p>
            {data.canUpload && <div className="mt-5">{uploadButton()}</div>}
          </div>
        ) : (
          <GalleryGrid media={media} onOpen={(i) => setLightboxIndex(i)} />
        )}
      </main>

      <footer className="border-t border-gray-200 py-5 text-center text-[12px] text-gray-400">
        גרפיטיול · סיורי גרפיטי ואמנות רחוב
      </footer>

      {/* Floating upload pill — appears when the header actions scroll away. */}
      {data.canUpload && hasMedia && headerAway && (
        <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-3 text-[14px] font-bold text-white shadow-xl shadow-gray-900/20 active:scale-[0.98]"
          >
            📷 העלאת תמונות
          </button>
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
            <a
              href={`${base}/media/${lightboxMedia.id}/download`}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/20"
            >
              ⬇ הורדה
            </a>
          }
        />
      )}
    </div>
  );
}
