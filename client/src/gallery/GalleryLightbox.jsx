import { useCallback, useEffect, useState } from 'react';
import { formatBytes, uploaderLabel } from './galleryFormat.js';

// Fullscreen viewer shared by all gallery surfaces. Originals load HERE only
// (the grid never touches them). Keyboard: ←/→ navigate (RTL-aware), Esc
// closes. Touch: swipe left/right. `actions` lets each surface inject its own
// buttons (download always; staff/guide add cover/delete) while the customer
// page stays clean of any management control.

export default function GalleryLightbox({
  media,
  index,
  onClose,
  onNavigate,
  actions = null,
  showUploader = false,
}) {
  const m = media[index];
  const [touchStartX, setTouchStartX] = useState(null);

  const go = useCallback(
    (delta) => {
      const next = index + delta;
      if (next >= 0 && next < media.length) onNavigate(next);
    },
    [index, media.length, onNavigate],
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      // RTL: הקודם is to the RIGHT.
      else if (e.key === 'ArrowRight') go(-1);
      else if (e.key === 'ArrowLeft') go(1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!m) return null;

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={m.originalFileName || 'מדיה'}
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      onTouchStart={(e) => setTouchStartX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchStartX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
        if (Math.abs(dx) > 60) go(dx > 0 ? -1 : 1); // swipe follows RTL reading
        setTouchStartX(null);
      }}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 text-white/90">
          <div className="truncate text-[13px] font-medium">{m.originalFileName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/50">
            <span dir="ltr" className="tabular-nums">{index + 1} / {media.length}</span>
            {m.byteSize > 0 && <span dir="ltr">{formatBytes(m.byteSize)}</span>}
            {showUploader && uploaderLabel(m) && <span>העלה: {uploaderLabel(m)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-white/70 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Media area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3 sm:px-14">
        {m.mediaType === 'video' ? (
          <video
            key={m.id}
            src={m.viewUrl}
            poster={m.posterUrl || undefined}
            controls
            playsInline
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          <img
            key={m.id}
            src={m.viewUrl || m.thumbUrl}
            alt={m.originalFileName || ''}
            className="max-h-full max-w-full select-none rounded-lg object-contain"
            draggable={false}
          />
        )}

        {/* Desktop arrows — RTL: previous on the right, next on the left. */}
        {index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="הקודם"
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-xl text-white/80 backdrop-blur-sm hover:bg-white/20 sm:flex"
          >
            ›
          </button>
        )}
        {index < media.length - 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="הבא"
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-xl text-white/80 backdrop-blur-sm hover:bg-white/20 sm:flex"
          >
            ‹
          </button>
        )}
      </div>
    </div>
  );
}
