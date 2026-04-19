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

const PLACEMENT_DEFAULT_SIZES = {
  text: { wPct: 28, hPct: 4 },
  date: { wPct: 18, hPct: 4 },
  number: { wPct: 14, hPct: 4 },
  phone: { wPct: 18, hPct: 4 },
  email: { wPct: 22, hPct: 4 },
  signature: { wPct: 22, hPct: 8 },
  stamp: { wPct: 18, hPct: 10 },
  combined: { wPct: 28, hPct: 10 },
};

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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const [finalizing, setFinalizing] = useState(false);
  const [finalizeErr, setFinalizeErr] = useState(null);

  // Placement mode — set by clicking a toolbar button; cleared after placement
  // or ESC. Shape: { fieldType, valueSource, ...refs, label? }.
  const [pending, setPending] = useState(null);

  const [selectedId, setSelectedId] = useState(null);

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

  const placeAt = useCallback(
    (page, xPct, yPct) => {
      if (!pending || isFinalized) return;
      const size = PLACEMENT_DEFAULT_SIZES[pending.fieldType] || { wPct: 20, hPct: 5 };
      const clampX = Math.max(0, Math.min(100 - size.wPct, xPct - size.wPct / 2));
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
      };
      setPlacements((prev) => [...prev, newField]);
      setDirty(true);
      setSelectedId(newField.id);
      setPending(null);
    },
    [pending, placements.length, isFinalized],
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

  async function saveFields() {
    setSaving(true);
    setSaveErr(null);
    try {
      await api.documents.saveInstanceFields(id, placements);
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

        {!isFinalized && (
          <PlacementToolbar
            businessFields={liveBusinessFields}
            signers={liveSigners}
            pending={pending}
            setPending={setPending}
          />
        )}
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100 p-5">
          {pending && (
            <div className="mb-3 bg-blue-600 text-white rounded px-3 py-1.5 text-sm flex items-center gap-3">
              <span>📍</span>
              <span className="flex-1">
                ממתין למיקום — לחץ על ה-PDF. <kbd className="opacity-80">ESC</kbd> לביטול.
              </span>
              <span className="text-[11px] opacity-80">{pending.label}</span>
            </div>
          )}
          <PdfViewer
            pdfUrl={pdfUrl}
            fields={placements}
            readOnly={isFinalized}
            isPlacing={!isFinalized && !!pending}
            onPageClick={placeAt}
            onMoveField={(fid, x, y) =>
              updatePlacement(fid, { xPct: x, yPct: y })
            }
            onResizeField={(fid, w, h) =>
              updatePlacement(fid, { wPct: w, hPct: h })
            }
            onDeleteField={deletePlacement}
            onFieldClick={(fid) => !isFinalized && setSelectedId(fid)}
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
          />
        </div>

        {!isFinalized && (
          <aside className="hidden md:flex w-[340px] shrink-0 border-r border-gray-200 bg-white flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">
                {selected ? 'ערך' : 'בחר ערך'}
              </h3>
              {!selected && (
                <div className="text-xs text-gray-500">
                  לחץ על ערך שממוקם ב-PDF כדי לערוך אותו. השתמש בסרגל בראש העמוד כדי להוסיף ערכים חדשים.
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
                  dirtyField={selected.id.startsWith('local_')}
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

function PlacementToolbar({ businessFields, signers, pending, setPending }) {
  const [signerMode, setSignerMode] = useState(null); // 'draw'|'stamp'|'combined'|null — active signer picker
  const signerModeLabel = {
    draw: 'חתימה',
    stamp: 'חותמת',
    combined: 'חתימה + חותמת',
  };

  function arm(config) {
    setPending(pending?.token === config.token ? null : config);
  }

  function armBusiness(bf) {
    arm({
      token: `bf:${bf.id}`,
      fieldType: 'text',
      valueSource: 'business_field',
      businessFieldId: bf.id,
      label: bf.label,
    });
  }

  function armSigner(signer, mode) {
    const ft =
      mode === 'draw' ? 'signature' : mode === 'stamp' ? 'stamp' : 'combined';
    arm({
      token: `signer:${signer.id}:${mode}`,
      fieldType: ft,
      valueSource: 'signer_asset',
      signerPersonId: signer.id,
      signerAssetMode: mode,
      label: `${signerModeLabel[mode]} — ${signer.displayName}`,
    });
    setSignerMode(null);
  }

  function armDate() {
    arm({
      token: 'date',
      fieldType: 'date',
      valueSource: 'override_only',
      label: 'תאריך',
    });
  }
  function armFreeText() {
    arm({
      token: 'text',
      fieldType: 'text',
      valueSource: 'override_only',
      label: 'טקסט חופשי',
    });
  }

  const btn = (active) =>
    `text-[12px] rounded px-3 py-1.5 border transition ${
      active
        ? 'bg-blue-600 text-white border-blue-600 shadow'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
    }`;

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      {businessFields.length === 0 ? (
        <span className="text-[11px] text-gray-500 italic">
          עדיין אין שדות קבועים של העסק. הגדר אותם בלשונית "שדות קבועים".
        </span>
      ) : (
        <>
          <span className="text-[11px] text-gray-500 font-medium">ערכים קבועים:</span>
          {businessFields.map((bf) => {
            const active = pending?.token === `bf:${bf.id}`;
            return (
              <button
                key={bf.id}
                onClick={() => armBusiness(bf)}
                title={bf.value ? `ערך נוכחי: ${bf.value}` : 'אין ערך מוגדר'}
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
        onOpen={() => setSignerMode((m) => (m === 'draw' ? null : 'draw'))}
        onPick={(s) => armSigner(s, 'draw')}
        onClose={() => setSignerMode(null)}
      />
      <SignerButton
        mode="stamp"
        label="+ חותמת"
        signers={signers}
        open={signerMode === 'stamp'}
        activeToken={pending?.token}
        onOpen={() => setSignerMode((m) => (m === 'stamp' ? null : 'stamp'))}
        onPick={(s) => armSigner(s, 'stamp')}
        onClose={() => setSignerMode(null)}
      />
      <SignerButton
        mode="combined"
        label="+ חתימה + חותמת"
        signers={signers}
        open={signerMode === 'combined'}
        activeToken={pending?.token}
        onOpen={() =>
          setSignerMode((m) => (m === 'combined' ? null : 'combined'))
        }
        onPick={(s) => armSigner(s, 'combined')}
        onClose={() => setSignerMode(null)}
      />

      <span className="w-px h-5 bg-gray-300 mx-1" />

      <button onClick={armDate} className={btn(pending?.token === 'date')}>
        + תאריך
      </button>
      <button onClick={armFreeText} className={btn(pending?.token === 'text')}>
        + טקסט חופשי
      </button>
    </div>
  );
}

function SignerButton({
  mode,
  label,
  signers,
  open,
  activeToken,
  onOpen,
  onPick,
  onClose,
}) {
  const disabled = signers.length === 0;
  const eligible = signers.filter((s) =>
    (s.assets || []).some((a) => a.assetType === mode),
  );

  return (
    <div className="relative">
      <button
        disabled={disabled}
        title={disabled ? 'אין חותמים. צור חותם בלשונית "חותמים".' : undefined}
        onClick={() => {
          if (eligible.length === 0) {
            window.alert(
              'אין חותמים עם נכס תואם. פתח את לשונית "חותמים" כדי להוסיף חתימה/חותמת.',
            );
            return;
          }
          if (eligible.length === 1) {
            onPick(eligible[0]);
            return;
          }
          onOpen();
        }}
        className={`text-[12px] rounded px-3 py-1.5 border transition ${
          open
            ? 'bg-blue-600 text-white border-blue-600 shadow'
            : activeToken?.startsWith(`signer:`) && activeToken.endsWith(`:${mode}`)
            ? 'bg-blue-100 text-blue-800 border-blue-300'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
        } disabled:opacity-40`}
      >
        {label}
      </button>
      {open && (
        <div
          className="absolute z-30 top-full mt-1 min-w-[200px] bg-white border border-gray-200 rounded-md shadow-lg py-1"
          dir="rtl"
          onMouseLeave={onClose}
        >
          {eligible.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="w-full text-right px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {s.displayName}
              {s.role && <span className="text-gray-500"> — {s.role}</span>}
            </button>
          ))}
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
  return <span className="truncate">{text || field.label || '—'}</span>;
}

function resolveInstanceText(
  field,
  override,
  businessMap,
  signers,
  liveBusinessFields,
  liveSigners,
) {
  if (override && override.textValue != null) return override.textValue;
  if (field.valueSource === 'static') return field.staticValue || '';
  if (field.valueSource === 'business_field' && field.businessFieldId) {
    const snap = businessMap[field.businessFieldId];
    if (snap) return snap.value || '';
    const live = liveBusinessFields?.find((b) => b.id === field.businessFieldId);
    return live?.value || '';
  }
  if (
    field.valueSource === 'signer_field' &&
    field.signerPersonId &&
    field.signerFieldKey
  ) {
    const s =
      signers.find((x) => x.id === field.signerPersonId) ||
      liveSigners?.find((x) => x.id === field.signerPersonId);
    if (!s) return '';
    const builtin = s[field.signerFieldKey];
    if (typeof builtin === 'string' || typeof builtin === 'number') {
      return String(builtin);
    }
    const extra = (s.extraFields || {})[field.signerFieldKey];
    return extra != null ? String(extra) : '';
  }
  return '';
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
  dirtyField,
}) {
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);
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
