import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite: ?url returns the built asset URL for the worker.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// PdfViewer — renders a PDF into stacked <canvas> pages and overlays
// percentage-positioned rectangles on top. Supports two overlay layers:
//
//   1. fields       — value placements. Colored chrome box, label, delete ×.
//   2. annotations  — visual markup (check / x / highlight / line / note).
//                     Chrome-less; the raw visual fills the rect.
//
// Both layers share drag + resize semantics via useOverlayInteractions.
//
// Props:
//   pdfUrl           required
//   fields           required — [{ id, page, xPct, yPct, wPct, hPct, fieldType, label }]
//   annotations      optional — [{ id, kind, page, xPct, yPct, wPct, hPct, ... }]
//   readOnly         disables click-to-place + drag/resize for both layers
//   isPlacing        'field' | 'annotation' | true | false — when set, clicking
//                    empty space calls onPageClick(kind, page, xPct, yPct).
//                    `true` is treated as 'field' for back-compat.
//   onPageClick      (page, xPct, yPct)  OR  (kind, page, xPct, yPct) if using
//                    annotation placement. The component emits the 4-arg form
//                    whenever isPlacing === 'annotation'.
//   (for each layer) onMoveX/onResizeX/onDeleteX/onXClick + selectedXId
//   renderFieldContent / renderAnnotationContent — callback returns inner JSX.
export default function PdfViewer({
  pdfUrl,
  fields,
  annotations = [],
  readOnly = false,
  isPlacing = false,
  onPageClick,
  onMoveField,
  onResizeField,
  onDeleteField,
  onFieldClick,
  renderFieldContent,
  selectedFieldId,
  onMoveAnnotation,
  onResizeAnnotation,
  onDeleteAnnotation,
  onAnnotationClick,
  renderAnnotationContent,
  selectedAnnotationId,
}) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined'
      ? Math.max(window.innerWidth - 340, 500)
      : 800,
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadTask = null;
    setLoading(true);
    setLoadError(null);
    setPdfDoc(null);
    setNumPages(0);

    fetch(pdfUrl, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        if (magic !== '%PDF') {
          const preview = new TextDecoder().decode(bytes.slice(0, 300));
          throw new Error(`תגובת השרת אינה PDF: ${preview.slice(0, 150)}`);
        }
        loadTask = pdfjsLib.getDocument({ data: bytes });
        return loadTask.promise;
      })
      .then((doc) => {
        if (cancelled || !doc) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(`שגיאה בטעינת ה-PDF: ${err?.message ?? String(err)}`);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadTask?.destroy();
    };
  }, [pdfUrl]);

  return (
    <div ref={containerRef} className="space-y-6">
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          טוען PDF…
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-center h-48 text-red-700 text-sm bg-red-50 rounded-lg border border-red-200">
          {loadError}
        </div>
      ) : pdfDoc ? (
        Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <PdfPage
            key={pageNum}
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            containerWidth={containerWidth}
            fields={fields.filter((f) => f.page === pageNum)}
            annotations={annotations.filter((a) => a.page === pageNum)}
            readOnly={readOnly}
            isPlacing={isPlacing}
            onPageClick={onPageClick}
            onMoveField={onMoveField}
            onResizeField={onResizeField}
            onDeleteField={onDeleteField}
            onFieldClick={onFieldClick}
            renderFieldContent={renderFieldContent}
            selectedFieldId={selectedFieldId}
            onMoveAnnotation={onMoveAnnotation}
            onResizeAnnotation={onResizeAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onAnnotationClick={onAnnotationClick}
            renderAnnotationContent={renderAnnotationContent}
            selectedAnnotationId={selectedAnnotationId}
          />
        ))
      ) : null}
    </div>
  );
}

