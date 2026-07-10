import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createGalleryUploader, getGalleryUploader } from '../lib/galleryUpload.js';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryLightbox from './GalleryLightbox.jsx';
import UploadQueuePanel from './UploadQueuePanel.jsx';
import DownloadAllButton from './DownloadAllButton.jsx';

// PUBLIC customer gallery — /g/:token. The visual standard here is a branded
// event gallery, not an admin screen: full-bleed cover hero, generous type,
// clean grid, smooth lightbox. Customers can view, add their own photos
// (appear immediately) and download — no management controls exist on this
// surface at all (and the server refuses them anyway).

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
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-950 px-6 text-center">
      <div className="text-4xl" aria-hidden>{emoji}</div>
      <h1 className="text-lg font-bold text-white">{title}</h1>
      {sub && <p className="max-w-sm text-[14px] leading-relaxed text-white/50">{sub}</p>}
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
  const fileInputRef = useRef(null);

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

  if (phase === 'loading') {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" aria-hidden />
          <span className="text-[13px] text-white/50">טוען את הגלריה…</span>
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

  return (
    <div dir="rtl" className="min-h-screen bg-gray-950">
      {/* Hero */}
      <header className="relative overflow-hidden">
        {data.coverUrl ? (
          <>
            <img
              src={data.coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-105 object-cover blur-[2px]"
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-b from-gray-950/40 via-gray-950/60 to-gray-950" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-950 via-gray-950 to-indigo-950" />
        )}
        <div className="relative mx-auto flex min-h-[42vh] max-w-5xl flex-col items-center justify-end px-5 pb-10 pt-16 text-center sm:min-h-[48vh]">
          <div className="text-[13px] font-bold tracking-[0.35em] text-white/60">GRAFITIYUL</div>
          <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
            {data.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13.5px] text-white/60">
            {data.date && <span>{fmtDate(data.date)}</span>}
            {media.length > 0 && (
              <>
                <span className="text-white/25">·</span>
                <span>{media.length} רגעים מהסיור</span>
              </>
            )}
          </div>
          {data.brandingText && (
            <p className="mt-2 text-[13px] text-white/45">{data.brandingText}</p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {data.canUpload && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-white px-6 py-2.5 text-[14px] font-bold text-gray-900 shadow-xl shadow-black/30 transition hover:bg-gray-100 active:scale-[0.98]"
              >
                📷 הוסיפו את התמונות שלכם
              </button>
            )}
            {media.length > 0 && (
              <DownloadAllButton
                className="rounded-full border border-white/25 bg-white/10 px-5 py-2.5 text-[13.5px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/20 disabled:opacity-70"
                endpoints={{
                  request: () =>
                    jsonFetch(`${base}/export`, { method: 'POST', body: '{}' }),
                  status: (id) => jsonFetch(`${base}/export/${id}`),
                  downloadHref: (id) => `${base}/export/${id}/download`,
                }}
              />
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-5xl px-3 pb-20 pt-6 sm:px-5">
        {queueSnap?.totals?.total > 0 && (
          <div className="mb-4">
            <UploadQueuePanel snapshot={queueSnap} uploader={uploader} />
          </div>
        )}

        {media.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-20 text-center">
            <div className="text-4xl" aria-hidden>✨</div>
            <h2 className="mt-3 text-[16px] font-bold text-white">הגלריה עוד מתמלאת</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/50">
              התמונות והסרטונים מהסיור יופיעו כאן ברגע שיועלו.
              {data.canUpload && ' יש לכם רגעים משלכם? העלו אותם עכשיו!'}
            </p>
          </div>
        ) : (
          <GalleryGrid media={media} onOpen={(i) => setLightboxIndex(i)} />
        )}
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-[12px] text-white/30">
        גרפיטיול · סיורי גרפיטי ואמנות רחוב
      </footer>

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
