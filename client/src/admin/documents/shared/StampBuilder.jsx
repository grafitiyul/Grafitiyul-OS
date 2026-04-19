import { useEffect, useRef, useState } from 'react';

// StampBuilder — canvas-based stamp designer.
//
// PORTED verbatim from recruitment/StampBuilder.tsx (TS → JS only).
// Config shape preserved exactly so stampConfigJson round-trips cleanly
// between create / re-edit flows.
//
// Props:
//   initial      optional StampConfig to pre-populate the form
//   onConfirm    (config, renderedDataUrl) — called on save
//   onClose      dismiss without saving

const DEFAULT_CONFIG = {
  lines: ['שם הארגון', 'תפקיד'],
  font_size: 18,
  color: '#1B2B5E',
  alignment: 'center',
  border: 'single',
  padding: 12,
};

const CANVAS_W = 320;
const DPR = 2;

// Crop canvas to bounding box of non-transparent pixels with a small margin
// so border anti-aliasing is preserved. Identical to SignaturePad's cropper.
function cropToPng(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;

  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 4) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < x0 || y1 < y0) return canvas.toDataURL('image/png');

  const MARGIN = 6;
  x0 = Math.max(0, x0 - MARGIN);
  y0 = Math.max(0, y0 - MARGIN);
  x1 = Math.min(w - 1, x1 + MARGIN);
  y1 = Math.min(h - 1, y1 + MARGIN);

  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out.toDataURL('image/png');
}

function renderStampToCanvas(canvas, config) {
  const fontSize = Math.max(10, Math.min(40, config.font_size));
  const lineH = fontSize * 1.4;
  const lines = config.lines.filter((l) => l.trim() !== '');
  const lineCount = Math.max(1, lines.length);
  const textBlockH = lineCount * lineH;
  const borderExtra = config.border !== 'none' ? 6 : 0;
  const CANVAS_H = Math.round(
    Math.max(textBlockH + config.padding * 2 + borderExtra, fontSize * 2),
  );

  const w = CANVAS_W * DPR;
  const h = CANVAS_H * DPR;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.scale(DPR, DPR);

  const pad = config.padding;
  const color = config.color || '#1B2B5E';

  // Border
  if (config.border !== 'none') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const inset = 3;
    if (config.border === 'rounded') {
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(inset + r, inset);
      ctx.lineTo(CANVAS_W - inset - r, inset);
      ctx.arcTo(CANVAS_W - inset, inset, CANVAS_W - inset, inset + r, r);
      ctx.lineTo(CANVAS_W - inset, CANVAS_H - inset - r);
      ctx.arcTo(CANVAS_W - inset, CANVAS_H - inset, CANVAS_W - inset - r, CANVAS_H - inset, r);
      ctx.lineTo(inset + r, CANVAS_H - inset);
      ctx.arcTo(inset, CANVAS_H - inset, inset, CANVAS_H - inset - r, r);
      ctx.lineTo(inset, inset + r);
      ctx.arcTo(inset, inset, inset + r, inset, r);
      ctx.closePath();
      ctx.stroke();
    } else if (config.border === 'double') {
      ctx.strokeRect(inset, inset, CANVAS_W - inset * 2, CANVAS_H - inset * 2);
      ctx.strokeRect(inset + 4, inset + 4, CANVAS_W - (inset + 4) * 2, CANVAS_H - (inset + 4) * 2);
    } else {
      ctx.strokeRect(inset, inset, CANVAS_W - inset * 2, CANVAS_H - inset * 2);
    }
  }

  // Text
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px 'Heebo', Arial, sans-serif`;
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';

  const startY = (CANVAS_H - textBlockH) / 2;

  lines.forEach((line, i) => {
    let x;
    if (config.alignment === 'right') {
      ctx.textAlign = 'right';
      x = CANVAS_W - pad;
    } else if (config.alignment === 'left') {
      ctx.textAlign = 'left';
      x = pad;
    } else {
      ctx.textAlign = 'center';
      x = CANVAS_W / 2;
    }
    ctx.fillText(line, x, startY + i * lineH);
  });
}

export default function StampBuilder({ initial, onConfirm, onClose }) {
  const [config, setConfig] = useState(() => initial || DEFAULT_CONFIG);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) renderStampToCanvas(canvasRef.current, config);
  }, [config]);

  function updateLine(i, value) {
    setConfig((prev) => {
      const lines = [...prev.lines];
      lines[i] = value;
      return { ...prev, lines };
    });
  }

  function addLine() {
    setConfig((prev) => ({ ...prev, lines: [...prev.lines, ''] }));
  }

  function removeLine(i) {
    setConfig((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== i),
    }));
  }

  function handleConfirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = cropToPng(canvas);
    onConfirm(config, dataUrl);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      dir="rtl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white w-full sm:max-w-lg sm:mx-4 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">בניית חותמת</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <div
            className="flex justify-center rounded border border-gray-200"
            style={{
              backgroundImage:
                'repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%)',
              backgroundSize: '16px 16px',
            }}
          >
            <canvas
              ref={canvasRef}
              className="rounded shadow-sm"
              style={{ width: CANVAS_W }}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">
              שורות טקסט
            </label>
            {config.lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={line}
                  onChange={(e) => updateLine(i, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                  placeholder={`שורה ${i + 1}`}
                  dir="rtl"
                />
                {config.lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {config.lines.length < 6 && (
              <button
                type="button"
                onClick={addLine}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                + הוסף שורה
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                גודל גופן: {config.font_size}px
              </label>
              <input
                type="range"
                min={10}
                max={36}
                step={1}
                value={config.font_size}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    font_size: Number(e.target.value),
                  }))
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                צבע
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.color}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, color: e.target.value }))
                  }
                  className="h-8 w-12 rounded border border-gray-300 cursor-pointer"
                />
                <span className="text-xs text-gray-500">{config.color}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">יישור</label>
            <div className="flex gap-2">
              {['right', 'center', 'left'].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, alignment: a }))
                  }
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    config.alignment === a
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {a === 'right' ? 'ימין' : a === 'center' ? 'מרכז' : 'שמאל'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              מסגרת
            </label>
            <div className="flex gap-2 flex-wrap">
              {['none', 'single', 'double', 'rounded'].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, border: b }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    config.border === b
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {b === 'none'
                    ? 'ללא'
                    : b === 'single'
                    ? 'רגילה'
                    : b === 'double'
                    ? 'כפולה'
                    : 'מעוגלת'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              ריווח פנימי: {config.padding}px
            </label>
            <input
              type="range"
              min={4}
              max={24}
              step={2}
              value={config.padding}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, padding: Number(e.target.value) }))
              }
              className="w-full"
            />
          </div>
        </div>

        <div className="px-5 pb-5 pt-2 flex gap-3 border-t border-gray-100">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            שמור חותמת
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
