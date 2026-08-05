import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import { useFileDrop } from '../common/useFileDrop.js';
import { uploadImage } from '../../lib/upload.js';

// Variant editor → "תמונות בהצעה": the variant REFERENCES images from the
// shared Quote Image Library per quote position — it never owns media.
// hero = the cover background (one image; a new pick replaces);
// slot1/slot2 = the two image sections (several images show together, in pick
// order). Changes save immediately (relation-backed, like Shared Content),
// not through the page's "שמור שינויים" buffer.
//
// Each position is ONE unified field: drag a file onto it, upload from the
// computer, or pick from the library — a direct upload goes through the
// canonical media path (uploadImage → MediaFile) and creates a REAL library
// entity (tagged with the variant's location) before attaching it, so the
// image stays reusable in מבנה הצעת מחיר → תמונות like any other.
//
// The picker opens the library filtered to images applicable to the variant's
// location (untagged images count as applicable-everywhere) with a toggle to
// show all; managing the library itself lives in Quote Structure → תמונות.

const POSITION_ORDER = ['hero', 'slot1', 'slot2'];

// Client-side accept mirrors the server allowlist (mediaFiles presign) so a
// wrong file type is rejected with a clear message before any network call.
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

function currentPositions(links) {
  const out = { hero: [], slot1: [], slot2: [] };
  for (const l of links || []) {
    if (out[l.position] && l.quoteImageId) out[l.position].push(l.quoteImageId);
  }
  return out;
}

function uploadErrText(err) {
  if (err?.payload?.error === 'r2_not_configured')
    return 'אחסון התמונות (Cloudflare R2) עדיין לא מוגדר במערכת.';
  return err?.payload?.error || err?.message || 'שגיאה';
}

