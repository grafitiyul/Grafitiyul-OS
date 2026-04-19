import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';
import PdfViewer from '../shared/PdfViewer.jsx';
import {
  FIELD_TYPES,
  VALUE_SOURCES,
  SIGNER_BUILTIN_FIELDS,
  SIGNER_ASSET_MODES,
  IMAGE_FIELD_TYPES,
} from '../config.js';

// Random local id for new fields not yet persisted. Stays the same until save;
// after save we get the real db id from the server.
function localId() {
  return 'local_' + Math.random().toString(36).slice(2, 10);
}

const DEFAULT_NEW = {
  wPct: 25,
  hPct: 5,
  fieldType: 'text',
  label: '',
  required: false,
  valueSource: 'override_only',
};

export default function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [newFieldType, setNewFieldType] = useState('text');
  const [instances, setInstances] = useState([]);
  const [creatingInstance, setCreatingInstance] = useState(false);

  const [businessFields, setBusinessFields] = useState([]);
  const [signers, setSigners] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [t, bfs, ss, insts] = await Promise.all([
        api.documents.getTemplate(id),
        api.businessFields.list(),
        api.signers.list(),
        api.documents.listInstances({ templateId: id }),
      ]);
      setTemplate(t);
      setFields(t.fields.map((f) => ({ ...f })));
      setBusinessFields(bfs);
      setSigners(ss);
      setInstances(insts);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const hasInstances = template?._count?.instances > 0;

  const addFieldAt = useCallback(
    (page, xPct, yPct) => {
      if (hasInstances) return;
      const f = {
        id: localId(),
        templateId: id,
        page,
        xPct: clampXY(xPct, DEFAULT_NEW.wPct),
        yPct: clampXY(yPct, DEFAULT_NEW.hPct),
        wPct: DEFAULT_NEW.wPct,
        hPct: DEFAULT_NEW.hPct,
        fieldType: newFieldType,
        label: '',
        required: false,
        order: fields.length,
        valueSource: IMAGE_FIELD_TYPES.has(newFieldType)
          ? 'signer_asset'
          : 'override_only',
        businessFieldId: null,
        signerPersonId: null,
        signerFieldKey: null,
        signerAssetMode: IMAGE_FIELD_TYPES.has(newFieldType)
          ? newFieldType === 'signature'
            ? 'draw'
            : newFieldType
          : null,
        staticValue: null,
        language: 'he',
      };
      setFields((prev) => [...prev, f]);
      setSelectedId(f.id);
      setDirty(true);
    },
    [fields.length, hasInstances, id, newFieldType],
  );

  function updateField(fieldId, patch) {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  function removeField(fieldId) {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    if (selectedId === fieldId) setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = fields.map((f, i) => ({
        page: f.page,
        xPct: f.xPct,
        yPct: f.yPct,
        wPct: f.wPct,
        hPct: f.hPct,
        fieldType: f.fieldType,
        label: f.label || '',
        required: !!f.required,
        order: i,
        valueSource: f.valueSource,
        businessFieldId: f.businessFieldId || null,
        signerPersonId: f.signerPersonId || null,
        signerFieldKey: f.signerFieldKey || null,
        signerAssetMode: f.signerAssetMode || null,
        staticValue: f.staticValue || null,
        language: f.language === 'en' ? 'en' : 'he',
      }));
      await api.documents.saveTemplateFields(id, payload);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function renameTemplate(title) {
    try {
      await api.documents.updateTemplate(id, { title });
      await load();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function deleteTemplate() {
    if (!window.confirm(`למחוק את התבנית "${template.title}"?`)) return;
    try {
      await api.documents.removeTemplate(id);
      navigate('/admin/documents/templates');
    } catch (e) {
      if (e.payload?.error === 'template_has_instances') {
        window.alert(`אי אפשר למחוק — התבנית משמשת ב-${e.payload.instances} מסמכים.`);
      } else {
        window.alert(e.message);
      }
    }
  }

  async function createInstance(title) {
    setCreatingInstance(true);
    try {
      const inst = await api.documents.createInstance({ templateId: id, title });
      navigate(`/admin/documents/instances/${inst.id}`);
    } catch (e) {
      window.alert(e.message);
    } finally {
      setCreatingInstance(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        טוען…
      </div>
    );
  }
  if (error) {
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
  if (!template) return null;

  const selected = fields.find((f) => f.id === selectedId) || null;
  const pdfUrl = api.documents.snapshotPdfUrl(template.snapshotId);

  return (
    <div className="flex-1 min-h-0 flex">
      {/* PDF canvas + placement */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100 p-5">
        <header className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <TitleEditor
              title={template.title}
              onSave={renameTemplate}
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={save}
                disabled={!dirty || saving || hasInstances}
                title={hasInstances ? 'לא ניתן לערוך תבנית שיש לה מסמכים' : undefined}
                className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                {saving ? 'שומר…' : 'שמור'}
              </button>
              <button
                onClick={deleteTemplate}
                className="text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5"
              >
                מחק
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-gray-600 mt-2">
            <span>{template.snapshot.pageCount} עמ׳</span>
            <span>{fields.length} שדות</span>
            {hasInstances && (
              <span className="bg-amber-100 border border-amber-200 text-amber-800 rounded px-2 py-0.5 text-[11px] font-medium">
                קיימים {template._count.instances} מסמכים — עריכת שדות חסומה
              </span>
            )}
          </div>
          {!hasInstances && (
            <div className="flex items-center gap-2 mt-3 text-[12px]">
              <span className="text-gray-600">הוסף שדה:</span>
              <select
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-[12px] bg-white"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="text-gray-500">— לחץ על ה-PDF למיקום</span>
            </div>
          )}
        </header>

        <PdfViewer
          pdfUrl={pdfUrl}
          fields={fields}
          readOnly={hasInstances}
          isPlacing={!hasInstances}
          onPageClick={addFieldAt}
          onMoveField={(fid, x, y) => updateField(fid, { xPct: x, yPct: y })}
          onResizeField={(fid, w, h) => updateField(fid, { wPct: w, hPct: h })}
          onDeleteField={(fid) => removeField(fid)}
          onFieldClick={(fid) => setSelectedId(fid)}
          selectedFieldId={selectedId}
          renderFieldContent={(f) => (
            <FieldLivePreview
              field={f}
              businessFields={businessFields}
              signers={signers}
            />
          )}
        />
      </div>

      {/* Sidebar */}
      <aside className="hidden md:flex w-[340px] shrink-0 border-r border-gray-200 bg-white flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <section className="p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 text-sm mb-2">
              {selected ? 'הגדרות שדה' : 'שדה נבחר'}
            </h3>
            {selected ? (
              <FieldSidebar
                key={selected.id}
                field={selected}
                readOnly={hasInstances}
                businessFields={businessFields}
                signers={signers}
                onUpdate={(patch) => updateField(selected.id, patch)}
                onDelete={() => removeField(selected.id)}
              />
            ) : (
              <div className="text-xs text-gray-500">
                לחץ על שדה כדי לערוך אותו, או הוסף חדש מהסרגל.
              </div>
            )}
          </section>

          <section className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 text-sm">מסמכים מתבנית זו</h3>
              <CreateInstanceBtn
                busy={creatingInstance}
                dirty={dirty}
                onCreate={createInstance}
              />
            </div>
            {instances.length === 0 ? (
              <div className="text-xs text-gray-500 italic">
                טרם נוצרו מסמכים לתבנית זו.
              </div>
            ) : (
              <ul className="space-y-1">
                {instances.map((i) => (
                  <li key={i.id}>
                    <button
                      onClick={() => navigate(`/admin/documents/instances/${i.id}`)}
                      className="w-full text-right px-2 py-1.5 rounded hover:bg-gray-50 text-sm flex items-center gap-2"
                    >
                      <span className="flex-1 truncate">{i.title}</span>
                      <StatusPill status={i.status} />
                      <span className="text-[10px] text-gray-500">
                        {relativeHebrew(i.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function clampXY(v, sz) {
  return Math.max(0, Math.min(100 - sz, v - sz / 2));
}

function TitleEditor({ title, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-start"
        title="שנה שם"
      >
        <h1 className="text-lg font-semibold text-gray-900 hover:text-blue-700">
          {title}
        </h1>
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (value.trim() && value !== title) onSave(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(title);
          setEditing(false);
        }
      }}
      className="text-lg font-semibold text-gray-900 border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
    />
  );
}

function CreateInstanceBtn({ busy, dirty, onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={busy || dirty}
        title={dirty ? 'שמור תחילה את השינויים' : undefined}
        className="text-[11px] bg-blue-600 text-white rounded px-2 py-1 disabled:opacity-40"
      >
        + מסמך חדש
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="שם המסמך"
        className="border border-gray-300 rounded px-2 py-1 text-[12px] w-36"
      />
      <button
        onClick={() => {
          if (title.trim()) onCreate(title.trim());
        }}
        disabled={!title.trim() || busy}
        className="text-[11px] bg-blue-600 text-white rounded px-2 py-1 disabled:opacity-40"
      >
        צור
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-[11px] text-gray-500 rounded px-2 py-1 hover:bg-gray-100"
      >
        ×
      </button>
    </div>
  );
}

function StatusPill({ status }) {
  const m = {
    draft: { label: 'טיוטה', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    finalized: { label: 'סופי', cls: 'bg-green-100 text-green-800 border-green-200' },
  }[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`shrink-0 text-[10px] border rounded-full px-1.5 py-0 ${m.cls}`}>
      {m.label}
    </span>
  );
}

function FieldSidebar({ field, readOnly, businessFields, signers, onUpdate, onDelete }) {
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);

  const availableSources = isImage
    ? VALUE_SOURCES.filter((v) => v.key === 'signer_asset' || v.key === 'override_only')
    : VALUE_SOURCES.filter((v) => v.key !== 'signer_asset');

  return (
    <div className="space-y-3">
      <SidebarField label="תווית">
        <input
          disabled={readOnly}
          value={field.label || ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="שם לתצוגה"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
        />
      </SidebarField>

      <SidebarField label="סוג שדה">
        <select
          disabled={readOnly}
          value={field.fieldType}
          onChange={(e) => {
            const ft = e.target.value;
            const patch = { fieldType: ft };
            if (IMAGE_FIELD_TYPES.has(ft)) {
              patch.valueSource = 'signer_asset';
              patch.signerAssetMode =
                ft === 'signature' ? 'draw' : ft;
            } else if (IMAGE_FIELD_TYPES.has(field.fieldType)) {
              patch.valueSource = 'override_only';
              patch.signerAssetMode = null;
            }
            onUpdate(patch);
          }}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </SidebarField>

      <SidebarField label="מקור ערך">
        <select
          disabled={readOnly}
          value={field.valueSource}
          onChange={(e) => onUpdate({ valueSource: e.target.value })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
        >
          {availableSources.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </SidebarField>

      {field.valueSource === 'business_field' && (
        <>
          <SidebarField label="שדה קבוע">
            <select
              disabled={readOnly}
              value={field.businessFieldId || ''}
              onChange={(e) =>
                onUpdate({ businessFieldId: e.target.value || null })
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
            >
              <option value="">— בחר —</option>
              {businessFields.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                  {(() => {
                    const v = b.valueHe ?? b.value ?? '';
                    return v ? ` — ${truncate(v, 30)}` : '';
                  })()}
                </option>
              ))}
            </select>
          </SidebarField>
          <SidebarField label="שפה">
            <div className="inline-flex rounded border border-gray-300 overflow-hidden">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onUpdate({ language: 'he' })}
                className={`text-[12px] px-3 py-1 ${
                  field.language !== 'en'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                עברית
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onUpdate({ language: 'en' })}
                dir="ltr"
                className={`text-[12px] px-3 py-1 border-r border-gray-300 ${
                  field.language === 'en'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                English
              </button>
            </div>
          </SidebarField>
        </>
      )}

      {(field.valueSource === 'signer_field' ||
        field.valueSource === 'signer_asset') && (
        <SidebarField label="חותם">
          <select
            disabled={readOnly}
            value={field.signerPersonId || ''}
            onChange={(e) => onUpdate({ signerPersonId: e.target.value || null })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          >
            <option value="">— בחר חותם —</option>
            {signers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </SidebarField>
      )}

      {field.valueSource === 'signer_field' && field.signerPersonId && (
        <SidebarField label="שדה מהחותם">
          <SignerFieldPicker
            disabled={readOnly}
            signer={signers.find((s) => s.id === field.signerPersonId)}
            value={field.signerFieldKey || ''}
            onChange={(key) => onUpdate({ signerFieldKey: key })}
          />
        </SidebarField>
      )}

      {field.valueSource === 'signer_asset' && (
        <SidebarField label="סוג נכס">
          <select
            disabled={readOnly}
            value={field.signerAssetMode || 'draw'}
            onChange={(e) => onUpdate({ signerAssetMode: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          >
            {SIGNER_ASSET_MODES.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </SidebarField>
      )}

      {field.valueSource === 'static' && (
        <SidebarField label="ערך קבוע">
          <input
            disabled={readOnly}
            value={field.staticValue || ''}
            onChange={(e) => onUpdate({ staticValue: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          />
        </SidebarField>
      )}

      <label className="flex items-center gap-2 text-sm pt-1">
        <input
          type="checkbox"
          checked={!!field.required}
          disabled={readOnly}
          onChange={(e) => onUpdate({ required: e.target.checked })}
        />
        <span>חובה</span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <SidebarField label="X%">
          <input
            type="number"
            disabled={readOnly}
            value={field.xPct?.toFixed?.(1) || field.xPct}
            onChange={(e) => onUpdate({ xPct: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          />
        </SidebarField>
        <SidebarField label="Y%">
          <input
            type="number"
            disabled={readOnly}
            value={field.yPct?.toFixed?.(1) || field.yPct}
            onChange={(e) => onUpdate({ yPct: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          />
        </SidebarField>
        <SidebarField label="רוחב%">
          <input
            type="number"
            disabled={readOnly}
            value={field.wPct?.toFixed?.(1) || field.wPct}
            onChange={(e) => onUpdate({ wPct: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          />
        </SidebarField>
        <SidebarField label="גובה%">
          <input
            type="number"
            disabled={readOnly}
            value={field.hPct?.toFixed?.(1) || field.hPct}
            onChange={(e) => onUpdate({ hPct: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
          />
        </SidebarField>
      </div>

      {!readOnly && (
        <button
          onClick={onDelete}
          className="w-full mt-2 text-[12px] text-red-600 hover:bg-red-50 border border-red-200 rounded px-3 py-1.5"
        >
          מחק שדה
        </button>
      )}
    </div>
  );
}

function SidebarField({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

function SignerFieldPicker({ signer, value, onChange, disabled }) {
  const extras = signer ? Object.keys(signer.extraFields || {}) : [];
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50"
    >
      <option value="">— בחר שדה —</option>
      {SIGNER_BUILTIN_FIELDS.map((f) => (
        <option key={f.key} value={f.key}>{f.label}</option>
      ))}
      {extras.length > 0 && (
        <optgroup label="שדות נוספים">
          {extras.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function FieldLivePreview({ field, businessFields, signers }) {
  const text = useMemo(() => resolveLiveText(field, businessFields, signers), [
    field,
    businessFields,
    signers,
  ]);
  const isImage = IMAGE_FIELD_TYPES.has(field.fieldType);

  if (isImage) {
    if (field.valueSource === 'signer_asset') {
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
      return <span className="italic opacity-70">{field.label || 'חתימה'}</span>;
    }
    return <span className="italic opacity-70">{field.label || 'חתימה'}</span>;
  }

  const showEnChip =
    field.valueSource === 'business_field' && field.language === 'en';
  return (
    <span className="truncate flex items-center gap-1">
      {text || field.label || 'טקסט'}
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

function resolveLiveText(field, businessFields, signers) {
  if (field.valueSource === 'static') return field.staticValue || '';
  if (field.valueSource === 'business_field' && field.businessFieldId) {
    const bf = businessFields.find((b) => b.id === field.businessFieldId);
    if (!bf) return '';
    if (bf.valueHe !== undefined || bf.valueEn !== undefined) {
      return (field.language === 'en' ? bf.valueEn : bf.valueHe) || '';
    }
    return bf.value || '';
  }
  if (field.valueSource === 'signer_field' && field.signerPersonId && field.signerFieldKey) {
    const s = signers.find((x) => x.id === field.signerPersonId);
    if (!s) return '';
    const builtin = s[field.signerFieldKey];
    if (builtin) return String(builtin);
    const extra = (s.extraFields || {})[field.signerFieldKey];
    return extra != null ? String(extra) : '';
  }
  return '';
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}