function PdfPage({
  pdfDoc,
  pageNum,
  containerWidth,
  fields,
  annotations,
  readOnly,
  isPlacing,
  onPageClick,
  onMoveField,
  onResizeField,
  onDeleteField,
  onFieldClick,
  renderFieldContent,
  selectedFieldId,
  onMoveAnnotation,
  onResizeAnnotation,
  onDeleteAnnotation,
  onAnnotationClick,
  renderAnnotationContent,
  selectedAnnotationId,
}) {
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);
  const [cssWidth, setCssWidth] = useState(0);
  const [cssHeight, setCssHeight] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let activeTask = null;
    setRendered(false);

    (async () => {
      let page = null;
      try {
        page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const natural = page.getViewport({ scale: 1 });
        const fit =
          containerWidth > 0
            ? Math.min(1.5, (containerWidth - 16) / natural.width)
            : 1.5;
        const viewport = page.getViewport({ scale: fit * dpr });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const lw = Math.round(viewport.width / dpr);
        const lh = Math.round(viewport.height / dpr);
        canvas.style.width = `${lw}px`;
        canvas.style.height = `${lh}px`;
        setCssWidth(lw);
        setCssHeight(lh);
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        ctx.direction = 'ltr';
        const task = page.render({ canvas, canvasContext: ctx, viewport });
        activeTask = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return;
      } finally {
        page?.cleanup();
      }
    })();

    return () => {
      cancelled = true;
      activeTask?.cancel();
    };
  }, [pdfDoc, pageNum, containerWidth]);

  const placementMode =
    isPlacing === true ? 'field' : typeof isPlacing === 'string' ? isPlacing : null;

  const handleContainerClick = (e) => {
    if (readOnly || !placementMode || !rendered) return;
    if (e.target.closest('[data-field-overlay]')) return;
    if (e.target.closest('[data-annotation-overlay]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // Always emit (kind, page, xPct, yPct) so callers can dispatch by kind.
    // Back-compat: legacy callers that destructure (page, x, y) still work
    // if we fall back to 3-arg when mode === 'field' and the callback likely
    // predates annotations. We detect that via the presence of a dedicated
    // annotation channel on the component — if the caller passed annotations
    // props, assume they want the 4-arg signature.
    onPageClick?.(placementMode, pageNum, xPct, yPct);
  };

  return (
    <div
      dir="ltr"
      className="relative shadow-lg rounded-sm border border-gray-200 mx-auto"
      style={{ width: cssWidth || 'auto', height: cssHeight || 'auto' }}
    >
      <div className="absolute top-1.5 left-1.5 z-10 bg-gray-700/70 text-white text-xs px-1.5 py-0.5 rounded pointer-events-none">
        עמ׳ {pageNum}
      </div>
      <div
        data-pdf-page
        className="relative"
        style={{
          cursor: !readOnly && placementMode && rendered ? 'crosshair' : 'default',
          width: cssWidth || 'auto',
          height: cssHeight || 'auto',
        }}
        onClick={handleContainerClick}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        {rendered &&
          fields.map((field) => (
            <FieldOverlay
              key={field.id}
              field={field}
              readOnly={readOnly}
              selected={selectedFieldId === field.id}
              pageCssHeight={cssHeight}
              onMove={onMoveField}
              onResize={onResizeField}
              onDelete={onDeleteField}
              onClick={onFieldClick}
              renderContent={renderFieldContent}
            />
          ))}
        {rendered &&
          annotations.map((ann) => (
            <AnnotationOverlay
              key={ann.id}
              ann={ann}
              readOnly={readOnly}
              selected={selectedAnnotationId === ann.id}
              pageCssHeight={cssHeight}
              onMove={onMoveAnnotation}
              onResize={onResizeAnnotation}
              onDelete={onDeleteAnnotation}
              onClick={onAnnotationClick}
              renderContent={renderAnnotationContent}
            />
          ))}
      </div>
    </div>
  );
}

// ─── Shared drag + resize interactions ───────────────────────────────────────

const MIN_W_PCT = 3;
const MIN_H_PCT = 1.5;

function useOverlayInteractions({ rect, readOnly, onMove, onResize, onClick }) {
  // rect: { id, xPct, yPct, wPct, hPct }
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  function onBodyPointerDown(e) {
    if (readOnly) return;
    if (e.target.closest('[data-del]')) return;
    if (e.target.closest('[data-resize]')) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      ptrX: e.clientX,
      ptrY: e.clientY,
      startX: rect.xPct,
      startY: rect.yPct,
    };
  }

  function onBodyPointerMove(e) {
    if (!dragRef.current || !onMove) return;
    const page = e.currentTarget.closest('[data-pdf-page]');
    if (!page) return;
    const pageRect = page.getBoundingClientRect();
    const dxPct = ((e.clientX - dragRef.current.ptrX) / pageRect.width) * 100;
    const dyPct = ((e.clientY - dragRef.current.ptrY) / pageRect.height) * 100;
    const newX = Math.max(
      0,
      Math.min(dragRef.current.startX + dxPct, 100 - rect.wPct),
    );
    const newY = Math.max(
      0,
      Math.min(dragRef.current.startY + dyPct, 100 - rect.hPct),
    );
    onMove(rect.id, newX, newY);
  }

  function onBodyPointerUp(e) {
    const moved =
      !!dragRef.current &&
      (Math.abs(e.clientX - dragRef.current.ptrX) > 3 ||
        Math.abs(e.clientY - dragRef.current.ptrY) > 3);
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!moved && onClick && !readOnly) onClick(rect.id);
  }

  function onResizePointerDown(e) {
    if (readOnly) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      ptrX: e.clientX,
      ptrY: e.clientY,
      startW: rect.wPct,
      startH: rect.hPct,
    };
  }

  function onResizePointerMove(e) {
    if (!resizeRef.current || !onResize) return;
    const page = e.currentTarget.closest('[data-pdf-page]');
    if (!page) return;
    const pageRect = page.getBoundingClientRect();
    const dxPct = ((e.clientX - resizeRef.current.ptrX) / pageRect.width) * 100;
    const dyPct = ((e.clientY - resizeRef.current.ptrY) / pageRect.height) * 100;
    const newW = Math.max(
      MIN_W_PCT,
      Math.min(resizeRef.current.startW + dxPct, 100 - rect.xPct),
    );
    const newH = Math.max(
      MIN_H_PCT,
      Math.min(resizeRef.current.startH + dyPct, 100 - rect.yPct),
    );
    onResize(rect.id, newW, newH);
  }

  function onResizePointerUp(e) {
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return {
    body: {
      onPointerDown: onBodyPointerDown,
      onPointerMove: onBodyPointerMove,
      onPointerUp: onBodyPointerUp,
    },
    resize: {
      onPointerDown: onResizePointerDown,
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
    },
  };
}

