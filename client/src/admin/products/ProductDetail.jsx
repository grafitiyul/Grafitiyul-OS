import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import RichEditor from '../../editor/RichEditor.jsx';
import { durationDisplay } from '../../lib/duration.js';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newLocationId, setNewLocationId] = useState('');
  const [addingVariant, setAddingVariant] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, locs] = await Promise.all([
        api.products.get(id),
        api.locations.list(),
      ]);
      setProduct(p);
      setLocations(locs);
      const init = {
        nameHe: p.nameHe || '',
        nameEn: p.nameEn || '',
        marketingDescHe: p.marketingDescHe || '',
        marketingDescEn: p.marketingDescEn || '',
        active: p.active,
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Unsaved-work guard (auto-update): dirty when product details diverge from the
  // loaded values; clears on revert and after save (refresh resets the baseline).
  useDirtyWhen(form, original, { active: !!form && !!original });

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
  // Reversible archive only — the CRM UI never hard-deletes a product.
  async function setProductActive(active) {
    try {
      await api.products.update(id, { active });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
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
      <SettingsChrome currentLabel={product?.nameHe} />

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
          {product.active ? (
            <button
              onClick={() => { if (confirm('להעביר את המוצר לארכיון? המוצר יישמר במלואו וניתן לשחזר בכל עת.')) setProductActive(false); }}
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-700 hover:bg-amber-50">
              העברה לארכיון
            </button>
          ) : (
            <button
              onClick={() => setProductActive(true)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              שחזור מארכיון
            </button>
          )}
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
              <VariantCard key={v.id} productId={id} variant={v} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// A variant row now NAVIGATES to the dedicated full-page editor
// (…/products/:id/variant/:variantId) instead of expanding inline. All variant
// fields live in that CMS-style workspace (see VariantEditor.jsx).
function VariantCard({ productId, variant }) {
  const navigate = useNavigate();
  return (
    <li>
      <button
        onClick={() => navigate(`/admin/settings/crm/products/${productId}/variant/${variant.id}`)}
        className="w-full flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-right transition hover:border-gray-300 hover:bg-gray-50"
      >
        <span className="font-semibold text-gray-900">{variant.location?.nameHe}</span>
        {variant.durationHours != null && <span className="text-[12px] text-gray-500">· {durationDisplay(variant.durationHours)}</span>}
        <div className="flex items-center gap-1">
          {variant.availablePublic && <Avail>קבוצתי</Avail>}
          {variant.availablePrivate && <Avail>פרטי</Avail>}
          {variant.availableBusiness && <Avail>עסקי</Avail>}
        </div>
        {!variant.active && <span className="text-[11px] text-gray-400">(לא פעיל)</span>}
        <div className="flex-1" />
        <span className="text-[12px] font-medium text-blue-600">עריכה ←</span>
      </button>
    </li>
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
function Avail({ children }) {
  return <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">{children}</span>;
}