export default function VariantQuoteImages({ variant, slotTitles, onChanged }) {
  const [library, setLibrary] = useState(null);
  const [pickerFor, setPickerFor] = useState(null); // position key | null
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState(null); // position key | null

  useEffect(() => {
    let alive = true;
    api.quoteImages.list()
      .then((l) => { if (alive) setLibrary(Array.isArray(l) ? l : []); })
      .catch(() => { if (alive) setLibrary([]); });
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => new Map((library || []).map((im) => [im.id, im])), [library]);
  const positions = useMemo(() => currentPositions(variant.quoteImageLinks), [variant.quoteImageLinks]);

  const POSITIONS = [
    { key: 'hero', label: 'תמונה ראשית (שער)', hint: 'רקע שער ההצעה — תמונה אחת; בחירה חדשה מחליפה את הקודמת. ללא בחירה מוצגת ברירת המחדל ממבנה ההצעה.', single: true },
    { key: 'slot1', label: slotTitles?.slot1 || 'תמונה — מיקום 1', hint: 'אפשר לבחור כמה תמונות — יוצגו יחד בסעיף, לפי סדר הבחירה.', single: false },
    { key: 'slot2', label: slotTitles?.slot2 || 'תמונה — מיקום 2', hint: 'אפשר לבחור כמה תמונות — יוצגו יחד בסעיף, לפי סדר הבחירה.', single: false },
  ];

  async function write(next) {
    setSaving(true);
    try {
      await api.products.setVariantQuoteImages(variant.id, next);
      await onChanged();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  function pick(position, imageId, single) {
    const next = { ...positions };
    next[position] = single ? [imageId] : [...next[position].filter((id) => id !== imageId), imageId];
    setPickerFor(null);
    write(next);
  }
  function remove(position, imageId) {
    write({ ...positions, [position]: positions[position].filter((id) => id !== imageId) });
  }

  // Direct upload into a position: canonical media path → real library entity
  // (tagged with the variant's location so the default picker filter shows it)
  // → attach exactly like a library pick. Uploads that succeed before a
  // failure are still attached — nothing already selected is ever lost.
  async function uploadTo(position, files, single) {
    const locationId = variant.location?.id || variant.locationId || null;
    const list = single ? files.slice(0, 1) : files;
    if (single && files.length > 1) {
      alert('למיקום זה אפשר תמונה אחת — הועלתה התמונה הראשונה בלבד.');
    }
    setUploadingFor(position);
    const created = [];
    let failed = null;
    try {
      for (const file of list) {
        const mf = await uploadImage(file, 'quote/images');
        const qi = await api.quoteImages.create({
          mediaFileId: mf.id,
          locationIds: locationId ? [locationId] : [],
        });
        created.push(qi);
      }
    } catch (e) {
      failed = e;
    }
    if (created.length) {
      setLibrary((l) => [...created, ...(l || [])]);
      const next = { ...positions };
      next[position] = single
        ? [created[0].id]
        : [...next[position], ...created.map((c) => c.id)];
      await write(next);
    }
    setUploadingFor(null);
    if (failed) alert('שגיאה בהעלאה: ' + uploadErrText(failed));
  }

  if (library === null) return <p className="text-sm text-gray-400">טוען את ספריית התמונות…</p>;

  return (
    <div className="space-y-6">
      {POSITIONS.map((pos) => (
        <PositionRow
          key={pos.key}
          pos={pos}
          imageIds={positions[pos.key]}
          byId={byId}
          busy={saving || uploadingFor !== null}
          uploading={uploadingFor === pos.key}
          hasLibrary={library.length > 0}
          onRemove={(id) => remove(pos.key, id)}
          onOpenPicker={() => setPickerFor(pos.key)}
          onUpload={(files) => uploadTo(pos.key, files, pos.single)}
        />
      ))}

      <p className="text-[11.5px] text-gray-400">
        העלאה ישירה כאן מוסיפה את התמונה גם לספרייה המשותפת. הסרה כאן מסירה את
        ההפניה מהוריאציה בלבד — התמונה נשארת בספרייה. ניהול הספרייה: <LibraryLink />.
      </p>

      <LibraryPickerDialog
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        library={library}
        variant={variant}
        excludeIds={pickerFor ? positions[pickerFor] : []}
        onPick={(id) => pick(pickerFor, id, POSITIONS.find((p) => p.key === pickerFor)?.single)}
        title={POSITIONS.find((p) => p.key === pickerFor)?.label}
      />
    </div>
  );
}

// One quote position = one unified image field: current images, drag-and-drop
// over the whole row, upload-from-computer, and pick-from-library.
function PositionRow({ pos, imageIds, byId, busy, uploading, hasLibrary, onRemove, onOpenPicker, onUpload }) {
  // multiple:true even for a single-image position — the truncation to one
  // file happens in uploadTo WITH user feedback, instead of a silent drop here.
  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: IMAGE_ACCEPT,
    multiple: true,
    maxBytes: 25 * 1024 * 1024,
    onFiles: onUpload,
    disabled: busy,
    onReject: (rejected) => {
      const bySize = rejected.some((r) => r.reason === 'size');
      alert(bySize
        ? 'קובץ גדול מדי — עד 25MB לתמונה.'
        : 'קובץ לא נתמך — יש לבחור קובץ תמונה (JPG / PNG / WEBP / GIF).');
    },
  });

  const hasImage = imageIds.length > 0;
  const tile = 'h-20 w-20 rounded-lg border border-dashed text-[12px] transition disabled:opacity-50';

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-gray-800">{pos.label}</span>
        <span className="text-[11.5px] text-gray-400">{pos.hint}</span>
      </div>
      <div
        {...dropProps}
        className={`relative rounded-xl border p-2 transition ${
          dragOver ? 'border-blue-400 bg-blue-50/60 ring-2 ring-blue-200' : 'border-transparent -m-px'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {imageIds.map((id) => {
            const im = byId.get(id);
            if (!im) return null;
            return (
              <div key={id} className="relative">
                <img src={im.mediaFile?.url} alt={im.titleHe || ''} title={im.titleHe || im.titleEn || ''}
                  className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  disabled={busy}
                  className="absolute -top-2 -left-2 h-6 w-6 rounded-full border border-gray-300 bg-white text-gray-600 shadow-sm hover:text-red-600 disabled:opacity-50"
                  aria-label="הסר מהמיקום"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={open}
            disabled={busy}
            className={`${tile} ${dragOver ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
          >
            {uploading ? 'מעלה…' : dragOver ? 'שחררו כאן' : pos.single && hasImage ? 'החלף מהמחשב' : '+ העלאה מהמחשב'}
          </button>
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={busy || !hasLibrary}
            className={`${tile} border-gray-300 text-gray-500 hover:bg-gray-50`}
            title={hasLibrary ? undefined : 'ספריית התמונות ריקה — העלו תמונה ישירות'}
          >
            {pos.single && hasImage ? 'החלף מהספרייה' : '+ מהספרייה'}
          </button>
          {!hasImage && !uploading && (
            <span className="text-[11px] text-gray-400">גררו תמונה לכאן, העלו מהמחשב או בחרו מהספרייה</span>
          )}
        </div>
        {dragOver && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl text-[12px] font-semibold text-blue-700">
            שחררו כדי להעלות {pos.single ? 'תמונה' : 'תמונות'}
          </span>
        )}
      </div>
      <input {...inputProps} />
    </div>
  );
}

function LibraryLink() {
  return (
    <Link
      to="/admin/settings/crm/quote-layout"
      onClick={() => { try { localStorage.setItem('gos.quoteStructure.tab', 'images'); } catch { /* ignore */ } }}
      className="font-medium text-teal-700 underline"
    >
      מבנה הצעת מחיר → תמונות
    </Link>
  );
}

// Library picker — grid of library images. Default filter: images applicable to
// the variant's location (or untagged = applicable everywhere); toggle for all.
function LibraryPickerDialog({ open, onClose, library, variant, excludeIds, onPick, title }) {
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) { setShowAll(false); setQ(''); } }, [open]);

  const locationId = variant.location?.id || variant.locationId || null;
  const excluded = new Set(excludeIds || []);
  const needle = q.trim().toLowerCase();

  const items = (library || []).filter((im) => {
    if (excluded.has(im.id)) return false;
    if (!showAll && locationId && im.locationIds?.length && !im.locationIds.includes(locationId)) return false;
    if (!needle) return true;
    return [im.titleHe, im.titleEn, im.description].some((s) => s && s.toLowerCase().includes(needle));
  });
  const hiddenByLocation = !showAll && (library || []).some(
    (im) => !excluded.has(im.id) && locationId && im.locationIds?.length && !im.locationIds.includes(locationId),
  );

  return (
    <Dialog open={open} onClose={onClose} title={`בחירת תמונה · ${title || ''}`} size="lg">
      <div className="mb-3 flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי כותרת…"
          className="h-9 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200"
        />
        {hiddenByLocation || showAll ? (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12.5px] text-gray-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 rounded accent-teal-600" />
            הצג גם תמונות של מיקומים אחרים
          </label>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          {library?.length ? 'אין תמונות מתאימות לסינון הנוכחי.' : 'ספריית התמונות ריקה.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((im) => (
            <button
              key={im.id}
              type="button"
              onClick={() => onPick(im.id)}
              className="group overflow-hidden rounded-xl border border-gray-200 bg-white text-right transition hover:border-teal-400 hover:shadow-sm"
            >
              <img src={im.mediaFile?.url} alt="" className="h-28 w-full object-cover" />
              <div className="px-2.5 py-2">
                <div className="truncate text-[13px] font-medium text-gray-800">{im.titleHe || im.titleEn || 'ללא כותרת'}</div>
                <div className="truncate text-[11px] text-gray-400">
                  {im.locationIds?.length ? `${im.locationIds.length} מיקומים` : 'כל המיקומים'}
                  {im.usage?.length ? ` · בשימוש ב-${new Set(im.usage.map((u) => u.variantId)).size} וריאציות` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
