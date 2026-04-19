import { useCallback, useEffect, useRef, useState } from 'react';

// CombinedAssetEditor — visual composition editor for combined signer assets.
//
// PORTED from recruitment/CombinedAssetEditor.tsx (TS → JS).
//
// Differences vs. recruitment (all trivial):
//   - Source PNGs load via URL (pngUrl prop) instead of inline base64; same
//     result once `img.onload` fires.
//   - Asset ids are strings (cuids) instead of numbers.
//
// Layout data model (stored in SignerAsset.stampConfigJson for combined assets):
//   CompositionLayout {
//     kind:     'composition'
//     canvas_w: 900
//     canvas_h: 300
//     elements: CompositionElement[]
//   }
//   CompositionElement {
//     asset_id:   string
//     asset_type: 'draw' | 'stamp'
//     x_pct, y_pct, w_pct, h_pct: number
//     layer_order: 0 | 1
//   }
//
// Re-edit: pass initialLayout + the two source assets (drawAsset, stampAsset)
// and the editor opens with the saved positions intact.

const RENDER_W = 900;
const RENDER_H = 300;
const DPR = 2;
const MIN_SIZE = 8;
const HANDLE_SIZE = 12;

function makeDefaultElements(drawAsset, stampAsset) {
  return [
    {
      asset_id: drawAsset.id,
      asset_type: 'draw',
      x_pct: 2,
      y_pct: 5,
      w_pct: 46,
      h_pct: 90,
      layer_order: 1,
    },
    {
      asset_id: stampAsset.id,
      asset_type: 'stamp',
      x_pct: 52,
      y_pct: 5,
      w_pct: 46,
      h_pct: 90,
      layer_order: 0,
    },
  ];
}

