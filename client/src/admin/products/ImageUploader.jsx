import { useState } from 'react';
import { uploadImage } from '../../lib/upload.js';
import { api } from '../../lib/api.js';
import { useFileDrop } from '../common/useFileDrop.js';

function errText(err) {
  if (err?.payload?.error === 'r2_not_configured')
    return 'אחסון התמונות (Cloudflare R2) עדיין לא מוגדר במערכת.';
  return err?.message || 'שגיאה';
}

// Single image (e.g. meeting-point image). `image` is a MediaFile | null.
// onChange(mediaFile | null) updates the parent; detaching does not delete the
// underlying R2 object (orphan sweep is deferred). Supports click-to-pick AND
// drag-and-drop via the shared useFileDrop hook (same upload path either way).
export function SingleImage({ image, onChange, folder = 'products/meeting' }) {
  const [busy, setBusy] = useState(false);

  async function upload(files) {
    setBusy(true);
    try {
      const mf = await uploadImage(files[0], folder);
      onChange(mf);
    } catch (err) {
      alert('שגיאה בהעלאה: ' + errText(err));
    } finally {
      setBusy(false);
    }
  }

  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: 'image/*',
    onFiles: upload,
    disabled: busy,
    onReject: () => alert('קובץ לא נתמך — יש לבחור קובץ תמונה.'),
  });

  return (
    <div className="flex items-center gap-3" {...dropProps}>
      {image ? (
        <div className={`relative rounded-lg transition ${dragOver ? 'ring-2 ring-blue-400' : ''}`}>
          <img src={image.url} alt="" className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-white border border-gray-300 text-gray-600 shadow-sm hover:text-red-600"
            aria-label="הסר תמונה"
          >
            ×
          </button>
          {dragOver && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-blue-500/10 text-[11px] font-medium text-blue-700">
              שחררו להחלפה
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className={`h-20 w-20 rounded-lg border border-dashed text-[12px] disabled:opacity-50 transition ${
            dragOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          {busy ? 'מעלה…' : dragOver ? 'שחררו כאן' : '+ תמונה'}
        </button>
      )}
      {!image && !busy && (
        <span className="text-[11px] text-gray-400">לחצו לבחירה או גררו קובץ לכאן</span>
      )}
      <input {...inputProps} />
    </div>
  );
}

// Gallery for a saved variant. `images` = [{ id, mediaFile }]. Requires a
// variantId (so the variant must exist before adding images).
export function Gallery({ variantId, images, onChanged, folder = 'products/gallery' }) {
  const [busy, setBusy] = useState(false);

  async function upload(files) {
    setBusy(true);
    try {
      for (const f of files) {
        const mf = await uploadImage(f, folder);
        await api.products.addVariantImage(variantId, mf.id);
      }
      await onChanged();
    } catch (err) {
      alert('שגיאה בהעלאה: ' + errText(err));
    } finally {
      setBusy(false);
    }
  }

  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: 'image/*',
    multiple: true,
    onFiles: upload,
    disabled: busy,
    onReject: () => alert('חלק מהקבצים אינם תמונות ולכן דולגו.'),
  });

  async function remove(imgId) {
    try {
      await api.products.removeVariantImage(imgId);
      await onChanged();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <div
      className={`flex flex-wrap gap-2 rounded-lg transition ${dragOver ? 'ring-2 ring-blue-400 bg-blue-50/40 p-1' : ''}`}
      {...dropProps}
    >
      {(images || []).map((img) => (
        <div key={img.id} className="relative">
          <img src={img.mediaFile?.url} alt="" className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
          <button
            type="button"
            onClick={() => remove(img.id)}
            className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-white border border-gray-300 text-gray-600 shadow-sm hover:text-red-600"
            aria-label="הסר"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`h-20 w-20 rounded-lg border border-dashed text-[12px] disabled:opacity-50 transition ${
          dragOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
        }`}
      >
        {busy ? 'מעלה…' : dragOver ? 'שחררו כאן' : '+ תמונות'}
      </button>
      <input {...inputProps} />
    </div>
  );
}
