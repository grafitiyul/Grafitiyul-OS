import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import PdfViewer from '../shared/PdfViewer.jsx';
import SignaturePad from '../shared/SignaturePad.jsx';
import { IMAGE_FIELD_TYPES, SIGNER_ASSET_MODES } from '../config.js';

// Document-first instance editor.
//
// Placements live on the INSTANCE (fieldsSnapshot JSON), not on a template.
// The toolbar on top exposes concrete "place a value" actions: business
// values are dynamically rendered from the BusinessField library; signature /
// stamp / combined each prompt for a signer; date + free text are override-
// only placeholders.
//
// Overrides still work exactly as before (per-instance text/image scoped by
// snapshotFieldId). The sidebar shows the override panel for the currently
// selected field.

// Default rect sizes at placement time. Heights are tuned to match typical
// form-text proportions on the page: the server's rule fontSize = h * 0.60
// yields ~12–13pt at h=2.6% on A4 (842 * 0.026 * 0.60 ≈ 13.1pt) and Letter
// (792 * 0.026 * 0.60 ≈ 12.4pt). Resize still scales text proportionally.
// Widths are narrower than before so fields blend into the document rather
// than sitting as large overlays.
const PLACEMENT_DEFAULT_SIZES = {
  text: { wPct: 24, hPct: 2.6 },
  date: { wPct: 14, hPct: 2.6 },
  number: { wPct: 10, hPct: 2.6 },
  phone: { wPct: 14, hPct: 2.6 },
  email: { wPct: 20, hPct: 2.6 },
  signature: { wPct: 24, hPct: 9 },
  stamp: { wPct: 20, hPct: 11 },
  combined: { wPct: 30, hPct: 11 },
};

// Per-annotation-kind default sizes. Small marks stay small; highlights and
// lines start wider; notes get room for a line of text.
const ANNOTATION_DEFAULT_SIZES = {
  check: { wPct: 4, hPct: 4 },
  x: { wPct: 4, hPct: 4 },
  highlight: { wPct: 30, hPct: 5 },
  line: { wPct: 30, hPct: 1.5 },
  note: { wPct: 24, hPct: 5 },
};

// Default non-geometric config per annotation kind at placement time.
function annotationDefaults(kind) {
  if (kind === 'highlight') return { color: '#fde047', opacity: 0.35 };
  if (kind === 'line') return { color: '#111827', thickness: 2, orientation: 'horizontal' };
  if (kind === 'note') return { text: 'הערה', fontSize: 14, color: '#111827' };
  if (kind === 'x') return { color: '#b91c1c', thickness: 3 };
  // check default
  return { color: '#111827', thickness: 3 };
}

const HEB_RE = /[\u0590-\u05FF]/;

// Text-like field types get content-sized width at placement. Signatures /
// stamps / combined keep their fixed rect defaults.
const TEXT_FIELD_TYPES = new Set(['text', 'date', 'number', 'phone', 'email']);

// Measure visual text width in CSS pixels at a given font size. Uses a
// shared off-screen canvas so we don't pay setup cost per call. Font family
// matches what stamps use — same family family as the on-screen preview so
// WYSIWYG holds. The server-side NotoSansHebrew may differ by a few
// percent; we pad when we use the result to absorb that variance.
let _measureCanvas = null;
function measureTextPx(text, fontPx) {
  if (typeof document === 'undefined') return 0;
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  ctx.font = `${fontPx}px "Heebo", Arial, sans-serif`;
  return ctx.measureText(String(text || '')).width;
}

// Resolve what text to measure for a freshly-placed field given the pending
// toolbar config + the current live data. Used only for sizing the initial
// box — the actual value at render time is resolved via resolveInstanceText.
function resolvePlacementText(pending, liveBusinessFields) {
  if (!pending) return '';
  if (pending.fieldType === 'date') return formatIsoDate(todayIso());
  if (pending.valueSource === 'business_field' && pending.businessFieldId) {
    const bf = liveBusinessFields?.find((b) => b.id === pending.businessFieldId);
    if (bf) return pickBusinessValue(bf, 'he');
    return pending.label || '';
  }
  if (pending.valueSource === 'static') return pending.staticValue || '';
  // override_only text / free text: use label as the measurement placeholder.
  return pending.label || 'טקסט';
}

// Today as YYYY-MM-DD for date field default display.
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Format an ISO YYYY-MM-DD string to DD/MM/YYYY for display.
function formatIsoDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function localId() {
  return 'local_' + Math.random().toString(36).slice(2, 10);
}

