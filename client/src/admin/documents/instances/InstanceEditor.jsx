import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import PdfViewer from '../shared/PdfViewer.jsx';
import SignaturePad from '../shared/SignaturePad.jsx';
import { IMAGE_FIELD_TYPES } from '../config.js';

// Instance editor — admin sets per-field overrides, previews live resolved
// values over the frozen snapshot PDF, then finalizes.
export default function InstanceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [instance, setInstance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeErr, setFinalizeErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const inst = await api.documents.getInstance(id);
      setInstance(inst);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isFinalized = instance?.status === 'finalized';
  const fields = Array.isArray(instance?.fieldsSnapshot) ? instance.fieldsSnapshot : [];
  const overridesByField = useMemo(() => {
    const m = {};
    for (const o of instance?.overrides || []) m[o.snapshotFieldId] = o;
    return m;
  }, [instance]);

  const businessMap = instance?.businessSnapshot || {};
  const signers = Array.isArray(instance?.signersSnapshot)
    ? instance.signersSnapshot
    : [];

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

  async function finalize() {
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
      navigate('/admin/documents/templates');
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
          <div className="text-xs text-gray-500 font-mono" dir="ltr">{error}</div>
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

  const selected = fields.find((f) => f.id === selectedId) || null;
  const pdfUrl = isFinalized
    ? api.documents.instanceFinalPdfUrl(id)
    : api.documents.instancePdfUrl(id);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-0.5">
              מסמך
            </div>
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {instance.title}
            </h1>
            <div className="text-[11px] text-gray-500 mt-0.5">
              נוצר {relativeHebrew(instance.createdAt)}
              {instance.finalizedAt && (
                <> • סופי {relativeHebrew(instance.finalizedAt)}</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isFinalized && (
              <button
                onClick={finalize}
                disabled={finalizing}
                className="bg-green-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-green-700 disabled:opacity-40"
              >
                {finalizing ? 'מפיק…' : 'סיים ושמור PDF סופי'}
              </button>
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
            תמונת מצב קפואה מתאריך {new Date(instance.createdAt).toLocaleDateString('he-IL')}. שינויים בתבנית ובשדות העסק לא ישפיעו על מסמך זה.
          </div>
        )}
        {finalizeErr && (
          <div className="mt-2 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
            {finalizeErr}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100 p-5">
          <PdfViewer
            pdfUrl={pdfUrl}
            fields={fields}
            readOnly
            isPlacing={false}
            onFieldClick={(fid) => !isFinalized && setSelectedId(fid)}
            selectedFieldId={selectedId}
            renderFieldContent={(f) => (
              <InstanceFieldPreview
                field={f}
                override={overridesByField[f.id]}
                businessMap={businessMap}
                signers={signers}
                finalized={isFinalized}
              />
            )}
          />
        </div>

        {!isFinalized && (
          <aside className="hidden md:flex w-[340px] shrink-0 border-r border-gray-200 bg-white flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">
                {selected ? 'ערך לשדה' : 'בחר שדה'}
              </h3>
              {!selected && (
                <div className="text-xs text-gray-500">
                  לחץ על שדה ב-PDF כדי להגדיר או לעדוף ערך ספציפי למסמך הזה.
                </div>
              )}
              {selected && (
                <FieldOverridePanel
                  key={selected.id}
                  field={selected}
                  override={overridesByField[selected.id]}
                  businessMap={businessMap}
                  signers={signers}
                  onSaveText={(v) => saveTextOverride(selected.id, v)}
                  onSaveImage={(bytes) => saveImageOverride(selected.id, bytes)}
                  onClear={() => clearOverride(selected.id)}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function InstanceFieldPreview({ field, override, businessMap, signers, finalized }) {
  if (finalized) return null; // final PDF has everything baked in.
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);
  if (isImage) {
    if (override?.assetBytes) {
      return <span className="italic opacity-70">חתימה מוחלפת</span>;
    }
    if (field.valueSource === 'signer_asset' && field.signerPersonId && field.signerAssetMode) {
      const signer = signers.find((s) => s.id === field.signerPersonId);
      const asset = signer?.assets?.find((a) => a.assetType === field.signerAssetMode);
      if (asset) {
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

  const text = resolveInstanceText(field, override, businessMap, signers);
  return <span className="truncate">{text || field.label || '—'}</span>;
}

function resolveInstanceText(field, override, businessMap, signers) {
  if (override && override.textValue != null) return override.textValue;
  if (field.valueSource === 'static') return field.staticValue || '';
  if (field.valueSource === 'business_field' && field.businessFieldId) {
    const bf = businessMap[field.businessFieldId];
    return bf?.value || '';
  }
  if (field.valueSource === 'signer_field' && field.signerPersonId && field.signerFieldKey) {
    const s = signers.find((x) => x.id === field.signerPersonId);
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

function FieldOverridePanel({ field, override, businessMap, signers, onSaveText, onSaveImage, onClear }) {
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);
  const resolvedText = !isImage
    ? resolveInstanceText(field, null, businessMap, signers)
    : '';
  const hasOverride = !!(override && (override.textValue != null || override.assetBytes != null));

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-700">
        <div className="font-medium text-gray-900 mb-1">{field.label || field.fieldType}</div>
        <div className="text-[11px] text-gray-500">
          סוג: {field.fieldType} • מקור: {field.valueSource}
        </div>
      </div>

      {isImage ? (
        <ImageOverride
          override={override}
          field={field}
          signers={signers}
          onSaveImage={onSaveImage}
        />
      ) : (
        <TextOverride
          field={field}
          override={override}
          resolvedText={resolvedText}
          onSaveText={onSaveText}
        />
      )}

      {hasOverride && (
        <button
          onClick={onClear}
          className="text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1"
        >
          נקה דריסה
        </button>
      )}
    </div>
  );
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
            מגיע מ{field.valueSource === 'business_field'
              ? 'שדה קבוע של העסק'
              : field.valueSource === 'signer_field'
              ? 'חותם'
              : field.valueSource === 'static'
              ? 'טקסט קבוע בתבנית'
              : 'ברירת מחדל'}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] text-gray-600 mb-1">דריסה למסמך זה</div>
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
        {saving ? 'שומר…' : 'שמור דריסה'}
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
        <div className="text-[11px] text-gray-600 mb-1">חתימה נוכחית</div>
        <div className="bg-white border border-gray-200 rounded p-2 h-28 flex items-center justify-center">
          {usingOverride ? (
            <span className="text-xs text-gray-600 italic">חתימה מוחלפת במסמך זה</span>
          ) : asset ? (
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
