import { useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { SingleImage } from '../products/ImageUploader.jsx';
import { SHARED_CONTENT_TYPES, TYPE_LABEL } from './sharedContentMeta.js';
import SharedContentVariantLinker from './SharedContentVariantLinker.jsx';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Reusable create/edit form for a Shared Content item. Generic: the PARENT owns
// the API call via onSubmit(data) (create vs createForVariant vs update differ),
// so this dialog only collects fields. Used by the variant editor and the library.
//
// Props:
//   open, onClose
//   initial       — existing block for edit, or null for create
//   fixedType     — lock the type (variant flows); omit to show a type picker
//   locations     — [{id,nameHe}] for the optional location select
//   usedByCount   — when editing, show the "affects N variants" warning if > 1
//   showLocationDefault — allow toggling isLocationDefault (library only)
//   onSubmit(data), submitting
export default function SharedContentEditorDialog({
  open,
  onClose,
  initial = null,
  fixedType,
  locations = [],
  usedByCount = 0,
  showLocationDefault = false,
  onSubmit,
  submitting = false,
  onLinksChanged,
}) {
  const isEdit = !!initial?.id;
  const [type, setType] = useState(initial?.type || fixedType || 'meeting_point');
  const [internalName, setInternalName] = useState(initial?.internalName || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [locationId, setLocationId] = useState(initial?.locationId || initial?.location?.id || '');
  const [bodyHe, setBodyHe] = useState(initial?.bodyHe || '');
  const [bodyEn, setBodyEn] = useState(initial?.bodyEn || '');
  const [image, setImage] = useState(initial?.image || null);
  const [isLocationDefault, setIsLocationDefault] = useState(!!initial?.isLocationDefault);
  const [err, setErr] = useState(null);

  function submit() {
    if (!internalName.trim()) { setErr('חובה שם פנימי.'); return; }
    setErr(null);
    onSubmit({
      type: fixedType || type,
      internalName: internalName.trim(),
      description: description.trim() || null,
      locationId: locationId || null,
      bodyHe,
      bodyEn,
      imageId: image?.id || null,
      ...(showLocationDefault ? { isLocationDefault } : {}),
    });
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={submitting}
        className="h-9 px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        ביטול
      </button>
      <button type="button" onClick={submit} disabled={submitting}
        className="h-9 px-4 rounded-lg bg-blue-600 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
        {submitting ? 'שומר…' : isEdit ? 'שמירה' : 'יצירה'}
      </button>
    </>
  );

  const title = isEdit
    ? `עריכת תוכן משותף — ${TYPE_LABEL[initial.type] || ''}`
    : `תוכן משותף חדש${fixedType ? ' — ' + (TYPE_LABEL[fixedType] || '') : ''}`;

  return (
    <Dialog open={open} onClose={onClose} title={title} footer={footer} size="lg">
      <div className="space-y-4">
        {isEdit && usedByCount > 1 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
            תוכן זה בשימוש ב־<b>{usedByCount}</b> וריאציות. שינוי כאן ישפיע על כל הטיוטות המקושרות (הצעות מחיר שהופקו נשארות קפואות).
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!fixedType && (
            <Field label="סוג">
              <select value={type} onChange={(e) => setType(e.target.value)} disabled={isEdit} className={INPUT}>
                {SHARED_CONTENT_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
              </select>
            </Field>
          )}
          <Field label="שם פנימי (לא מוצג ללקוח)">
            <input value={internalName} onChange={(e) => setInternalName(e.target.value)} className={INPUT} placeholder="למשל: מפגש פלורנטין — קפה X" />
          </Field>
          <Field label="מיקום (אופציונלי)">
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={INPUT}>
              <option value="">— ללא —</option>
              {locations.map((l) => (<option key={l.id} value={l.id}>{l.nameHe}</option>))}
            </select>
          </Field>
          <Field label="תיאור פנימי (אופציונלי)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} />
          </Field>
        </div>

        {showLocationDefault && (
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={isLocationDefault} onChange={(e) => setIsLocationDefault(e.target.checked)} className="rounded border-gray-300" />
            ברירת המחדל של המיקום לסוג זה (משמש כאשר לוריאציה אין קישור משלה)
          </label>
        )}

        <Field label="תוכן (עברית)">
          <RichEditor value={bodyHe} onChange={setBodyHe} ariaLabel="shared content he" minContentHeight={120} placeholder="תוכן, הוראות, קישורים…" />
        </Field>
        <Field label="Content (EN)">
          <RichEditor value={bodyEn} onChange={setBodyEn} ariaLabel="shared content en" minContentHeight={120} placeholder="Content, directions, links…" />
        </Field>

        <Field label="תמונה (אופציונלי)">
          <SingleImage image={image} onChange={setImage} folder="shared-content" />
        </Field>

        {err && <div className="text-[13px] text-red-600">{err}</div>}

        {isEdit && (
          <SharedContentVariantLinker
            sharedContentId={initial.id}
            type={initial.type}
            onChanged={onLinksChanged}
          />
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