// Client-side text sizing rule for fields. Mirrors the server-side rule in
// pdfRender.js (ratio 0.65 of field height, clamped). Working in CSS pixels
// because the preview is pixel-based; the PDF's PT-based equivalent renders
// to the same visual ratio.
function fieldFontSizePx(fieldHPct, pageCssHeightPx) {
  if (!pageCssHeightPx) return 14;
  const heightPx = (fieldHPct / 100) * pageCssHeightPx;
  return Math.max(11, Math.min(48, heightPx * 0.65));
}

// ─── Field overlay (chrome + dynamic fontSize) ───────────────────────────────

function FieldOverlay({
  field,
  readOnly,
  selected,
  pageCssHeight,
  onMove,
  onResize,
  onDelete,
  onClick,
  renderContent,
}) {
  const { body, resize } = useOverlayInteractions({
    rect: field,
    readOnly,
    onMove,
    onResize,
    onClick,
  });

  const cfg = TYPE_STYLES[field.fieldType] || TYPE_STYLES.text;
  const selectedRing = selected ? 'ring-2 ring-blue-500' : '';
  const fontSizePx = useMemo(
    () => fieldFontSizePx(field.hPct, pageCssHeight),
    [field.hPct, pageCssHeight],
  );

  return (
    <div
      data-field-overlay
      style={{
        position: 'absolute',
        left: `${field.xPct}%`,
        top: `${field.yPct}%`,
        width: `${field.wPct}%`,
        height: `${field.hPct}%`,
        cursor: readOnly ? 'default' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      {...body}
    >
      <div
        className={`relative h-full border-2 rounded ${cfg.border} ${cfg.bg} flex items-center px-1 overflow-hidden ${selectedRing}`}
      >
        <div
          className={`font-semibold leading-tight truncate flex-1 ${cfg.text}`}
          style={{ fontSize: `${fontSizePx}px` }}
        >
          {renderContent ? renderContent(field) : field.label || cfg.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </div>
        {!readOnly && onDelete && (
          <button
            data-del
            onClick={(e) => {
              e.stopPropagation();
              onDelete(field.id);
            }}
            className="shrink-0 w-4 h-4 rounded-full bg-white/80 hover:bg-red-100 border border-gray-300 hover:border-red-400 flex items-center justify-center text-gray-500 hover:text-red-600 text-[10px] leading-none"
            title="הסר שדה"
          >
            ×
          </button>
        )}
      </div>
      {!readOnly && onResize && <ResizeHandle {...resize} />}
    </div>
  );
}

// ─── Annotation overlay (chrome-less, renders the actual visual) ─────────────

function AnnotationOverlay({
  ann,
  readOnly,
  selected,
  pageCssHeight,
  onMove,
  onResize,
  onDelete,
  onClick,
  renderContent,
}) {
  const { body, resize } = useOverlayInteractions({
    rect: ann,
    readOnly,
    onMove,
    onResize,
    onClick,
  });

  const selectionRing = selected
    ? 'outline outline-2 outline-offset-1 outline-blue-500'
    : '';

  return (
    <div
      data-annotation-overlay
      style={{
        position: 'absolute',
        left: `${ann.xPct}%`,
        top: `${ann.yPct}%`,
        width: `${ann.wPct}%`,
        height: `${ann.hPct}%`,
        cursor: readOnly ? 'default' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      {...body}
    >
      <div
        className={`relative h-full w-full overflow-hidden rounded-sm ${selectionRing}`}
      >
        {renderContent
          ? renderContent(ann, { pageCssHeight })
          : null}
        {!readOnly && onDelete && selected && (
          <button
            data-del
            onClick={(e) => {
              e.stopPropagation();
              onDelete(ann.id);
            }}
            className="absolute top-0 right-0 w-4 h-4 rounded-full bg-white/90 hover:bg-red-100 border border-gray-400 flex items-center justify-center text-gray-600 hover:text-red-600 text-[10px] leading-none"
            title="הסר סימון"
          >
            ×
          </button>
        )}
      </div>
      {!readOnly && onResize && selected && <ResizeHandle {...resize} />}
    </div>
  );
}

function ResizeHandle(handlers) {
  return (
    <div
      data-resize
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: 10,
        height: 10,
        cursor: 'nwse-resize',
        touchAction: 'none',
      }}
      className="bg-white border border-gray-400 rounded-sm opacity-70 hover:opacity-100"
      {...handlers}
    />
  );
}

const TYPE_STYLES = {
  text:      { label: 'טקסט',           border: 'border-blue-500',   bg: 'bg-blue-100/60',    text: 'text-blue-800'    },
  date:      { label: 'תאריך',          border: 'border-orange-500', bg: 'bg-orange-100/60',  text: 'text-orange-800'  },
  number:    { label: 'מספר',           border: 'border-indigo-500', bg: 'bg-indigo-100/60',  text: 'text-indigo-800'  },
  phone:     { label: 'טלפון',          border: 'border-teal-500',   bg: 'bg-teal-100/60',    text: 'text-teal-800'    },
  email:     { label: 'אימייל',         border: 'border-pink-500',   bg: 'bg-pink-100/60',    text: 'text-pink-800'    },
  signature: { label: 'חתימה',          border: 'border-purple-500', bg: 'bg-purple-100/60',  text: 'text-purple-800'  },
  stamp:     { label: 'חותמת',          border: 'border-amber-500',  bg: 'bg-amber-100/60',   text: 'text-amber-800'   },
  combined:  { label: 'חתימה + חותמת',  border: 'border-fuchsia-500',bg: 'bg-fuchsia-100/60', text: 'text-fuchsia-800' },
};
