import { useRef, useState } from 'react';
import { uploadImage } from '../../lib/upload.js';
import { api } from '../../lib/api.js';

function errText(err) {
  if (err?.payload?.error === 'r2_not_configured')
    return 'אחסון התמונות (Cloudflare R2) עדיין לא מוגדר במערכת.';
  return err?.message || 'שגיאה';
}

// Single image (e.g. meeting-point image). `image` is a MediaFile | null.
// onChange(mediaFile | null) updates the parent; detaching does not delete the
// underlying R2 object (orphan sweep is deferred).
export function SingleImage({ image, onChange, folder = 'products/meeting' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const mf = await uploadImage(file, folder);
      onChange(mf);
    } catch (err) {
      alert('שגיאה בהעלאה: ' + errText(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-3">
      {image ? (
        <div className="relative">
          <img src={image.url} alt="" className="h-20 w-20 object-cover rounded-lg border border-gray-200" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-white border border-gray-300 text-gray-600 shadow-sm hover:text-red-600"
            aria-label="הסר תמונה"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="h-20 w-20 rounded-lg border border-dashed border-gray-300 text-[12px] text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'מעלה…' : '+ תמונה'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={pick} className="hidden" />
    </div>
  );
}

// Gallery for a saved variant. `images` = [{ id, mediaFile }]. Requires a
// variantId (so the variant must exist before adding images).
export function Gallery({ variantId, images, onChanged, folder = 'products/gallery' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
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
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(imgId) {
    try {
      await api.products.removeVariantImage(imgId);
      await onChanged();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
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
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="h-20 w-20 rounded-lg border border-dashed border-gray-300 text-[12px] text-gray-500 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'מעלה…' : '+ תמונות'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={pick} className="hidden" />
    </div>
  );
}
