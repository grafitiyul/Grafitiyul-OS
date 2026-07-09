import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import PriceBuilderDialog from '../PriceBuilderDialog.jsx';
import { productContextFor, locationContextFor } from '../tourContext.js';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';

// "הצעה מקבילה" — create/edit a NON-primary offer's full commercial context in
// one surface: the context fields on top (same widgets + the SAME shared
// derivation as the Deal's פרטי הסיור card — tourContext.js), and the EXISTING
// Price Builder below (embedded via its additive headerExtra prop — no second
// pricing system). Every write here goes to the QuoteOffer / its QuoteVersion;
// the Deal is NEVER touched (payment terms stay deal-level and are read-only).
//
// Create mode: the offer is created (activated) on open, seeded from the Deal;
// canceling before the first save deletes it again. Edit mode: opens on an
// existing own-mode offer (activating it so the builder targets its version).

const SELECT = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

export default function ParallelOfferDialog({ open, onClose, deal, offer = null, onDone }) {
  const [offerId, setOfferId] = useState(offer?.id || null);
  const [offerNo, setOfferNo] = useState(offer?.offerNo || null);
  const [form, setForm] = useState(null); // { productId, productVariantId, locationId, participants, tourDate, tourTime }
  const [variants, setVariants] = useState([]);
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [error, setError] = useState(null);
  const savedRef = useRef(false);
  const createdRef = useRef(false);

  useEffect(() => {
    if (!open || !deal?.id) return;
    let alive = true;
    savedRef.current = false;
    createdRef.current = false;
    (async () => {
      try {
        const [prods, ats] = await Promise.all([
          api.products.list(),
          api.activityTypes.list().catch(() => []),
        ]);
        if (!alive) return;
        setProducts(prods || []);
        setActivityTypes(Array.isArray(ats) ? ats : ats?.activityTypes || []);

        let id = offer?.id || null;
        let seed;
        if (id) {
          // Edit an existing parallel offer: builder must target ITS version.
          await api.deals.activateQuoteOffer(deal.id, id);
          seed = { ...(offer.context || {}) };
          setOfferNo(offer.offerNo);
        } else {
          // Create: the offer is born 'own', seeded from the Deal, and active.
          const r = await api.deals.createQuoteOffer(deal.id);
          if (!alive) return;
          id = r.offer.id;
          createdRef.current = true;
          setOfferNo(r.offer.offerNo);
          seed = {
            productId: deal.productId || '',
            productVariantId: deal.productVariantId || '',
            locationId: deal.locationId || '',
            participants: deal.participants ?? '',
            tourDate: deal.tourDate || '',
            tourTime: deal.tourTime || '',
          };
        }
        setOfferId(id);
        setForm({
          productId: seed.productId || '',
          productVariantId: seed.productVariantId || '',
          locationId: seed.locationId || '',
          participants: seed.participants ?? '',
          tourDate: seed.tourDate || '',
          tourTime: seed.tourTime || '',
        });
        if (seed.productId) {
          const p = await api.products.get(seed.productId).catch(() => null);
          if (alive) setVariants(p?.variants || []);
        } else if (alive) {
          setVariants([]);
        }
      } catch (e) {
        if (alive) setError(e?.payload?.error || e?.message || 'load_failed');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id, offer?.id]);

  // SAME derivation as the Deal card (shared module) — product picks its first
  // variant + city; city resolves the matching variant.
  async function onProduct(productId) {
    if (!productId) {
      setVariants([]);
      setForm((f) => ({ ...f, productId: '', productVariantId: '', locationId: '' }));
      return;
    }
    setForm((f) => ({ ...f, productId }));
    try {
      const d = await productContextFor(productId);
      setVariants(d.variants);
      setForm((f) => ({ ...f, productVariantId: d.productVariantId, locationId: d.locationId }));
    } catch {
      setVariants([]);
      setForm((f) => ({ ...f, productVariantId: '', locationId: '' }));
    }
  }
  function onCity(locationId) {
    const d = locationContextFor(variants, locationId);
    setForm((f) => ({ ...f, locationId: d.locationId, productVariantId: d.productVariantId }));
  }

  // Pricing context handed to the builder — same construction as the Deal card.
  const priceContext = useMemo(() => {
    if (!form) return null;
    const k = deal.activityType === 'group' ? 'public' : deal.activityType;
    return {
      productId: form.productId || null,
      productVariantId: form.productVariantId || null,
      locationId: form.locationId || null,
      activityTypeId: activityTypes.find((a) => a.key === k)?.id || null,
      organizationTypeId: deal?.organizationTypeId || deal?.organization?.organizationTypeId || null,
      organizationSubtypeId: deal?.organizationSubtypeId || null,
      participantCount: form.participants === '' || form.participants == null ? 0 : Number(form.participants),
    };
  }, [form, deal, activityTypes]);

  async function persistContext() {
    await api.deals.updateQuoteOfferContext(deal.id, offerId, {
      productId: form.productId || null,
      productVariantId: form.productVariantId || null,
      locationId: form.locationId || null,
      participants: form.participants === '' ? null : form.participants,
      tourDate: form.tourDate || null,
      tourTime: form.tourTime || null,
    });
  }

  // Cancel before the first save deletes a just-created (still empty) offer.
  async function handleClose() {
    if (createdRef.current && !savedRef.current && offerId) {
      try { await api.deals.removeQuoteOffer(deal.id, offerId); } catch { /* already gone */ }
    }
    onDone?.(); // refresh the card either way
    onClose?.();
  }

  async function handleSaved() {
    // The builder saved lines + its context (routed to the OFFER by the server).
    // The header is authoritative for the offer's context — persist it last.
    await persistContext();
    savedRef.current = true;
  }

  if (!open || !form || !offerId) {
    if (error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
          <div dir="rtl" className="rounded-xl bg-white p-6 text-sm text-red-600 shadow-xl">שגיאה: {error}</div>
        </div>
      );
    }
    return null;
  }

  const cityOptions = variants
    .map((v) => ({ id: v.location?.id || v.locationId, name: v.location?.nameHe || '' }))
    .filter((o) => o.id);

  const headerExtra = (
    <div dir="rtl" className="mx-2 mb-4 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-bold text-gray-800">פרטי הצעה {offerNo}</span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700">
          הצעה עצמאית — לא משנה את העסקה
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-gray-500">📦 מוצר</label>
          <select className={SELECT} value={form.productId} onChange={(e) => onProduct(e.target.value)}>
            <option value="">— בחר מוצר —</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.nameHe}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">📍 עיר</label>
          <select className={SELECT} value={form.locationId} onChange={(e) => onCity(e.target.value)}>
            <option value="">— בחר עיר —</option>
            {cityOptions.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-500">👥 משתתפים</label>
          <input
            type="number"
            min="0"
            className={SELECT}
            value={form.participants}
            onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value }))}
          />
        </div>
        <div>
          <DateField label="📅 תאריך" value={form.tourDate} onChange={(v) => setForm((f) => ({ ...f, tourDate: v || '' }))} />
        </div>
        <div>
          <TimeField label="🕒 שעה" value={form.tourTime} onChange={(v) => setForm((f) => ({ ...f, tourTime: v || '' }))} />
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-gray-400">
        מומלץ לקבוע את המוצר והפרטים לפני התאמת המחיר — החלפת מוצר מרעננת את שורות התמחור.
      </p>
    </div>
  );

  return (
    <PriceBuilderDialog
      // Structural context change → remount: the builder re-aligns its product
      // line to the new context with its EXISTING on-open logic (no duplication).
      // Participants deliberately NOT in the key — it flows live via the context
      // prop (remounting per keystroke would drop focus in the header input).
      key={`${offerId}|${form.productId}|${form.productVariantId}`}
      open
      deal={deal}
      context={priceContext}
      title={`הצעה מקבילה ${offerNo ? `(הצעה ${offerNo})` : ''} — פרטים ותמחור`}
      headerExtra={headerExtra}
      skipDealTermsWrite
      onClose={handleClose}
      onSaved={handleSaved}
    />
  );
}
