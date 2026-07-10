import { formatDuration } from './galleryFormat.js';

// Shared media grid — photos and videos together, thumbs only (originals load
// exclusively in the lightbox). Native lazy loading keeps huge galleries
// cheap; cells without a thumb (e.g. HEIC on a non-Safari uploader) render a
// quiet placeholder but stay fully viewable/downloadable.
//
// Selection is optional: pass selectable + selected(Set) + onToggleSelect to
// get the check-circle overlay (staff/guide surfaces). Customers never see it.

function CheckCircle({ on }) {
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[13px] font-bold transition ${
        on
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-white/80 bg-black/25 text-transparent hover:bg-black/40'
      }`}
    >
      ✓
    </span>
  );
}

export default function GalleryGrid({
  media,
  onOpen,
  selectable = false,
  selected = null,
  onToggleSelect = null,
  coverMediaId = null,
  emptyText = 'אין עדיין תמונות או סרטונים',
}) {
  if (!media || media.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-14 text-center">
        <div className="text-3xl" aria-hidden>🖼️</div>
        <p className="mt-2 text-[13.5px] text-gray-400">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-2">
      {media.map((m, i) => {
        const isSelected = selectable && selected?.has(m.id);
        const thumb = m.thumbUrl || m.posterUrl;
        return (
          <button
            key={m.id}
            type="button"
            onClick={(e) => {
              if (selectable && (selected?.size > 0 || e.ctrlKey || e.metaKey)) {
                onToggleSelect?.(m.id);
              } else {
                onOpen?.(i);
              }
            }}
            className={`group relative aspect-square overflow-hidden rounded-xl bg-gray-100 outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
              isSelected ? 'ring-2 ring-blue-600 ring-offset-2' : ''
            }`}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={m.originalFileName || ''}
                loading="lazy"
                className={`h-full w-full object-cover transition duration-200 group-hover:scale-[1.04] ${
                  isSelected ? 'scale-[0.94] rounded-lg' : ''
                }`}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-3xl text-gray-300">
                {m.mediaType === 'video' ? '🎬' : '🖼️'}
              </span>
            )}

            {m.mediaType === 'video' && (
              <>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-[16px] text-white backdrop-blur-sm transition group-hover:bg-black/60">
                    ▶
                  </span>
                </span>
                {m.durationSeconds > 0 && (
                  <span
                    dir="ltr"
                    className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-white"
                  >
                    {formatDuration(m.durationSeconds)}
                  </span>
                )}
              </>
            )}

            {coverMediaId === m.id && (
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-amber-400/95 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-950 shadow-sm">
                ★ קאבר
              </span>
            )}

            {selectable && (
              <span
                role="checkbox"
                aria-checked={!!isSelected}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect?.(m.id);
                }}
                className={`absolute top-1.5 right-1.5 transition ${
                  isSelected || selected?.size > 0
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <CheckCircle on={isSelected} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
