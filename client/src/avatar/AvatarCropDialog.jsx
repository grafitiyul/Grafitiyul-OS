import { useCallback, useEffect, useRef, useState } from 'react';

// THE shared profile-photo crop tool — used by BOTH the admin person card
// and the Guide Portal (single implementation by product rule). Upload →
// drag to reposition → zoom → circular preview (large + avatar-size) →
// explicit save. Outputs a square WebP rendition plus normalized crop
// metadata ({x, y, zoom} in viewport units) so a later recrop can reopen the
// ORIGINAL image with the same framing — no re-upload needed.
//
// Pure component: no API calls. onSave(blob, crop) does the uploading.

const VIEW = 280; // css px of the crop viewport (square)
const OUT = 512; // output rendition size
const MAX_ZOOM = 4;

export default function AvatarCropDialog({
  open,
  src, // object URL or existing /api/media/:id URL of the ORIGINAL image
  initialCrop = null, // { x, y, zoom } from a previous crop (recrop flow)
  saving = false,
  onCancel,
  onSave, // (blob, crop) => void
  onPickNew = null, // (file) => void — "upload a different photo" inside the editor
  onRemove = null, // () => void — remove the current photo (confirmed inline)
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pickRef = useRef(null);
  const [img, setImg] = useState(null); // HTMLImageElement, loaded
  const [zoom, setZoom] = useState(initialCrop?.zoom || 1);
  // Offset of the image center from the viewport center, in css px.
  const [offset, setOffset] = useState({
    x: (initialCrop?.x || 0) * VIEW,
    y: (initialCrop?.y || 0) * VIEW,
  });
  const [error, setError] = useState(null);
  const drag = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!open || !src) return undefined;
    let alive = true;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      if (alive) setImg(el);
    };
    el.onerror = () => {
      if (alive) setError('טעינת התמונה נכשלה');
    };
    el.src = src;
    return () => {
      alive = false;
    };
  }, [open, src]);

  // Cover scale: at zoom=1 the image exactly covers the square viewport.
  const baseScale = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = baseScale * zoom;

  const clampOffset = useCallback(
    (o, z) => {
      if (!img) return o;
      const s = baseScale * z;
      const maxX = Math.max(0, (img.naturalWidth * s - VIEW) / 2);
      const maxY = Math.max(0, (img.naturalHeight * s - VIEW) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, o.x)),
        y: Math.min(maxY, Math.max(-maxY, o.y)),
      };
    },
    [img, baseScale],
  );

  // Re-clamp when zoom shrinks the pan range.
  useEffect(() => {
    setOffset((o) => clampOffset(o, zoom));
  }, [zoom, clampOffset]);

  // Draw both previews on every frame-worthy change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.save();
    ctx.translate(VIEW / 2 + offset.x, VIEW / 2 + offset.y);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [img, offset, scale]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setOffset(clampOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy }, zoom));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onWheel(e) {
    e.preventDefault();
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY > 0 ? 0.92 : 1.08))));
  }

  async function save() {
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext('2d');
    const f = OUT / VIEW;
    ctx.save();
    ctx.translate((VIEW / 2 + offset.x) * f, (VIEW / 2 + offset.y) * f);
    ctx.scale(scale * f, scale * f);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
    const blob = await new Promise((r) => out.toBlob(r, 'image/webp', 0.85));
    if (!blob) return setError('יצירת התמונה נכשלה');
    // Normalized crop — viewport-relative so any future viewport size works.
    onSave(blob, { x: offset.x / VIEW, y: offset.y / VIEW, zoom });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      dir="rtl"
      onClick={saving ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[15px] font-bold text-gray-900">מיקום התמונה</h2>

        <div className="flex flex-col items-center gap-3">
          {error ? (
            <div className="py-10 text-sm text-red-600">{error}</div>
          ) : !img ? (
            <div className="py-10 text-sm text-gray-400">טוען תמונה…</div>
          ) : (
            <>
              {/* Crop viewport — drag to reposition, wheel/slider to zoom.
                  The circular mask previews exactly what avatars show. */}
              <div
                className="relative touch-none select-none overflow-hidden rounded-xl bg-gray-900"
                style={{ width: VIEW, height: VIEW, cursor: 'grab' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={onWheel}
              >
                <canvas ref={canvasRef} width={VIEW} height={VIEW} />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    boxShadow: `0 0 0 ${VIEW}px rgba(17,24,39,0.55)`,
                    borderRadius: '50%',
                    margin: 8,
                  }}
                />
              </div>

              <div className="flex w-full items-center gap-3 px-2">
                <span className="text-lg text-gray-400" aria-hidden>
                  −
                </span>
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full"
                  aria-label="זום"
                />
                <span className="text-lg text-gray-400" aria-hidden>
                  +
                </span>
              </div>

              {/* Avatar-size preview — the face must survive the small circle. */}
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <SmallPreview img={img} offset={offset} scale={scale} />
                כך התמונה תוצג במערכת
              </div>
            </>
          )}
        </div>

        {/* secondary actions — replace / remove the current photo */}
        {(onPickNew || onRemove) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {onPickNew && (
              <>
                <button
                  type="button"
                  onClick={() => pickRef.current?.click()}
                  disabled={saving}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  ⬆ העלאת תמונה אחרת
                </button>
                <input
                  ref={pickRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onPickNew(f);
                  }}
                />
              </>
            )}
            {onRemove &&
              (confirmRemove ? (
                <span className="inline-flex items-center gap-2 text-[12.5px]">
                  <span className="text-red-700">להסיר את התמונה?</span>
                  <button
                    type="button"
                    onClick={onRemove}
                    disabled={saving}
                    className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    הסרה
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={saving}
                    className="rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-100"
                  >
                    ביטול
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  disabled={saving}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-[12.5px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  🗑 הסרת תמונה
                </button>
              ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !img}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'שומר…' : 'שמירת תמונה'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SMALL = 40;

function SmallPreview({ img, offset, scale }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    const f = SMALL / VIEW;
    ctx.clearRect(0, 0, SMALL, SMALL);
    ctx.save();
    ctx.translate((VIEW / 2 + offset.x) * f, (VIEW / 2 + offset.y) * f);
    ctx.scale(scale * f, scale * f);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [img, offset, scale]);
  return (
    <canvas
      ref={ref}
      width={SMALL}
      height={SMALL}
      className="rounded-full border border-gray-200"
      aria-hidden
    />
  );
}
