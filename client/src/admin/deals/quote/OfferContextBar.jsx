import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { minorToInput } from '../../../lib/money.js';
import { productContextFor, locationContextFor } from '../tourContext.js';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';

// The offer's commercial IDENTITY bar — shown at the top of the quote
// generation screen, above the proposal hero. These are the SAME fields as the
// Deal's "פרטי הסיור" card, driven by the SAME shared derivation
// (tourContext.js): product → first variant + its city; city → matching
// variant. The parent decides where a change lands (own-mode offer → the
// offer's context; primary → the Deal, which the primary mirrors by design).
//
// Every committed change calls onPatch(fullContext) — the parent persists it
// and recomposes the preview immediately.

const FIELD = 'h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50';

const normalize = (seed) => ({
  productId: seed?.productId || '',
  productVariantId: seed?.productVariantId || '',
  locationId: seed?.locationId || '',
  participants: seed?.participants ?? '',
  tourDate: seed?.tourDate || '',
  tourTime: seed?.tourTime || '',
});

export default function OfferContextBar({ offerNo, isPrimary, seed, valueMinor, busy, onPatch, onOpenBuilder }) {
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [form, setForm] = useState(() => normalize(seed));
  const [partDraft, setPartDraft] = useState(String(seed?.participants ?? ''));

  useEffect(() => {
    let alive = true;
    api.products.list().then((p) => { if (alive) setProducts(p || []); }).catch(() => {});
    // City options for the seeded product — NO auto-fill on load (same as the
    // Deal card: derivation runs only on an explicit product change).
    const pid = normalize(seed).productId;
    if (pid) {
      api.products.get(pid).then((p) => { if (alive) setVariants(p?.variants || []); }).catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next) => {
    setForm(next);
    onPatch(next);
  };

  async function onProduct(productId) {
    if (!productId) {
      setVariants([]);
      return commit({ ...form, productId: '', productVariantId: '', locationId: '' });
    }
    try {
      const d = await productContextFor(productId);
      setVariants(d.variants);
      commit({ ...form, productId, productVariantId: d.productVariantId, locationId: d.locationId });
    } catch {
      setVariants([]);
      commit({ ...form, productId, productVariantId: '', locationId: '' });
    }
  }
  function onCity(locationId) {
    const d = locationContextFor(variants, locationId);
    commit({ ...form, locationId: d.locationId, productVariantId: d.productVariantId });
  }
  function commitParticipants() {
    const v = partDraft === '' ? '' : Math.max(0, parseInt(partDraft, 10) || 0);
    setPartDraft(String(v));
    if (String(form.participants ?? '') !== String(v)) commit({ ...form, participants: v });
  }

  const cityOptions = variants
    .map((v) => ({ id: v.location?.id || v.locationId, name: v.location?.nameHe || '' }))
    .filter((o) => o.id);
  // Keep a non-variant ("other") selected city visible in the dropdown.
  if (form.locationId && !cityOptions.some((o) => o.id === form.locationId)) {
    cityOptions.push({ id: form.locationId, name: 'עיר שאינה מוגדרת למוצר' });
  }

  return (
    <div dir="rtl" className={`mb-3 rounded-xl border px-4 py-3 ${isPrimary ? 'border-amber-100 bg-amber-50/40' : 'border-blue-100 bg-blue-50/40'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-gray-800">פרטי הצעה {offerNo || ''}</span>
        {isPrimary ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700" title="ההצעה הראשית משקפת את העסקה — שינוי כאן מעדכן את פרטי העסקה">
            ראשית · משקפת את העסקה
          </span>
        ) : (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700" title="שינויים כאן שייכים להצעה זו בלבד — העסקה אינה משתנה">
            הצעה עצמאית · לא משנה את העסקה
          </span>
        )}
        {busy && <span className="text-[11px] text-gray-400">שומר…</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-7">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-gray-500">📦 מוצר</label>
          <select className={FIELD} disabled={busy} value={form.productId} onChange={(e) => onProduct(e.target.value)}>
            <option value="">— בחר מוצר —</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.nameHe}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">📍 עיר</label>
          <select className={FIELD} disabled={busy} value={form.locationId} onChange={(e) => onCity(e.target.value)}>
            <option value="">— בחר עיר —</option>
            {cityOptions.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">👥 משתתפים</label>
          <input
            type="number"
            min="0"
            className={FIELD}
            disabled={busy}
            value={partDraft}
            onChange={(e) => setPartDraft(e.target.value)}
            onBlur={commitParticipants}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </div>
        <div>
          <DateField label="📅 תאריך" value={form.tourDate} onChange={(v) => commit({ ...form, tourDate: v || '' })} />
        </div>
        <div>
          <TimeField label="🕒 שעה" value={form.tourTime} onChange={(v) => commit({ ...form, tourTime: v || '' })} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">💰 מחיר</label>
          <button
            type="button"
            disabled={busy}
            onClick={onOpenBuilder}
            title="פתח את בונה המחיר של הצעה זו"
            className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-right text-sm font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            <span dir="ltr">{valueMinor ? `₪${minorToInput(valueMinor)}` : '—'}</span>
            <span className="ms-1 text-[11px] font-normal text-blue-700">ערוך ↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}
