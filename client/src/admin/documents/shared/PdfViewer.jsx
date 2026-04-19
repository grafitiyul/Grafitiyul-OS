import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite: ?url returns the built asset URL for the worker.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// PdfViewer — renders a PDF into stacked <canvas> pages and overlays
// percentage-positioned field divs on top. Ported from recruitment/PdfViewer.tsx.
//
// Fields use percentage coordinates (0..100) from each page's top-left, so
// they remain correct at any canvas scale. Drag + resize only fire onMove /
// onResize — the parent owns field state and re-renders us with new coords.
//
// Props:
//   pdfUrl           required — any URL returning application/pdf
//   fields           required — [{ id, page, xPct, yPct, wPct, hPct, fieldType, label }]
//   readOnly         disable click-to-place + drag/resize
//   onPageClick      (page, xPct, yPct) — user clicked empty area while placing
//   onMoveField      (fieldId, xPct, yPct) — drag ended a move
//   onResizeField    (fieldId, wPct, hPct) — drag ended a resize
//   onDeleteField    (fieldId) — × button on field
//   onFieldClick     (fieldId) — clicked body of existing field (select it)
//   renderFieldContent  optional — return React content for the field body
//   selectedFieldId  for highlighting
//   isPlacing        true to show crosshair on page
export default function PdfViewer({
  pdfUrl,
  fields,
  readOnly = false,
  isPlacing = false,
  onPageClick,
  onMoveField,
  onResizeField,
  onDeleteField,
  onFieldClick,
  renderFieldContent,
  selectedFieldId,
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
            readOnly={readOnly}
            isPlacing={isPlacing}
            onPageClick={(xPct, yPct) => onPageClick?.(pageNum, xPct, yPct)}
            onMoveField={onMoveField}
            onResizeField={onResizeField}
            onDeleteField={onDeleteField}
            onFieldClick={onFieldClick}
            renderFieldContent={renderFieldContent}
            selectedFieldId={selectedFieldId}
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
  readOnly,
  isPlacing,
  onPageClick,
  onMoveField,
  onResizeField,
  onDeleteField,
  onFieldClick,
  renderFieldContent,
  selectedFieldId,
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

  const handleContainerClick = (e) => {
    if (readOnly || !isPlacing || !rendered) return;
    if (e.target.closest('[data-field-overlay]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    onPageClick?.(xPct, yPct);
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
          cursor: !readOnly && isPlacing && rendered ? 'crosshair' : 'default',
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
              onMove={onMoveField}
              onResize={onResizeField}
              onDelete={onDeleteField}
              onClick={onFieldClick}
              renderContent={renderFieldContent}
            />
          ))}
      </div>
    </div>
  );
}

const MIN_W_PCT = 5;
const MIN_H_PCT = 2;

function FieldOverlay({
  field,
  readOnly,
  selected,
  onMove,
  onResize,
  onDelete,
  onClick,
  renderContent,
}) {
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
      startX: field.xPct,
      startY: field.yPct,
    };
  }

  function onBodyPointerMove(e) {
    if (!dragRef.current || !onMove) return;
    const page = e.currentTarget.closest('[data-pdf-page]');
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const dxPct = ((e.clientX - dragRef.current.ptrX) / rect.width) * 100;
    const dyPct = ((e.clientY - dragRef.current.ptrY) / rect.height) * 100;
    const newX = Math.max(0, Math.min(dragRef.current.startX + dxPct, 100 - field.wPct));
    const newY = Math.max(0, Math.min(dragRef.current.startY + dyPct, 100 - field.hPct));
    onMove(field.id, newX, newY);
  }

  function onBodyPointerUp(e) {
    const wasDragging =
      !!dragRef.current &&
      (Math.abs(e.clientX - dragRef.current.ptrX) > 3 ||
        Math.abs(e.clientY - dragRef.current.ptrY) > 3);
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!wasDragging && onClick && !readOnly) onClick(field.id);
  }

  function onResizePointerDown(e) {
    if (readOnly) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      ptrX: e.clientX,
      ptrY: e.clientY,
      startW: field.wPct,
      startH: field.hPct,
    };
  }

  function onResizePointerMove(e) {
    if (!resizeRef.current || !onResize) return;
    const page = e.currentTarget.closest('[data-pdf-page]');
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const dxPct = ((e.clientX - resizeRef.current.ptrX) / rect.width) * 100;
    const dyPct = ((e.clientY - resizeRef.current.ptrY) / rect.height) * 100;
    const newW = Math.max(MIN_W_PCT, Math.min(resizeRef.current.startW + dxPct, 100 - field.xPct));
    const newH = Math.max(MIN_H_PCT, Math.min(resizeRef.current.startH + dyPct, 100 - field.yPct));
    onResize(field.id, newW, newH);
  }

  function onResizePointerUp(e) {
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const cfg = TYPE_STYLES[field.fieldType] || TYPE_STYLES.text;
  const selectedRing = selected ? 'ring-2 ring-blue-500' : '';

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
      onPointerDown={onBodyPointerDown}
      onPointerMove={onBodyPointerMove}
      onPointerUp={onBodyPointerUp}
    >
      <div
        className={`relative h-full border-2 rounded ${cfg.border} ${cfg.bg} flex items-center px-1 overflow-hidden ${selectedRing}`}
      >
        <div className={`text-[10px] font-semibold leading-tight truncate flex-1 ${cfg.text}`}>
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
      {!readOnly && onResize && (
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
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      )}
    </div>
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
