import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import { SingleImage } from '../../products/ImageUploader.jsx';
import CollapsibleCard from '../../common/CollapsibleCard.jsx';

// Quote Structure → Images: the Quote Image Library manager.
//
// Every image is an independent, reusable ENTITY (image + optional titles +
// applicable locations) — the single source of truth. Nothing here targets a
// quote position or a variant: Product Variants reference library images per
// position in the Variant editor ("תמונות בהצעה"). Replacing an image here
// updates every quote that references it.
//
// Unlike the other Quote Structure tabs (which edit one layout JSON with a
// global save), each image saves independently — it is its own record.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

function buffer(item) {
  return {
    image: item?.mediaFile ? { id: item.mediaFile.id, url: item.mediaFile.url } : null,
    titleHe: item?.titleHe || '',
    titleEn: item?.titleEn || '',
    description: item?.description || '',
    locationIds: item?.locationIds ? [...item.locationIds] : [],
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function QuoteImageLibrary() {
  const [items, setItems] = useState(null);
  const [locations, setLocations] = useState([]);
  const [variantOptions, setVariantOptions] = useState([]);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.quoteImages.list(),
      api.locations.list().catch(() => []),
      api.products.variantOptions().catch(() => []),
    ])
      .then(([imgs, locs, opts]) => {
        if (!alive) return;
        setItems(imgs);
        setLocations(Array.isArray(locs) ? locs : []);
        setVariantOptions(Array.isArray(opts) ? opts : []);
      })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const locationName = useMemo(() => {
    const m = new Map(locations.map((l) => [l.id, l.nameHe || l.nameEn || '']));
    return (id) => m.get(id) || '';
  }, [locations]);
  const variantLabel = useMemo(() => {
    const m = new Map(variantOptions.map((o) => [o.id, `${o.productNameHe || o.productNameEn} · ${o.locationNameHe || o.locationNameEn}`]));
    return (id) => m.get(id) || '';
  }, [variantOptions]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
        שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  }
  if (items === null) return <p className="py-8 text-center text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-gray-500">
          ספריית התמונות של הצעות המחיר — מקור אמת יחיד. כל תמונה היא ישות עצמאית
          שניתן לשייך לכמה וריאציות. את השיבוץ למיקומי ההצעה (ראשית / מיקום 1 / מיקום 2)
          עושים בעורך הוריאציה, בסעיף <b>״תמונות בהצעה״</b>.
        </p>
        <button
          type="button"
          onClick={() => { setAdding(true); setOpenId(null); }}
          className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-teal-700"
        >
          + תמונה
        </button>
      </div>

      {adding && (
        <ImageEntityCard
          item={null}
          locations={locations}
          locationName={locationName}
          variantLabel={variantLabel}
          open
          onToggle={() => setAdding(false)}
          onSaved={(created) => { setItems((l) => [created, ...l]); setAdding(false); setOpenId(created.id); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {items.length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-400">
          אין עדיין תמונות בספרייה. לחצו “+ תמונה” כדי להוסיף.
        </div>
      ) : (
        items.map((item) => (
          <ImageEntityCard
            key={item.id}
            item={item}
            locations={locations}
            locationName={locationName}
            variantLabel={variantLabel}
            open={openId === item.id}
            onToggle={() => setOpenId((k) => (k === item.id ? null : item.id))}
            onSaved={(updated) => setItems((l) => l.map((x) => (x.id === updated.id ? updated : x)))}
            onDeleted={() => setItems((l) => l.filter((x) => x.id !== item.id))}
          />
        ))
      )}
    </div>
  );
}

function ImageEntityCard({ item, locations, locationName, variantLabel, open, onToggle, onSaved, onDeleted, onCancel }) {
  const isNew = !item;
  const [form, setForm] = useState(() => buffer(item));
  const [saving, setSaving] = useState(false);
  const original = useMemo(() => buffer(item), [item]);
  const dirty = !same(form, original);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const usedBy = useMemo(() => [...new Set((item?.usage || []).map((u) => u.variantId))], [item]);
  const summaryTitle = form.titleHe || form.titleEn || (isNew ? 'תמונה חדשה' : 'ללא כותרת');
  const summaryMeta = [
    form.locationIds.length ? form.locationIds.map(locationName).filter(Boolean).join(', ') : 'כל המיקומים',
    usedBy.length ? `בשימוש ב-${usedBy.length} וריאציות` : !isNew ? 'לא בשימוש' : null,
  ].filter(Boolean).join(' · ');

  function toggleLocation(id) {
    set({
      locationIds: form.locationIds.includes(id)
        ? form.locationIds.filter((x) => x !== id)
        : [...form.locationIds, id],
    });
  }

  async function save() {
    if (!form.image) { alert('יש להעלות תמונה לפני השמירה.'); return; }
    setSaving(true);
    try {
      const payload = {
        mediaFileId: form.image.id,
        titleHe: form.titleHe,
        titleEn: form.titleEn,
        description: form.description,
        locationIds: form.locationIds,
      };
      const saved = isNew ? await api.quoteImages.create(payload) : await api.quoteImages.update(item.id, payload);
      onSaved(saved);
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const usage = usedBy.length
      ? `התמונה בשימוש ב-${usedBy.length} וריאציות — מחיקה תסיר אותה מכל ההצעות שלהן.\n`
      : '';
    if (!confirm(`${usage}למחוק את התמונה מהספרייה?`)) return;
    try {
      await api.quoteImages.remove(item.id);
      onDeleted();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <CollapsibleCard
      open={open}
      onToggle={onToggle}
      title={summaryTitle}
      subtitle={summaryMeta}
      thumb={
        form.image
          ? <img src={form.image.url} alt="" className="h-11 w-11 rounded-lg border border-gray-200 object-cover" />
          : <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-300">🖼</span>
      }
      meta={dirty ? <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">לא נשמר</span> : null}
      actions={!isNew && (
        <button type="button" onClick={remove} className="rounded-md px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-red-50">מחק</button>
      )}
    >
      <div className="space-y-5">
        <div>
          <span className={LABEL}>תמונה</span>
          <SingleImage
            image={form.image ? { url: form.image.url } : null}
            onChange={(mf) => set({ image: mf ? { id: mf.id, url: mf.url } : null })}
            folder="quote/images"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={LABEL}>כותרת (עברית, אופציונלי — מוצגת ככיתוב בהצעה)</span>
            <input value={form.titleHe} onChange={(e) => set({ titleHe: e.target.value })} className={INPUT} /></label>
          <label className="block"><span className={LABEL}>Title (EN, optional)</span>
            <input value={form.titleEn} onChange={(e) => set({ titleEn: e.target.value })} dir="ltr" className={INPUT} /></label>
        </div>

        <label className="block"><span className={LABEL}>תיאור פנימי (אופציונלי — לא מוצג ללקוח)</span>
          <input value={form.description} onChange={(e) => set({ description: e.target.value })} className={INPUT} /></label>

        <div>
          <span className={LABEL}>מיקומים רלוונטיים (ריק = מתאימה לכל המיקומים)</span>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc) => {
              const on = form.locationIds.includes(loc.id);
              return (
                <button key={loc.id} type="button" onClick={() => toggleLocation(loc.id)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                    on ? 'bg-teal-600 text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-600 hover:border-teal-300'
                  }`}>
                  {loc.nameHe || loc.nameEn}
                </button>
              );
            })}
            {locations.length === 0 && <p className="text-[13px] text-gray-400">אין מיקומים מוגדרים.</p>}
          </div>
        </div>

        {usedBy.length > 0 && (
          <div>
            <span className={LABEL}>בשימוש בוריאציות</span>
            <div className="flex flex-wrap gap-1.5">
              {usedBy.map((vid) => (
                <span key={vid} className="rounded-full bg-gray-100 px-2.5 py-1 text-[12px] text-gray-600">{variantLabel(vid) || vid}</span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
          {isNew ? (
            <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">ביטול</button>
          ) : (
            <button type="button" onClick={() => setForm(original)} disabled={!dirty || saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">ביטול</button>
          )}
          <button type="button" onClick={save} disabled={saving || (!isNew && !dirty)}
            className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-40">
            {saving ? 'שומר…' : isNew ? 'הוסף לספרייה' : 'שמור תמונה'}
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
}
