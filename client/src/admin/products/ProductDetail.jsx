import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import BackButton from '../common/BackButton.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { minorToInput, toMinor, formatMinor } from '../../lib/money.js';
import { durationDisplay } from '../../lib/duration.js';
import { SingleImage, Gallery } from './ImageUploader.jsx';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newLocationId, setNewLocationId] = useState('');
  const [addingVariant, setAddingVariant] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, locs] = await Promise.all([api.products.get(id), api.locations.list()]);
      setProduct(p);
      setLocations(locs);
      setForm({
        nameHe: p.nameHe || '',
        nameEn: p.nameEn || '',
        marketingDescHe: p.marketingDescHe || '',
        marketingDescEn: p.marketingDescEn || '',
        active: p.active,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  function set(field, v) { setForm((f) => ({ ...f, [field]: v })); }

  async function save() {
    setSaving(true);
    try {
      await api.products.update(id, form);
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }
  async function removeProduct() {
    if (!confirm('למחוק את המוצר? כל הוריאציות שלו יימחקו.')) return;
    try {
      await api.products.remove(id);
      navigate('/admin/settings/crm/products');
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function addVariant() {
    if (!newLocationId) return;
    setAddingVariant(true);
    try {
      await api.products.addVariant(id, { locationId: newLocationId });
      setNewLocationId('');
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setAddingVariant(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">טוען…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">שגיאה: {error}</div>;
  if (!product || !form) return null;

  const usedLocationIds = new Set(product.variants.map((v) => v.locationId));
  const availableLocations = locations.filter((l) => !usedLocationIds.has(l.id));

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-8 lg:py-10 space-y-6">
      <BackButton to="/admin/settings/crm/products" label="חזרה למוצרים" />

      {/* Product fields */}
      <Card title="פרטי המוצר">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="שם (עברית)">
            <input value={form.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} />
          </Field>
          <Field label="Name (EN)">
            <input value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={INPUT} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="תיאור שיווקי (עברית)">
            <RichEditor value={form.marketingDescHe} onChange={(html) => set('marketingDescHe', html)} ariaLabel="תיאור שיווקי עברית" />
          </Field>
          <Field label="Marketing description (EN)">
            <RichEditor value={form.marketingDescEn} onChange={(html) => set('marketingDescEn', html)} ariaLabel="marketing description english" placeholder="Write here..." />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-3">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="rounded border-gray-300" />
          מוצר פעיל
        </label>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'שומר…' : 'שמור'}</button>
          <button onClick={removeProduct} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">מחק מוצר</button>
        </div>
      </Card>

      {/* Variants */}
      <Card
        title={`וריאציות לפי מיקום (${product.variants.length})`}
        action={
          <div className="flex items-center gap-2">
            <select value={newLocationId} onChange={(e) => setNewLocationId(e.target.value)}
              disabled={availableLocations.length === 0}
              className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-[13px] disabled:bg-gray-100">
              <option value="">{availableLocations.length ? 'בחר מיקום…' : 'כל המיקומים בשימוש'}</option>
              {availableLocations.map((l) => (<option key={l.id} value={l.id}>{l.nameHe}</option>))}
            </select>
            <button onClick={addVariant} disabled={!newLocationId || addingVariant}
              className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              + וריאציה
            </button>
          </div>
        }
      >
        {product.variants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
            אין עדיין וריאציות. בחרו מיקום והוסיפו וריאציה.
            {locations.length === 0 && ' (תחילה יש להגדיר מיקומים תחת "מיקומים".)'}
          </div>
        ) : (
          <ul className="space-y-3">
            {product.variants.map((v) => (
              <VariantCard key={v.id} variant={v} onChange={refresh} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function VariantCard({ variant, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-gray-200">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-right">
        <span className="font-semibold text-gray-900">{variant.location?.nameHe}</span>
        {variant.durationHours != null && <span className="text-[12px] text-gray-500">· {durationDisplay(variant.durationHours)}</span>}
        <div className="flex items-center gap-1">
          {variant.availablePublic && <Avail>קבוצתי</Avail>}
          {variant.availablePrivate && <Avail>פרטי</Avail>}
          {variant.availableBusiness && <Avail>עסקי</Avail>}
        </div>
        {!variant.active && <span className="text-[11px] text-gray-400">(לא פעיל)</span>}
        <div className="flex-1" />
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && <VariantForm variant={variant} onChange={onChange} />}
    </li>
  );
}

function VariantForm({ variant, onChange }) {
  const [form, setForm] = useState(() => ({
    marketingDescHe: variant.marketingDescHe || '',
    marketingDescEn: variant.marketingDescEn || '',
    guideDescHe: variant.guideDescHe || '',
    guideDescEn: variant.guideDescEn || '',
    durationHours: variant.durationHours ?? '',
    meetingPointHe: variant.meetingPointHe || '',
    meetingPointEn: variant.meetingPointEn || '',
    endingPointHe: variant.endingPointHe || '',
    endingPointEn: variant.endingPointEn || '',
    meetingPointImage: variant.meetingPointImage || null,
    baseGuidePayment: minorToInput(variant.baseGuidePaymentMinor),
    travelPayment: minorToInput(variant.travelPaymentMinor),
    availablePublic: variant.availablePublic,
    availablePrivate: variant.availablePrivate,
    availableBusiness: variant.availableBusiness,
    active: variant.active,
  }));
  const [saving, setSaving] = useState(false);
  function set(field, v) { setForm((f) => ({ ...f, [field]: v })); }

  async function save() {
    setSaving(true);
    try {
      await api.products.updateVariant(variant.id, {
        marketingDescHe: form.marketingDescHe,
        marketingDescEn: form.marketingDescEn,
        guideDescHe: form.guideDescHe,
        guideDescEn: form.guideDescEn,
        durationHours: form.durationHours === '' ? null : Number(form.durationHours),
        meetingPointHe: form.meetingPointHe,
        meetingPointEn: form.meetingPointEn,
        endingPointHe: form.endingPointHe,
        endingPointEn: form.endingPointEn,
        meetingPointImageId: form.meetingPointImage?.id || null,
        baseGuidePaymentMinor: toMinor(form.baseGuidePayment) ?? 0,
        travelPaymentMinor: toMinor(form.travelPayment),
        availablePublic: form.availablePublic,
        availablePrivate: form.availablePrivate,
        availableBusiness: form.availableBusiness,
        active: form.active,
      });
      await onChange();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm(`למחוק את הוריאציה של "${variant.location?.nameHe}"?`)) return;
    try { await api.products.removeVariant(variant.id); await onChange(); }
    catch (e) {
      // The backend blocks removing the LAST variant (a product must keep ≥1).
      if (e.payload?.error === 'last_variant')
        alert('לא ניתן למחוק את הוריאציה האחרונה. למוצר חייב להיות לפחות מיקום אחד — הוסיפו מיקום נוסף קודם, או מחקו את המוצר כולו.');
      else alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="border-t border-gray-100 p-4 space-y-4">
      <div className="grid grid-cols-1 gap-4">
        <Field label="תיאור שיווקי (עברית)">
          <RichEditor value={form.marketingDescHe} onChange={(h) => set('marketingDescHe', h)} ariaLabel="variant marketing he" minContentHeight={120} />
        </Field>
        <Field label="Marketing (EN)">
          <RichEditor value={form.marketingDescEn} onChange={(h) => set('marketingDescEn', h)} ariaLabel="variant marketing en" minContentHeight={120} placeholder="Write here..." />
        </Field>
        <Field label="תיאור למדריך (עברית, פנימי)">
          <RichEditor value={form.guideDescHe} onChange={(h) => set('guideDescHe', h)} ariaLabel="variant guide he" minContentHeight={100} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="משך (שעות)">
          <input value={form.durationHours} onChange={(e) => set('durationHours', e.target.value)} inputMode="decimal" dir="ltr" placeholder="2.5" className={INPUT} />
          {form.durationHours !== '' && <div className="text-[12px] text-gray-500 mt-1">{durationDisplay(form.durationHours)}</div>}
        </Field>
        <div />
        <Field label="נקודת מפגש (עברית)"><input value={form.meetingPointHe} onChange={(e) => set('meetingPointHe', e.target.value)} className={INPUT} /></Field>
        <Field label="Meeting point (EN)"><input value={form.meetingPointEn} onChange={(e) => set('meetingPointEn', e.target.value)} dir="ltr" className={INPUT} /></Field>
        <Field label="נקודת סיום (עברית)"><input value={form.endingPointHe} onChange={(e) => set('endingPointHe', e.target.value)} className={INPUT} /></Field>
        <Field label="Ending point (EN)"><input value={form.endingPointEn} onChange={(e) => set('endingPointEn', e.target.value)} dir="ltr" className={INPUT} /></Field>
      </div>

      <Field label="תמונת נקודת מפגש">
        <SingleImage image={form.meetingPointImage} onChange={(mf) => set('meetingPointImage', mf)} folder="products/meeting" />
      </Field>

      <Field label="גלריית תמונות להצעת מחיר">
        <Gallery variantId={variant.id} images={variant.galleryImages} onChanged={onChange} folder="products/gallery" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="תשלום בסיס למדריך (₪)"><input value={form.baseGuidePayment} onChange={(e) => set('baseGuidePayment', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} /></Field>
        <Field label="תשלום נסיעות (₪, אופציונלי)"><input value={form.travelPayment} onChange={(e) => set('travelPayment', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} /></Field>
      </div>

      <div>
        <div className="text-[11px] text-gray-500 mb-1.5">זמינות לפי פורמט</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Check label="קבוצתי" checked={form.availablePublic} onChange={(c) => set('availablePublic', c)} />
          <Check label="פרטי" checked={form.availablePrivate} onChange={(c) => set('availablePrivate', c)} />
          <Check label="עסקי" checked={form.availableBusiness} onChange={(c) => set('availableBusiness', c)} />
        </div>
      </div>

      <Check label="וריאציה פעילה" checked={form.active} onChange={(c) => set('active', c)} />

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'שומר…' : 'שמור וריאציה'}</button>
        <button onClick={remove} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">מחק וריאציה</button>
      </div>
    </div>
  );
}

// ── Atoms ──
function Card({ title, action, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
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
function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-gray-700">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-gray-300" />
      {label}
    </label>
  );
}
function Avail({ children }) {
  return <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">{children}</span>;
}