export default function InstanceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [instance, setInstance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Live data for the toolbar (may be newer than the frozen snapshot).
  const [liveBusinessFields, setLiveBusinessFields] = useState([]);
  const [liveSigners, setLiveSigners] = useState([]);

  // Local placement state — mutates on drag/resize/add/remove; persisted via
  // PUT /instances/:id/fields. Initialised from instance.fieldsSnapshot.
  const [placements, setPlacements] = useState([]);
  // Annotation state — parallel to placements, saved separately via PUT
  // /instances/:id/annotations. Never flows through value resolution.
  const [annotations, setAnnotations] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const [finalizing, setFinalizing] = useState(false);
  const [finalizeErr, setFinalizeErr] = useState(null);

  // Placement mode — one of:
  //   null                             (idle)
  //   { mode: 'field', ...config }      (placing a value field)
  //   { mode: 'annotation', kind, ... } (placing an annotation)
  const [pending, setPending] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);

  const [saveTplOpen, setSaveTplOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [inst, bfs, ss] = await Promise.all([
        api.documents.getInstance(id),
        api.businessFields.list().catch(() => []),
        api.signers.list().catch(() => []),
      ]);
      setInstance(inst);
      setLiveBusinessFields(bfs);
      setLiveSigners(ss);
      setPlacements(
        Array.isArray(inst.fieldsSnapshot)
          ? inst.fieldsSnapshot.map((f) => ({ ...f }))
          : [],
      );
      setAnnotations(
        Array.isArray(inst.annotationsSnapshot)
          ? inst.annotationsSnapshot.map((a) => ({ ...a }))
          : [],
      );
      setDirty(false);
      setSaveErr(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && pending) setPending(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]);

  const isFinalized = instance?.status === 'finalized';
  const businessMap = instance?.businessSnapshot || {};
  const signers = Array.isArray(instance?.signersSnapshot)
    ? instance.signersSnapshot
    : [];
  const overridesByField = useMemo(() => {
    const m = {};
    for (const o of instance?.overrides || []) m[o.snapshotFieldId] = o;
    return m;
  }, [instance]);

  // ── Placement mutations ───────────────────────────────────────────────────

  const placeFieldAt = useCallback(
    (page, xPct, yPct, dims) => {
      if (!pending || pending.mode !== 'field' || isFinalized) return;

      // Content-sized width for text-like fields. Signatures / stamps /
      // combined keep their fixed defaults.
      const isTextLike = TEXT_FIELD_TYPES.has(pending.fieldType);
      let size;
      let anchor = 'center'; // 'center' | 'left' | 'right'

      if (isTextLike && dims?.pageCssWidth && dims?.pageCssHeight) {
        const heightPct = 2.6;
        const fontPx = (heightPct / 100) * dims.pageCssHeight * 0.6;
        const text = resolvePlacementText(pending, liveBusinessFields);
        const measured = measureTextPx(text, fontPx);
        // ~10px of horizontal breathing room total (5 per side) absorbs the
        // Heebo ↔ NotoSansHebrew font-metric variance so the PDF never clips.
        const PAD_PX = 10;
        const widthPx = Math.max(measured + PAD_PX, 28);
        const widthPct = Math.min(96, (widthPx / dims.pageCssWidth) * 100);
        size = { wPct: widthPct, hPct: heightPct };
        // RTL anchor for Hebrew content: drop point = right edge.
        anchor = HEB_RE.test(text) ? 'right' : 'left';
      } else {
        size = PLACEMENT_DEFAULT_SIZES[pending.fieldType] || { wPct: 22, hPct: 5 };
      }

      // Horizontal anchor:
      //   center → drop point is the center (legacy; used for image fields).
      //   left   → drop point is the left edge (LTR content).
      //   right  → drop point is the right edge (RTL content).
      let rawX;
      if (anchor === 'right') rawX = xPct - size.wPct;
      else if (anchor === 'left') rawX = xPct;
      else rawX = xPct - size.wPct / 2;

      const clampX = Math.max(0, Math.min(100 - size.wPct, rawX));
      const clampY = Math.max(0, Math.min(100 - size.hPct, yPct - size.hPct / 2));

      const newField = {
        id: localId(),
        page,
        xPct: clampX,
        yPct: clampY,
        wPct: size.wPct,
        hPct: size.hPct,
        fieldType: pending.fieldType,
        label: pending.label || '',
        required: false,
        order: placements.length,
        valueSource: pending.valueSource,
        businessFieldId: pending.businessFieldId || null,
        signerPersonId: pending.signerPersonId || null,
        signerFieldKey: pending.signerFieldKey || null,
        signerAssetMode: pending.signerAssetMode || null,
        staticValue: pending.staticValue || null,
        language: 'he',
      };
      setPlacements((prev) => [...prev, newField]);
      setDirty(true);
      setSelectedId(newField.id);
      setSelectedAnnotationId(null);
      setPending(null);
    },
    [pending, placements.length, isFinalized, liveBusinessFields],
  );

  const placeAnnotationAt = useCallback(
    (page, xPct, yPct) => {
      if (!pending || pending.mode !== 'annotation' || isFinalized) return;
      const size =
        ANNOTATION_DEFAULT_SIZES[pending.kind] || { wPct: 8, hPct: 5 };
      const clampX = Math.max(0, Math.min(100 - size.wPct, xPct - size.wPct / 2));
      const clampY = Math.max(0, Math.min(100 - size.hPct, yPct - size.hPct / 2));
      const newAnn = {
        id: 'ann_' + Math.random().toString(36).slice(2, 10),
        kind: pending.kind,
        page,
        xPct: clampX,
        yPct: clampY,
        wPct: size.wPct,
        hPct: size.hPct,
        order: annotations.length,
        ...annotationDefaults(pending.kind),
      };
      setAnnotations((prev) => [...prev, newAnn]);
      setDirty(true);
      setSelectedAnnotationId(newAnn.id);
      setSelectedId(null);
      setPending(null);
    },
    [pending, annotations.length, isFinalized],
  );

  // Dispatch for the PdfViewer's click/drop-to-place. PdfViewer emits
  // (mode, page, x, y, dims) — mode is 'field' or 'annotation', dims
  // carries the page's current CSS width/height for content-aware sizing.
  const onPageClick = useCallback(
    (mode, page, x, y, dims) => {
      if (mode === 'annotation') placeAnnotationAt(page, x, y);
      else placeFieldAt(page, x, y, dims);
    },
    [placeFieldAt, placeAnnotationAt],
  );

  function updatePlacement(fid, patch) {
    setPlacements((prev) => prev.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  function deletePlacement(fid) {
    setPlacements((prev) => prev.filter((f) => f.id !== fid));
    if (selectedId === fid) setSelectedId(null);
    setDirty(true);
  }

  function updateAnnotation(aid, patch) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === aid ? { ...a, ...patch } : a)),
    );
    setDirty(true);
  }

  function deleteAnnotation(aid) {
    setAnnotations((prev) => prev.filter((a) => a.id !== aid));
    if (selectedAnnotationId === aid) setSelectedAnnotationId(null);
    setDirty(true);
  }

  async function saveFields() {
    setSaving(true);
    setSaveErr(null);
    try {
      // Save both layers. Fields first so signersSnapshot / businessSnapshot
      // refresh before any preview re-resolution; annotations second.
      await api.documents.saveInstanceFields(id, placements);
      await api.documents.saveInstanceAnnotations(id, annotations);
      await load();
    } catch (e) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Override actions (only for already-persisted placements) ──────────────

  async function saveTextOverride(snapshotFieldId, value) {
    await api.documents.setOverrideText(id, snapshotFieldId, value);
    await load();
  }
  async function saveImageOverride(snapshotFieldId, bytes) {
    await api.documents.setOverrideImage(id, snapshotFieldId, bytes);
    await load();
  }
  async function clearOverride(snapshotFieldId) {
    await api.documents.clearOverride(id, snapshotFieldId);
    await load();
  }

  // ── Finalize / delete ─────────────────────────────────────────────────────

  async function finalize() {
    if (dirty) {
      window.alert('יש שינויים לא שמורים. שמור תחילה לפני סיום.');
      return;
    }
    if (!window.confirm('לאחר סיום, לא ניתן יהיה לערוך את המסמך. להמשיך?')) return;
    setFinalizing(true);
    setFinalizeErr(null);
    try {
      await api.documents.finalize(id);
      await load();
    } catch (e) {
      setFinalizeErr(e.message);
    } finally {
      setFinalizing(false);
    }
  }

  async function deleteInstance() {
    if (!window.confirm('למחוק את המסמך?')) return;
    try {
      await api.documents.removeInstance(id);
      navigate('/admin/documents');
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function saveAsTemplate(title, description) {
    if (dirty) {
      window.alert('שמור שינויים לפני יצירת תבנית.');
      return;
    }
    try {
      const tpl = await api.documents.saveInstanceAsTemplate(id, title, description);
      setSaveTplOpen(false);
      window.alert(`תבנית "${tpl.title}" נוצרה בהצלחה.`);
    } catch (e) {
      window.alert(e.message);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        טוען…
      </div>
    );
  }
  if (error || !instance) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-red-600 mb-2">שגיאה בטעינה</div>
          <div className="text-xs text-gray-500 font-mono" dir="ltr">
            {error}
          </div>
          <button
            onClick={load}
            className="mt-3 text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  const selected = placements.find((f) => f.id === selectedId) || null;
  const selectedAnnotation =
    annotations.find((a) => a.id === selectedAnnotationId) || null;
  const pdfUrl = isFinalized
    ? api.documents.instanceFinalPdfUrl(id)
    : api.documents.instancePdfUrl(id);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <button
              onClick={() => navigate('/admin/documents')}
              className="text-[11px] text-blue-700 hover:underline mb-1"
            >
              ← חזרה למסמכים
            </button>
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {instance.title}
            </h1>
            <div className="text-[11px] text-gray-500 mt-0.5">
              נוצר {relativeHebrew(instance.createdAt)}
              {instance.finalizedAt && (
                <> · סופי {relativeHebrew(instance.finalizedAt)}</>
              )}
              {dirty && <> · <span className="text-amber-700 font-medium">שינויים לא שמורים</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!isFinalized && (
              <>
                <button
                  onClick={saveFields}
                  disabled={!dirty || saving}
                  className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {saving ? 'שומר…' : 'שמור'}
                </button>
                <button
                  onClick={() => setSaveTplOpen(true)}
                  disabled={dirty || placements.length === 0}
                  title={
                    dirty
                      ? 'שמור קודם את השינויים'
                      : placements.length === 0
                      ? 'אין ערכים ממוקמים'
                      : undefined
                  }
                  className="text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                >
                  שמור כתבנית
                </button>
                <button
                  onClick={finalize}
                  disabled={finalizing || dirty}
                  title={dirty ? 'שמור תחילה' : undefined}
                  className="bg-green-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-green-700 disabled:opacity-40"
                >
                  {finalizing ? 'מפיק…' : 'סיים ושמור PDF סופי'}
                </button>
              </>
            )}
            {isFinalized && (
              <a
                href={api.documents.instanceFinalPdfUrl(id)}
                className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-700"
                download
              >
                הורד PDF סופי
              </a>
            )}
            <button
              onClick={deleteInstance}
              disabled={isFinalized}
              title={isFinalized ? 'לא ניתן למחוק מסמך סופי' : undefined}
              className="text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5 disabled:opacity-40"
            >
              מחק
            </button>
          </div>
        </div>
        {isFinalized ? (
          <div className="mt-3 bg-green-50 border border-green-200 text-green-900 rounded p-2 text-sm">
            ✓ המסמך סופי ואינו ניתן לעריכה. התצוגה מציגה את ה-PDF הסופי.
          </div>
        ) : (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 rounded p-2 text-sm">
            תמונת מצב קפואה מ-{new Date(instance.createdAt).toLocaleDateString('he-IL')} — שינויים בשדות העסק ובחותמים לא ישפיעו על מסמך זה לאחר סיום.
          </div>
        )}
        {saveErr && (
          <div className="mt-2 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
            {saveErr}
          </div>
        )}
        {finalizeErr && (
          <div className="mt-2 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
            {finalizeErr}
          </div>
        )}

      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100">
          {!isFinalized && (
            <div
              className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm px-4 py-2"
            >
              <PlacementToolbar
                businessFields={liveBusinessFields}
                signers={liveSigners}
                pending={pending}
                setPending={setPending}
              />
              {pending && (
                <div className="mt-2 bg-blue-50 border border-blue-200 text-blue-900 rounded px-3 py-1 text-[12px] flex items-center gap-2">
                  <span>📍</span>
                  <span className="flex-1">
                    גרור את הפריט אל ה-PDF, או לחץ עליו פעם אחת. <kbd className="opacity-70">ESC</kbd> לביטול.
                  </span>
                  <span className="text-[11px] opacity-80">{pending.label}</span>
                </div>
              )}
            </div>
          )}
          <div className="p-5">
          <PdfViewer
            pdfUrl={pdfUrl}
            fields={placements}
            annotations={annotations}
            readOnly={isFinalized}
            isPlacing={
              !isFinalized && pending
                ? pending.mode === 'annotation'
                  ? 'annotation'
                  : 'field'
                : false
            }
            onPageClick={onPageClick}
            onMoveField={(fid, x, y) =>
              updatePlacement(fid, { xPct: x, yPct: y })
            }
            onResizeField={(fid, w, h) =>
              updatePlacement(fid, { wPct: w, hPct: h })
            }
            onDeleteField={deletePlacement}
            onFieldClick={(fid) => {
              if (isFinalized) return;
              setSelectedId(fid);
              setSelectedAnnotationId(null);
            }}
            selectedFieldId={selectedId}
            renderFieldContent={(f) => (
              <InstanceFieldPreview
                field={f}
                override={overridesByField[f.id]}
                businessMap={businessMap}
                signers={signers}
                liveBusinessFields={liveBusinessFields}
                liveSigners={liveSigners}
                finalized={isFinalized}
              />
            )}
            onMoveAnnotation={(aid, x, y) =>
              updateAnnotation(aid, { xPct: x, yPct: y })
            }
            onResizeAnnotation={(aid, w, h) =>
              updateAnnotation(aid, { wPct: w, hPct: h })
            }
            onDeleteAnnotation={deleteAnnotation}
            onAnnotationClick={(aid) => {
              if (isFinalized) return;
              setSelectedAnnotationId(aid);
              setSelectedId(null);
            }}
            selectedAnnotationId={selectedAnnotationId}
            renderAnnotationContent={(ann, ctx) => (
              <AnnotationVisual ann={ann} pageCssHeight={ctx?.pageCssHeight} />
            )}
          />
          </div>
        </div>

        {!isFinalized && (
          <aside className="hidden md:flex w-[340px] shrink-0 border-r border-gray-200 bg-white flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">
                {selected
                  ? 'ערך'
                  : selectedAnnotation
                  ? 'סימון'
                  : 'בחר ערך או סימון'}
              </h3>
              {!selected && !selectedAnnotation && (
                <div className="text-xs text-gray-500">
                  לחץ על ערך או סימון שממוקם ב-PDF כדי לערוך אותו. השתמש בסרגל בראש העמוד כדי להוסיף חדשים.
                </div>
              )}
              {selected && (
                <SelectedPanel
                  key={selected.id}
                  field={selected}
                  override={overridesByField[selected.id]}
                  businessMap={businessMap}
                  signers={signers}
                  onSaveText={(v) => saveTextOverride(selected.id, v)}
                  onSaveImage={(bytes) => saveImageOverride(selected.id, bytes)}
                  onClear={() => clearOverride(selected.id)}
                  onDelete={() => deletePlacement(selected.id)}
                  onSetLanguage={(lang) =>
                    updatePlacement(selected.id, { language: lang })
                  }
                  dirtyField={selected.id.startsWith('local_')}
                />
              )}
              {selectedAnnotation && (
                <SelectedAnnotationPanel
                  key={selectedAnnotation.id}
                  ann={selectedAnnotation}
                  onUpdate={(patch) =>
                    updateAnnotation(selectedAnnotation.id, patch)
                  }
                  onDelete={() => deleteAnnotation(selectedAnnotation.id)}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {saveTplOpen && (
        <SaveAsTemplateDialog
          defaultTitle={instance.title}
          onClose={() => setSaveTplOpen(false)}
          onSubmit={saveAsTemplate}
        />
      )}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────
//
// Primary interaction is drag-and-drop: each button is a drag source; drop
// onto any PDF page places the pre-wired value/annotation at the drop point.
// Click-to-place still works as a fallback (touch devices, accessibility).
// Both paths share the same `pending` state + the same PdfPage placement
// math via onPageClick(mode, page, xPct, yPct).

// Returns the props to spread onto a draggable toolbar button. Pure function,
// not a hook — safe to call inside .map().
function makeArmProps(setPending, pendingToken, config) {
  const active = pendingToken === config.token;
  return {
    active,
    draggable: true,
    onClick: () => setPending(active ? null : config),
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      // Token is only used by the browser drag layer; real payload is
      // carried via the `pending` state (PdfPage reads placementMode).
      e.dataTransfer.setData('text/plain', config.token);
      setPending(config);
    },
    onDragEnd: (e) => {
      // If the drop wasn't consumed, clear pending so the UI returns to idle.
      if (e.dataTransfer.dropEffect === 'none') setPending(null);
    },
  };
}

function PlacementToolbar({ businessFields, signers, pending, setPending }) {
  const [signerMode, setSignerMode] = useState(null); // 'draw'|'stamp'|'combined'|null — active signer picker
  const signerModeLabel = {
    draw: 'חתימה',
    stamp: 'חותמת',
    combined: 'חתימה + חותמת',
  };

  function businessConfig(bf) {
    return {
      mode: 'field',
      token: `bf:${bf.id}`,
      fieldType: 'text',
      valueSource: 'business_field',
      businessFieldId: bf.id,
      label: bf.label,
    };
  }

  function signerConfig(signer, mode) {
    const ft =
      mode === 'draw' ? 'signature' : mode === 'stamp' ? 'stamp' : 'combined';
    return {
      mode: 'field',
      token: `signer:${signer.id}:${mode}`,
      fieldType: ft,
      valueSource: 'signer_asset',
      signerPersonId: signer.id,
      signerAssetMode: mode,
      label: `${signerModeLabel[mode]} — ${signer.displayName}`,
    };
  }

  const dateConfig = {
    mode: 'field',
    token: 'date',
    fieldType: 'date',
    valueSource: 'override_only',
    label: 'תאריך',
  };
  const freeTextConfig = {
    mode: 'field',
    token: 'text',
    fieldType: 'text',
    valueSource: 'override_only',
    label: 'טקסט חופשי',
  };

  function annotationConfig(kind, label) {
    return {
      mode: 'annotation',
      token: `ann:${kind}`,
      kind,
      label,
    };
  }

  const btn = (active) =>
    `text-[12px] rounded px-3 py-1.5 border transition select-none ${
      active
        ? 'bg-blue-600 text-white border-blue-600 shadow'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-blue-300 cursor-grab active:cursor-grabbing'
    }`;

  const { active: dateActive, ...dateProps } = makeArmProps(
    setPending,
    pending?.token,
    dateConfig,
  );
  const { active: freeTextActive, ...freeTextProps } = makeArmProps(
    setPending,
    pending?.token,
    freeTextConfig,
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {businessFields.length === 0 ? (
        <span className="text-[11px] text-gray-500 italic">
          עדיין אין שדות קבועים של העסק. הגדר אותם בלשונית "שדות קבועים".
        </span>
      ) : (
        <>
          <span className="text-[11px] text-gray-500 font-medium">ערכים:</span>
          {businessFields.map((bf) => {
            const props = makeArmProps(
              setPending,
              pending?.token,
              businessConfig(bf),
            );
            const { active, ...rest } = props;
            return (
              <button
                key={bf.id}
                {...rest}
                title={
                  (bf.valueHe || bf.valueEn || bf.value)
                    ? `ערך נוכחי: ${bf.valueHe || bf.valueEn || bf.value}`
                    : 'אין ערך מוגדר'
                }
                className={btn(active)}
              >
                + {bf.label}
              </button>
            );
          })}
          <span className="w-px h-5 bg-gray-300 mx-1" />
        </>
      )}

      <SignerButton
        mode="draw"
        label="+ חתימה"
        signers={signers}
        open={signerMode === 'draw'}
        activeToken={pending?.token}
        setPending={setPending}
        pendingToken={pending?.token}
        makeConfig={(s) => signerConfig(s, 'draw')}
        onOpen={() => setSignerMode((m) => (m === 'draw' ? null : 'draw'))}
        onClose={() => setSignerMode(null)}
      />
      <SignerButton
        mode="stamp"
        label="+ חותמת"
        signers={signers}
        open={signerMode === 'stamp'}
        activeToken={pending?.token}
        setPending={setPending}
        pendingToken={pending?.token}
        makeConfig={(s) => signerConfig(s, 'stamp')}
        onOpen={() => setSignerMode((m) => (m === 'stamp' ? null : 'stamp'))}
        onClose={() => setSignerMode(null)}
      />
      <SignerButton
        mode="combined"
        label="+ חתימה + חותמת"
        signers={signers}
        open={signerMode === 'combined'}
        activeToken={pending?.token}
        setPending={setPending}
        pendingToken={pending?.token}
        makeConfig={(s) => signerConfig(s, 'combined')}
        onOpen={() =>
          setSignerMode((m) => (m === 'combined' ? null : 'combined'))
        }
        onClose={() => setSignerMode(null)}
      />

      <span className="w-px h-5 bg-gray-300 mx-1" />

      <button {...dateProps} className={btn(dateActive)}>
        + תאריך
      </button>
      <button {...freeTextProps} className={btn(freeTextActive)}>
        + טקסט חופשי
      </button>

      {/* Second row: visual annotations. Separate layer from value fields. */}
      <div className="w-full h-px bg-gray-200 my-1" />
      <span className="text-[11px] text-gray-500 font-medium">סימונים:</span>
      {[
        { kind: 'check', label: '+ ✓', cfgLabel: '✓' },
        { kind: 'x', label: '+ ✗', cfgLabel: '✗' },
        { kind: 'highlight', label: '+ הדגשה', cfgLabel: 'הדגשה' },
        { kind: 'line', label: '+ קו', cfgLabel: 'קו' },
        { kind: 'note', label: '+ הערה', cfgLabel: 'הערה' },
      ].map(({ kind, label, cfgLabel }) => {
        const props = makeArmProps(
          setPending,
          pending?.token,
          annotationConfig(kind, cfgLabel),
        );
        const { active, ...rest } = props;
        return (
          <button key={kind} {...rest} className={btn(active)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SignerButton({
  mode,
  label,
  signers,
  open,
  activeToken,
  setPending,
  pendingToken,
  makeConfig,
  onOpen,
  onClose,
}) {
  const disabled = signers.length === 0;
  const eligible = signers.filter((s) =>
    (s.assets || []).some((a) => a.assetType === mode),
  );

  // When exactly one eligible signer exists, the main button becomes a direct
  // drag source for that signer's config. Otherwise the button opens a picker
  // popover; each signer inside the popover is itself a drag source.
  const singleEligible = eligible.length === 1 ? eligible[0] : null;
  const singleProps = singleEligible
    ? makeArmProps(setPending, pendingToken, makeConfig(singleEligible))
    : null;

  const thisActive =
    !!singleProps?.active ||
    (activeToken?.startsWith('signer:') && activeToken.endsWith(`:${mode}`));

  return (
    <div className="relative">
      <button
        disabled={disabled}
        title={disabled ? 'אין חותמים. צור חותם בלשונית "חותמים".' : undefined}
        draggable={!!singleProps}
        onDragStart={singleProps?.onDragStart}
        onDragEnd={singleProps?.onDragEnd}
        onClick={() => {
          if (eligible.length === 0) {
            window.alert(
              'אין חותמים עם נכס תואם. פתח את לשונית "חותמים" כדי להוסיף חתימה/חותמת.',
            );
            return;
          }
          if (singleProps) {
            singleProps.onClick();
            return;
          }
          onOpen();
        }}
        className={`text-[12px] rounded px-3 py-1.5 border transition select-none ${
          open || thisActive
            ? 'bg-blue-600 text-white border-blue-600 shadow'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-blue-300'
        } ${singleProps ? 'cursor-grab active:cursor-grabbing' : ''} disabled:opacity-40`}
      >
        {label}
      </button>
      {open && (
        <div
          className="absolute z-30 top-full mt-1 min-w-[220px] bg-white border border-gray-200 rounded-md shadow-lg py-1"
          dir="rtl"
          onMouseLeave={onClose}
        >
          {eligible.map((s) => {
            const itemProps = makeArmProps(
              setPending,
              pendingToken,
              makeConfig(s),
            );
            const { active, ...rest } = itemProps;
            return (
              <button
                key={s.id}
                {...rest}
                onClickCapture={() => onClose()}
                className={`w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50 ${
                  active ? 'bg-blue-50 text-blue-800' : ''
                } cursor-grab active:cursor-grabbing`}
              >
                {s.displayName}
                {s.role && <span className="text-gray-500"> — {s.role}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Preview inside field box ─────────────────────────────────────────────────

function InstanceFieldPreview({
  field,
  override,
  businessMap,
  signers,
  liveBusinessFields,
  liveSigners,
  finalized,
}) {
  if (finalized) return null;
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);

  if (isImage) {
    if (override?.assetBytes) {
      return <span className="italic opacity-70">חתימה מוחלפת</span>;
    }
    if (
      field.valueSource === 'signer_asset' &&
      field.signerPersonId &&
      field.signerAssetMode
    ) {
      const signer =
        signers.find((s) => s.id === field.signerPersonId) ||
        liveSigners.find((s) => s.id === field.signerPersonId);
      const asset = signer?.assets?.find(
        (a) => a.assetType === field.signerAssetMode,
      );
      if (signer && asset) {
        return (
          <img
            src={api.signers.assetPngUrl(signer.id, asset.id)}
            alt=""
            className="h-full w-full object-contain"
          />
        );
      }
    }
    return <span className="italic opacity-70">{field.label || 'חתימה'}</span>;
  }

  const text = resolveInstanceText(
    field,
    override,
    businessMap,
    signers,
    liveBusinessFields,
    liveSigners,
  );
  const showEnChip =
    field.valueSource === 'business_field' && field.language === 'en';
  const displayed = text || field.label || '—';
  const isRtl = HEB_RE.test(displayed);
  return (
    <span
      dir={isRtl ? 'rtl' : 'ltr'}
      className={`truncate flex items-center gap-1 w-full ${
        isRtl ? 'justify-end' : 'justify-start'
      }`}
    >
      {displayed}
      {showEnChip && (
        <span
          className="shrink-0 text-[8px] font-bold bg-indigo-600 text-white px-1 py-0 rounded leading-none"
          dir="ltr"
        >
          EN
        </span>
      )}
    </span>
  );
}

function resolveInstanceText(
  field,
  override,
  businessMap,
  signers,
  liveBusinessFields,
  liveSigners,
) {
  let text = '';
  if (override && override.textValue != null) text = override.textValue;
  else if (field.valueSource === 'static') text = field.staticValue || '';
  else if (field.valueSource === 'business_field' && field.businessFieldId) {
    const snap = businessMap[field.businessFieldId];
    if (snap) text = pickBusinessValue(snap, field.language);
    else {
      const live = liveBusinessFields?.find((b) => b.id === field.businessFieldId);
      text = live ? pickBusinessValue(live, field.language) : '';
    }
  } else if (
    field.valueSource === 'signer_field' &&
    field.signerPersonId &&
    field.signerFieldKey
  ) {
    const s =
      signers.find((x) => x.id === field.signerPersonId) ||
      liveSigners?.find((x) => x.id === field.signerPersonId);
    if (s) {
      const builtin = s[field.signerFieldKey];
      if (typeof builtin === 'string' || typeof builtin === 'number') {
        text = String(builtin);
      } else {
        const extra = (s.extraFields || {})[field.signerFieldKey];
        text = extra != null ? String(extra) : '';
      }
    }
  }
  // Date fallback: empty date fields auto-fill with today's date so the
  // preview matches the finalized PDF (server applies the same rule).
  if (field.fieldType === 'date' && !String(text).trim()) {
    text = todayIso();
  }
  // Preview-side: if a date value is ISO YYYY-MM-DD, format to DD/MM/YYYY so
  // on-screen matches what the server will write into the final PDF.
  if (field.fieldType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    text = formatIsoDate(text);
  }
  return text;
}

// ── Selected field sidebar ───────────────────────────────────────────────────

function SelectedPanel({
  field,
  override,
  businessMap,
  signers,
  onSaveText,
  onSaveImage,
  onClear,
  onDelete,
  onSetLanguage,
  dirtyField,
}) {
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);
  const isBusiness = field.valueSource === 'business_field';
  const hasOverride = !!(
    override &&
    (override.textValue != null || override.assetBytes != null)
  );

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-700">
        <div className="font-medium text-gray-900 mb-1">
          {field.label || field.fieldType}
        </div>
        <div className="text-[11px] text-gray-500">
          סוג: {field.fieldType} · מקור: {describeSource(field)}
        </div>
        {dirtyField && (
          <div className="text-[11px] text-amber-700 mt-1">
            ערך חדש — שמור את המסמך כדי לקבע את המיקום.
          </div>
        )}
      </div>

      {isBusiness && (
        <div>
          <div className="text-[11px] text-gray-600 mb-1">שפה</div>
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            <button
              onClick={() => onSetLanguage('he')}
              className={`text-[12px] px-3 py-1 ${
                field.language !== 'en'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              עברית
            </button>
            <button
              onClick={() => onSetLanguage('en')}
              className={`text-[12px] px-3 py-1 border-r border-gray-300 ${
                field.language === 'en'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              dir="ltr"
            >
              English
            </button>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            ברירת המחדל עברית. ניתן להעביר לאנגלית לשדה הזה בלבד.
          </div>
        </div>
      )}

      {!dirtyField && isImage && (
        <ImageOverride
          override={override}
          field={field}
          signers={signers}
          onSaveImage={onSaveImage}
        />
      )}
      {!dirtyField && !isImage && (
        <TextOverride
          field={field}
          override={override}
          resolvedText={resolveInstanceText(field, null, businessMap, signers)}
          onSaveText={onSaveText}
        />
      )}

      {!dirtyField && hasOverride && (
        <button
          onClick={onClear}
          className="text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1"
        >
          נקה דריסה
        </button>
      )}

      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={onDelete}
          className="w-full text-[12px] text-red-700 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5"
        >
          הסר ערך מהמסמך
        </button>
      </div>
    </div>
  );
}

function describeSource(f) {
  switch (f.valueSource) {
    case 'business_field':
      return 'שדה קבוע';
    case 'signer_field':
      return 'שדה של חותם';
    case 'signer_asset':
      return 'חתימה/חותמת';
    case 'static':
      return 'טקסט קבוע';
    case 'override_only':
    default:
      return 'מוגדר במסמך';
  }
}

function TextOverride({ field, override, resolvedText, onSaveText }) {
  const [value, setValue] = useState(
    override?.textValue != null ? override.textValue : '',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const usingOverride = override?.textValue != null;
  const displayValue = usingOverride ? override.textValue : resolvedText;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSaveText(value);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] text-gray-600 mb-1">ערך נוכחי</div>
        <div className="bg-white border border-gray-200 rounded p-2 text-sm min-h-[32px]">
          {displayValue || <span className="text-gray-400 italic">— ריק —</span>}
        </div>
        {!usingOverride && (
          <div className="text-[10px] text-gray-500 mt-0.5">
            מגיע מ{describeSource(field)}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] text-gray-600 mb-1">ערך למסמך זה</div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={resolvedText || 'ערך חדש'}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </div>
      <button
        onClick={save}
        disabled={saving || value === (override?.textValue ?? '')}
        className="w-full bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
      >
        {saving ? 'שומר…' : 'שמור ערך'}
      </button>
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}
    </div>
  );
}

function ImageOverride({ override, field, signers, onSaveImage }) {
  const [padOpen, setPadOpen] = useState(false);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const signer = signers.find((s) => s.id === field.signerPersonId);
  const asset = signer?.assets?.find((a) => a.assetType === field.signerAssetMode);
  const usingOverride = !!override?.assetBytes;

  async function saveFromDataUrl(dataUrl) {
    setPadOpen(false);
    setBusy(true);
    setErr(null);
    try {
      const bytes = dataUrlToBytes(dataUrl);
      await onSaveImage(bytes);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'image/png') {
      setErr('יש להעלות PNG בלבד.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await onSaveImage(bytes);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] text-gray-600 mb-1">נכס נוכחי</div>
        <div className="bg-white border border-gray-200 rounded p-2 h-28 flex items-center justify-center">
          {usingOverride ? (
            <span className="text-xs text-gray-600 italic">חתימה מוחלפת במסמך זה</span>
          ) : asset && signer ? (
            <img
              src={api.signers.assetPngUrl(signer.id, asset.id)}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-gray-400 italic">אין חתימה</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPadOpen(true)}
          disabled={busy}
          className="flex-1 text-[12px] bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 disabled:opacity-40"
        >
          ✎ ציור דריסה
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex-1 text-[12px] border border-gray-300 text-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
        >
          העלה PNG
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={onFileChosen}
        />
      </div>
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
          {err}
        </div>
      )}
      {padOpen && (
        <SignaturePad
          onConfirm={saveFromDataUrl}
          onClose={() => setPadOpen(false)}
        />
      )}
    </div>
  );
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Bilingual value resolution. Accepts both the new shape (valueHe/valueEn)
// and the old shape (value) so finalized instances with pre-migration
// businessSnapshot JSON keep rendering correctly.
//
// HE → EN fallback: if the selected language is Hebrew but valueHe is empty
// and valueEn has content, use valueEn. Prevents silently-empty previews for
// English-only values. One-way: English with empty valueEn stays empty.
function pickBusinessValue(bf, language) {
  if (!bf) return '';
  if (bf.valueHe !== undefined || bf.valueEn !== undefined) {
    const he = bf.valueHe || '';
    const en = bf.valueEn || '';
    if (language === 'en') return en;
    return he || en;
  }
  return bf.value || '';
}

// ── Annotation visual (rendered inside the overlay rect) ─────────────────────

function AnnotationVisual({ ann, pageCssHeight }) {
  if (ann.kind === 'highlight') {
    return (
      <div
        className="w-full h-full"
        style={{
          backgroundColor: ann.color || '#fde047',
          opacity: typeof ann.opacity === 'number' ? ann.opacity : 0.35,
        }}
      />
    );
  }
  if (ann.kind === 'line') {
    return <LineVisual ann={ann} />;
  }
  if (ann.kind === 'check') {
    return <MarkVisual kind="check" color={ann.color || '#111827'} />;
  }
  if (ann.kind === 'x') {
    return <MarkVisual kind="x" color={ann.color || '#b91c1c'} />;
  }
  if (ann.kind === 'note') {
    const fontSize = clampFont(
      typeof ann.fontSize === 'number'
        ? ann.fontSize
        : (ann.hPct / 100) * (pageCssHeight || 0) * 0.65,
    );
    return (
      <div
        className="w-full h-full overflow-hidden px-1 leading-tight"
        style={{
          color: ann.color || '#111827',
          fontSize: `${fontSize}px`,
          direction: 'rtl',
          textAlign: 'right',
        }}
      >
        {ann.text || <span className="opacity-50 italic">הערה</span>}
      </div>
    );
  }
  return null;
}

function clampFont(px) {
  if (!Number.isFinite(px)) return 14;
  return Math.max(11, Math.min(48, px));
}

function MarkVisual({ kind, color }) {
  // SVG in the full rect so the stroke scales with the overlay size.
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-full h-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      {kind === 'check' ? (
        <polyline
          points="4,13 10,19 20,6"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <g
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        >
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="5" y1="19" x2="19" y2="5" />
        </g>
      )}
    </svg>
  );
}

function LineVisual({ ann }) {
  const thickness = Math.max(1, Math.min(12, Number(ann.thickness) || 2));
  const color = ann.color || '#111827';
  if (ann.orientation === 'vertical') {
    return (
      <div className="w-full h-full flex justify-center">
        <div style={{ width: thickness, height: '100%', backgroundColor: color }} />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center">
      <div style={{ height: thickness, width: '100%', backgroundColor: color }} />
    </div>
  );
}

// ── Annotation sidebar panel ─────────────────────────────────────────────────

function SelectedAnnotationPanel({ ann, onUpdate, onDelete }) {
  const kindLabel =
    ann.kind === 'check'
      ? 'סימן ✓'
      : ann.kind === 'x'
      ? 'סימן ✗'
      : ann.kind === 'highlight'
      ? 'הדגשה'
      : ann.kind === 'line'
      ? 'קו'
      : 'הערה';

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-700">
        <div className="font-medium text-gray-900 mb-1">{kindLabel}</div>
        <div className="text-[11px] text-gray-500">
          עמ׳ {ann.page} · X {ann.xPct.toFixed(1)}% · Y {ann.yPct.toFixed(1)}% · W{' '}
          {ann.wPct.toFixed(1)}% · H {ann.hPct.toFixed(1)}%
        </div>
      </div>

      {(ann.kind === 'check' || ann.kind === 'x' || ann.kind === 'line') && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[11px] text-gray-600 mb-1">צבע</div>
            <input
              type="color"
              value={ann.color || (ann.kind === 'x' ? '#b91c1c' : '#111827')}
              onChange={(e) => onUpdate({ color: e.target.value })}
              className="w-full h-8 border border-gray-300 rounded"
            />
          </label>
          <label className="block">
            <div className="text-[11px] text-gray-600 mb-1">
              עובי {Number(ann.thickness) || 2}
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={Number(ann.thickness) || 2}
              onChange={(e) => onUpdate({ thickness: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </div>
      )}

      {ann.kind === 'highlight' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[11px] text-gray-600 mb-1">צבע</div>
            <input
              type="color"
              value={ann.color || '#fde047'}
              onChange={(e) => onUpdate({ color: e.target.value })}
              className="w-full h-8 border border-gray-300 rounded"
            />
          </label>
          <label className="block">
            <div className="text-[11px] text-gray-600 mb-1">
              שקיפות {Math.round((ann.opacity ?? 0.35) * 100)}%
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={ann.opacity ?? 0.35}
              onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </div>
      )}

      {ann.kind === 'line' && (
        <div>
          <div className="text-[11px] text-gray-600 mb-1">כיוון</div>
          <div className="inline-flex rounded border border-gray-300 overflow-hidden">
            <button
              onClick={() => onUpdate({ orientation: 'horizontal' })}
              className={`text-[12px] px-3 py-1 ${
                (ann.orientation || 'horizontal') === 'horizontal'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700'
              }`}
            >
              אופקי
            </button>
            <button
              onClick={() => onUpdate({ orientation: 'vertical' })}
              className={`text-[12px] px-3 py-1 border-r border-gray-300 ${
                ann.orientation === 'vertical'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700'
              }`}
            >
              אנכי
            </button>
          </div>
        </div>
      )}

      {ann.kind === 'note' && (
        <>
          <label className="block">
            <div className="text-[11px] text-gray-600 mb-1">טקסט</div>
            <textarea
              value={ann.text || ''}
              onChange={(e) => onUpdate({ text: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm h-20"
              dir="rtl"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[11px] text-gray-600 mb-1">צבע</div>
              <input
                type="color"
                value={ann.color || '#111827'}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="w-full h-8 border border-gray-300 rounded"
              />
            </label>
            <label className="block">
              <div className="text-[11px] text-gray-600 mb-1">
                גודל גופן {Number(ann.fontSize) || 14}
              </div>
              <input
                type="range"
                min={8}
                max={48}
                step={1}
                value={Number(ann.fontSize) || 14}
                onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                className="w-full"
              />
            </label>
          </div>
        </>
      )}

      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={onDelete}
          className="w-full text-[12px] text-red-700 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5"
        >
          הסר סימון
        </button>
      </div>
    </div>
  );
}

function SaveAsTemplateDialog({ defaultTitle, onClose, onSubmit }) {
  const [title, setTitle] = useState(defaultTitle || '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSubmit(title.trim(), description.trim() || undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      dir="rtl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-white w-full max-w-md rounded-xl shadow-2xl p-5 space-y-3"
      >
        <h3 className="text-base font-semibold">שמור כתבנית</h3>
        <p className="text-xs text-gray-600">
          התבנית תכלול את כל הערכים הממוקמים במסמך זה. אפשר יהיה ליצור ממנה מסמכים חדשים בעתיד.
        </p>
        <label className="block">
          <div className="text-[12px] text-gray-600 mb-1">שם התבנית</div>
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <div className="text-[12px] text-gray-600 mb-1">תיאור (אופציונלי)</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm h-20"
          />
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="flex-1 bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {busy ? 'יוצר…' : 'צור תבנית'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}