async function renderToPng(elements, drawAsset, stampAsset) {
  const W = RENDER_W * DPR;
  const H = RENDER_H * DPR;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const loadImg = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const sorted = [...elements].sort((a, b) => a.layer_order - b.layer_order);
  for (const el of sorted) {
    const asset = el.asset_type === 'draw' ? drawAsset : stampAsset;
    const img = await loadImg(asset.pngUrl);
    ctx.drawImage(
      img,
      (el.x_pct / 100) * W,
      (el.y_pct / 100) * H,
      (el.w_pct / 100) * W,
      (el.h_pct / 100) * H,
    );
  }

  return canvas.toDataURL('image/png');
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export default function CombinedAssetEditor({
  drawAsset,
  stampAsset,
  initialLayout,
  initialLabel = '',
  onConfirm,
  onClose,
}) {
  const [elements, setElements] = useState(() => {
    if (initialLayout?.elements && Array.isArray(initialLayout.elements)) {
      // Normalize any missing fields from the saved layout.
      return initialLayout.elements.map((e) => ({
        asset_id: e.asset_id,
        asset_type: e.asset_type,
        x_pct: Number(e.x_pct) || 0,
        y_pct: Number(e.y_pct) || 0,
        w_pct: Number(e.w_pct) || 10,
        h_pct: Number(e.h_pct) || 10,
        layer_order: e.layer_order ?? (e.asset_type === 'draw' ? 1 : 0),
      }));
    }
    return makeDefaultElements(drawAsset, stampAsset);
  });
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState(initialLabel);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef(null);
  const actionRef = useRef(null);

  const setEl = useCallback((type, patch) => {
    setElements((prev) =>
      prev.map((e) => (e.asset_type === type ? { ...e, ...patch } : e)),
    );
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const action = actionRef.current;
      if (!action) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dxPct = ((e.clientX - action.sx) / rect.width) * 100;
      const dyPct = ((e.clientY - action.sy) / rect.height) * 100;
      if (action.kind === 'drag') {
        setEl(action.id, {
          x_pct: clamp(action.ox + dxPct, 0, 100 - action.ew),
          y_pct: clamp(action.oy + dyPct, 0, 100 - action.eh),
        });
      } else {
        setEl(action.id, {
          w_pct: clamp(action.ow + dxPct, MIN_SIZE, 100 - action.ex),
          h_pct: clamp(action.oh + dyPct, MIN_SIZE, 100 - action.ey),
        });
      }
    };
    const onUp = () => {
      actionRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setEl]);

  function startDrag(e, type) {
    e.preventDefault();
    const el = elements.find((x) => x.asset_type === type);
    actionRef.current = {
      kind: 'drag',
      id: type,
      sx: e.clientX,
      sy: e.clientY,
      ox: el.x_pct,
      oy: el.y_pct,
      ew: el.w_pct,
      eh: el.h_pct,
    };
    setSelected(type);
  }

  function startResize(e, type) {
    e.preventDefault();
    e.stopPropagation();
    const el = elements.find((x) => x.asset_type === type);
    actionRef.current = {
      kind: 'resize',
      id: type,
      sx: e.clientX,
      sy: e.clientY,
      ow: el.w_pct,
      oh: el.h_pct,
      ex: el.x_pct,
      ey: el.y_pct,
    };
    setSelected(type);
  }

  function resetLayout() {
    setElements(makeDefaultElements(drawAsset, stampAsset));
  }

  function swapLayers() {
    setElements((prev) =>
      prev.map((e) => ({ ...e, layer_order: 1 - e.layer_order })),
    );
  }

  function applySideBySide() {
    setElements([
      { asset_id: drawAsset.id, asset_type: 'draw', x_pct: 2, y_pct: 5, w_pct: 46, h_pct: 90, layer_order: 1 },
      { asset_id: stampAsset.id, asset_type: 'stamp', x_pct: 52, y_pct: 5, w_pct: 46, h_pct: 90, layer_order: 0 },
    ]);
  }
  function applyStampSmall() {
    setElements([
      { asset_id: drawAsset.id, asset_type: 'draw', x_pct: 2, y_pct: 5, w_pct: 62, h_pct: 90, layer_order: 0 },
      { asset_id: stampAsset.id, asset_type: 'stamp', x_pct: 46, y_pct: 30, w_pct: 32, h_pct: 50, layer_order: 1 },
    ]);
  }
  function applySignatureSmall() {
    setElements([
      { asset_id: stampAsset.id, asset_type: 'stamp', x_pct: 2, y_pct: 5, w_pct: 62, h_pct: 90, layer_order: 0 },
      { asset_id: drawAsset.id, asset_type: 'draw', x_pct: 46, y_pct: 30, w_pct: 32, h_pct: 50, layer_order: 1 },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const dataUrl = await renderToPng(elements, drawAsset, stampAsset);
      const layout = {
        kind: 'composition',
        canvas_w: RENDER_W,
        canvas_h: RENDER_H,
        elements,
      };
      const label =
        name.trim() ||
        `${drawAsset.label || 'חתימה'} + ${stampAsset.label || 'חותמת'}`;
      await onConfirm(layout, dataUrl, label);
    } finally {
      setSaving(false);
    }
  }

  const drawEl = elements.find((e) => e.asset_type === 'draw');
  const stampEl = elements.find((e) => e.asset_type === 'stamp');
  if (!drawEl || !stampEl) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70" dir="rtl">
      <div className="flex flex-col flex-1 min-h-0 bg-white max-w-3xl w-full mx-auto my-4 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">עורך הרכבה</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              גרור כל אלמנט למיקום הרצוי. גרור את הפינה לשינוי גודל.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-100 bg-gray-50 shrink-0 flex-wrap">
          <span className="text-xs text-gray-500 font-medium ml-1">פריסה מהירה:</span>
          <button
            onClick={applySideBySide}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
          >
            זה לצד זה
          </button>
          <button
            onClick={applyStampSmall}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
          >
            חתימה ראשית + חותמת קטנה
          </button>
          <button
            onClick={applySignatureSmall}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
          >
            חותמת ראשית + חתימה קטנה
          </button>
          <button
            onClick={resetLayout}
            className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-500"
          >
            אפס מיקום
          </button>
          <div className="flex items-center gap-2 border-r border-gray-200 pr-3 mr-auto">
            <span className="text-xs text-gray-500">שכבות:</span>
            <span className="text-xs text-gray-700 font-medium">
              {elements.find((e) => e.layer_order === 1)?.asset_type === 'draw'
                ? 'חתימה מעל'
                : 'חותמת מעל'}
            </span>
            <button
              onClick={swapLayers}
              className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
              title="החלף סדר שכבות"
            >
              ↕ החלף
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 py-4 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-purple-400 inline-block" />
              <span className="text-gray-600">
                חתימה ידנית:{' '}
                <strong>{drawAsset.label || `#${drawAsset.id.slice(-6)}`}</strong>
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />
              <span className="text-gray-600">
                חותמת:{' '}
                <strong>{stampAsset.label || `#${stampAsset.id.slice(-6)}`}</strong>
              </span>
            </span>
          </div>

          <div
            ref={containerRef}
            className="relative border-2 border-dashed border-gray-300 rounded-xl overflow-hidden select-none"
            style={{
              width: '100%',
              aspectRatio: `${RENDER_W} / ${RENDER_H}`,
              backgroundImage:
                'repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%)',
              backgroundSize: '20px 20px',
            }}
            onPointerDown={() => setSelected(null)}
          >
            <CompositionElementBox
              element={drawEl}
              isSelected={selected === 'draw'}
              color="purple"
              label="חתימה"
              imageSrc={drawAsset.pngUrl}
              onDragStart={(e) => startDrag(e, 'draw')}
              onResizeStart={(e) => startResize(e, 'draw')}
            />
            <CompositionElementBox
              element={stampEl}
              isSelected={selected === 'stamp'}
              color="amber"
              label="חותמת"
              imageSrc={stampAsset.pngUrl}
              onDragStart={(e) => startDrag(e, 'stamp')}
              onResizeStart={(e) => startResize(e, 'stamp')}
            />
          </div>

          <div className="h-5 flex items-center gap-4 text-[11px] text-gray-400">
            {selected &&
              (() => {
                const el = elements.find((e) => e.asset_type === selected);
                return (
                  <>
                    <span>{selected === 'draw' ? 'חתימה' : 'חותמת'}</span>
                    <span>X: {el.x_pct.toFixed(1)}%</span>
                    <span>Y: {el.y_pct.toFixed(1)}%</span>
                    <span>W: {el.w_pct.toFixed(1)}%</span>
                    <span>H: {el.h_pct.toFixed(1)}%</span>
                  </>
                );
              })()}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              שם לנכס המשולב
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${drawAsset.label || 'חתימה'} + ${stampAsset.label || 'חותמת'}`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              dir="rtl"
            />
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            {saving ? 'שומר…' : '💾 שמור נכס משולב'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function CompositionElementBox({
  element,
  isSelected,
  color,
  label,
  imageSrc,
  onDragStart,
  onResizeStart,
}) {
  const borderColor = color === 'purple' ? '#a855f7' : '#f59e0b';
  const labelBg = color === 'purple' ? '#f3e8ff' : '#fffbeb';
  const labelText = color === 'purple' ? '#7c3aed' : '#b45309';
  const handleColor = color === 'purple' ? '#a855f7' : '#f59e0b';

  return (
    <div
      onPointerDown={onDragStart}
      style={{
        position: 'absolute',
        left: `${element.x_pct}%`,
        top: `${element.y_pct}%`,
        width: `${element.w_pct}%`,
        height: `${element.h_pct}%`,
        zIndex: element.layer_order + 1,
        border: `2px solid ${isSelected ? borderColor : 'rgba(0,0,0,0.15)'}`,
        borderRadius: 4,
        cursor: 'move',
        boxSizing: 'border-box',
        boxShadow: isSelected ? `0 0 0 2px ${borderColor}44` : 'none',
        transition: 'box-shadow 0.1s',
        userSelect: 'none',
      }}
    >
      <img
        src={imageSrc}
        alt={label}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          pointerEvents: 'none',
          background: 'transparent',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          background: labelBg,
          color: labelText,
          fontSize: 9,
          fontWeight: 600,
          padding: '1px 4px',
          borderRadius: 3,
          lineHeight: 1.5,
          pointerEvents: 'none',
          opacity: isSelected ? 1 : 0.7,
        }}
      >
        {label}
      </div>
      <div
        onPointerDown={onResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          background: handleColor,
          borderRadius: '3px 0 3px 0',
          cursor: 'nwse-resize',
          opacity: isSelected ? 1 : 0.5,
          transition: 'opacity 0.1s',
        }}
      />
    </div>
  );
}
