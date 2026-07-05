import { useEffect, useState } from 'react';

// Media block inside a message bubble — the full experience, honest about
// every lifecycle state the bridge records:
//   stored    → playable/viewable: image (click = lightbox), video (inline
//               player), voice/audio (inline player), document (open card)
//   pending   → the bridge is still downloading; embedded thumbnail + label
//   failed    → download failed (media may have expired on WhatsApp's side)
//   expired   → history-synced message whose media is no longer fetchable
//   too_large → over the configured cap; honest label with size
//   disabled  → media storage not configured on the bridge
// Files are served ONLY via the admin-authed GOS endpoint, which redirects to
// a short-lived presigned URL — nothing here touches storage directly.

function fmtBytes(n) {
  if (!n && n !== 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaUrl(m) {
  return `/api/whatsapp/messages/${m.id}/media`;
}

function Thumb({ media, className }) {
  if (!media.thumbBase64) return null;
  return <img src={`data:image/jpeg;base64,${media.thumbBase64}`} alt="" className={className} />;
}

// Full-screen image viewer. ESC / click anywhere closes.
function Lightbox({ src, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        type="button"
        onClick={onClose}
        aria-label="סגירה"
        className="absolute top-4 left-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/30"
      >
        ×
      </button>
    </div>
  );
}

function Placeholder({ icon, title, subtitle, media }) {
  return (
    <div className="relative mb-1 flex min-w-[180px] items-center gap-2.5 rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2.5 overflow-hidden">
      {media?.thumbBase64 && (
        <Thumb media={media} className="absolute inset-0 h-full w-full object-cover opacity-20 blur-[2px]" />
      )}
      <span className="relative text-xl leading-none">{icon}</span>
      <div className="relative min-w-0">
        <p className="text-[13px] font-medium text-gray-700">{title}</p>
        {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

const DOC_ICON = '📄';

export default function MessageMedia({ message: m, typeLabel }) {
  const [lightbox, setLightbox] = useState(false);
  const media = m.media;
  if (!media) return null;

  if (media.status === 'stored') {
    if (m.messageType === 'image' || m.messageType === 'sticker') {
      const sticker = m.messageType === 'sticker';
      return (
        <>
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="mb-1 block overflow-hidden rounded-xl focus:outline-none"
            title="הצגה בגודל מלא"
          >
            <img
              src={mediaUrl(m)}
              alt={typeLabel}
              loading="lazy"
              className={`${sticker ? 'max-h-36' : 'max-h-72'} w-auto max-w-full rounded-xl object-contain`}
            />
          </button>
          {lightbox && <Lightbox src={mediaUrl(m)} onClose={() => setLightbox(false)} />}
        </>
      );
    }
    if (m.messageType === 'video') {
      return (
        <video
          controls
          preload="none"
          src={mediaUrl(m)}
          poster={media.thumbBase64 ? `data:image/jpeg;base64,${media.thumbBase64}` : undefined}
          className="mb-1 max-h-72 w-full max-w-[320px] rounded-xl bg-black"
        />
      );
    }
    if (m.messageType === 'audio') {
      return (
        <div className="mb-1 min-w-[220px]">
          <audio controls preload="none" src={mediaUrl(m)} className="h-10 w-full" />
        </div>
      );
    }
    // document (and any other stored type) — open/download card
    return (
      <a
        href={mediaUrl(m)}
        target="_blank"
        rel="noreferrer"
        className="mb-1 flex min-w-[200px] items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 hover:bg-gray-100"
      >
        <span className="text-xl leading-none">{DOC_ICON}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-gray-800" dir="auto">
            {media.originalName || typeLabel}
          </p>
          <p className="text-[11px] text-gray-500" dir="ltr">
            {[fmtBytes(media.sizeBytes), media.mimeType].filter(Boolean).join(' · ')}
          </p>
        </div>
      </a>
    );
  }

  if (media.status === 'pending') {
    return <Placeholder icon="⏳" title={`${typeLabel} — מוריד…`} subtitle="הקובץ יופיע כאן בעוד רגע" media={media} />;
  }
  if (media.status === 'too_large') {
    return (
      <Placeholder
        icon="⚠️"
        title={`${typeLabel} — קובץ גדול מדי`}
        subtitle={fmtBytes(media.sizeBytes) ? `${fmtBytes(media.sizeBytes)} — מעל הגודל שהמערכת שומרת` : 'מעל הגודל שהמערכת שומרת'}
        media={media}
      />
    );
  }
  if (media.status === 'expired') {
    return <Placeholder icon="🕓" title={`${typeLabel} — לא זמין`} subtitle="הודעה ישנה — הקובץ כבר לא זמין להורדה" media={media} />;
  }
  if (media.status === 'disabled') {
    return <Placeholder icon="📁" title={typeLabel} subtitle="שמירת מדיה אינה מופעלת במערכת" media={media} />;
  }
  // failed (or anything unknown) — honest, with the thumbnail if we have one
  return <Placeholder icon="⚠️" title={`${typeLabel} — לא נשמר`} subtitle="הורדת הקובץ נכשלה" media={media} />;
}
