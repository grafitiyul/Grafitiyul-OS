import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createGalleryUploader, getGalleryUploader } from '../lib/galleryUpload.js';
import GalleryGrid from './GalleryGrid.jsx';
import GalleryLightbox from './GalleryLightbox.jsx';
import UploadQueuePanel from './UploadQueuePanel.jsx';
import DownloadAllButton from './DownloadAllButton.jsx';
import GrafitiyulHeroLogo from '../quote/GrafitiyulHeroLogo.jsx';
import Icon, { WhatsAppGlyph } from '../public/components/Icon.jsx';

// PUBLIC customer gallery — /g/:token. Design direction (2026-07 polish):
// premium, minimal, branded — photos are the hero. A slim dark-navy brand
// band carries the official white Grafitiyul lockup (GrafitiyulHeroLogo, the
// shared SVG brand mark); below it, on white: the tour headline
// (product · organization-or-customer), ONE metadata row (count · time ·
// date · location), a soft tour-kind chip, and the two actions with a clear
// hierarchy (brand-teal upload dominates; ZIP download is a quiet outline).
// The grid starts immediately after. Footer is a contact block ("להזמנת
// פעילויות דומות") with clickable WhatsApp / email / site. Mobile keeps a
// floating upload pill once the header scrolls away. Permissions/security
// are untouched: the token is the credential, customers never delete/manage.

const BRAND_TEAL = '#10a99b';
const BRAND_NAVY = '#1b2540';

const KIND_LABELS = { private: 'פרטי', business: 'עסקי', group_slot: 'קבוצתי' };

const CONTACT = {
  whatsappDisplay: '055-6638970',
  whatsappHref: 'https://wa.me/972556638970',
  email: 'info@grafitiyul.co.il',
  site: 'grafitiyul.co.il',
  siteHref: 'https://grafitiyul.co.il',
};

function PhotosIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M3 16.5 8 12l4 3.5 3.5-3L21 16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadCloudIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden>
      <path d="M7 17a4.5 4.5 0 0 1-.4-8.98 6 6 0 0 1 11.6 1.6A3.7 3.7 0 0 1 17.5 17" strokeLinecap="round" />
      <path d="M12 20v-7m0 0-3 3m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

  // Headline per product rule: organization name when one exists, otherwise
  // the customer's name (customerLabel resolves that server-side).
  const headline = [data.productName || data.title, data.customerLabel]
    .filter(Boolean)
    .join(' · ');
  const kindLabel = KIND_LABELS[data.kind] || null;

  const metaParts = [
    hasMedia && {
      key: 'count',
      icon: <PhotosIcon className="h-4 w-4" />,
      text: `${media.length} תמונות וסרטונים`,
    },
    data.startTime && {
      key: 'time',
      icon: <Icon name="clock" className="h-4 w-4" />,
      text: data.startTime,
      ltr: true,
    },
    data.date && {
      key: 'date',
      icon: <Icon name="calendar" className="h-4 w-4" />,
      text: fmtDate(data.date),
      ltr: true,
    },
    data.locationName && {
      key: 'loc',
      icon: <Icon name="pin" className="h-4 w-4" />,
      text: data.locationName,
    },
  ].filter(Boolean);

  const uploadButton = (extra = '') => (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      style={{ backgroundColor: BRAND_TEAL }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3 text-[15px] font-bold text-white shadow-md shadow-teal-900/10 transition hover:brightness-95 active:scale-[0.98] ${extra}`}
    >
      <UploadCloudIcon className="h-5 w-5" />
      העלאת תמונות וסרטונים
    </button>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">
      {/* Brand band — slim, dark navy, the official white lockup. Part of the
          brand, not a hero: the page's real content starts right below. */}
      <div
        className="flex justify-center px-4 py-5 sm:py-6"
        style={{ background: `linear-gradient(180deg, #141b2d 0%, ${BRAND_NAVY} 100%)` }}
      >
        <GrafitiyulHeroLogo height={56} title="גרפיטיול" />
      </div>

      {/* Header — tour headline + ONE metadata row + actions. */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-7 text-center sm:px-6">
          <h1 className="text-[23px] font-black leading-tight tracking-tight text-gray-900 sm:text-[27px]">
            {headline}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[13.5px] text-gray-500">
            {metaParts.map((p, i) => (
              <span key={p.key} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="me-2 text-gray-200">|</span>}
                <span className="text-gray-400">{p.icon}</span>
                <span dir={p.ltr ? 'ltr' : undefined} className={p.ltr ? 'tabular-nums' : ''}>
                  {p.text}
                </span>
              </span>
            ))}
          </div>

          {(kindLabel || data.brandingText) && (
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 text-[12.5px]">
              {kindLabel && (
                <span className="rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-700">
                  {kindLabel}
                </span>
              )}
              {data.brandingText && <span className="text-gray-400">{data.brandingText}</span>}
            </div>
          )}

          {/* Actions — the upload is the star; download is the quiet option. */}
          <div ref={actionsRef} className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {data.canUpload && uploadButton()}
            {hasMedia && (
              <DownloadAllButton
                className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-[13.5px] font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-60"
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

      {/* Footer — quiet brand block + real contact actions, all clickable. */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 sm:px-6">
          <GrafitiyulHeroLogo height={44} color={BRAND_NAVY} title="גרפיטיול" />
          <div className="text-[14px] font-semibold text-gray-700">להזמנת פעילויות דומות:</div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-0">
            <a
              href={CONTACT.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] font-medium text-gray-700 transition hover:text-gray-900"
            >
              <WhatsAppGlyph className="h-5 w-5 text-[#25d366]" />
              <span dir="ltr" className="tabular-nums">{CONTACT.whatsappDisplay}</span>
            </a>
            <span className="hidden px-5 text-gray-200 sm:inline">|</span>
            <a
              href={`mailto:${CONTACT.email}`}
              className="inline-flex items-center gap-2 text-[14px] font-medium text-gray-700 transition hover:text-gray-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 text-gray-400" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span dir="ltr">{CONTACT.email}</span>
            </a>
            <span className="hidden px-5 text-gray-200 sm:inline">|</span>
            <a
              href={CONTACT.siteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] font-medium text-gray-700 transition hover:text-gray-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 text-gray-400" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3Z" />
              </svg>
              <span dir="ltr">{CONTACT.site}</span>
            </a>
          </div>
          <div className="text-[12px] text-gray-400">גרפיטיול · סיורי גרפיטי ואמנות רחוב</div>
        </div>
      </footer>

      {/* Floating upload pill — appears when the header actions scroll away. */}
      {data.canUpload && hasMedia && headerAway && (
        <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ backgroundColor: BRAND_TEAL }}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-bold text-white shadow-xl shadow-teal-900/25 active:scale-[0.98]"
          >
            <UploadCloudIcon className="h-5 w-5" />
            העלאת תמונות
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
