import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import PriceBuilderDialog from '../deals/PriceBuilderDialog.jsx';

// Pricing Simulator — CRM Settings → תמחור. Answers "what would a Deal with
// these inputs price at?" WITHOUT a Deal: the top block holds ONLY the
// Deal-context fields that affect pricing (mirrors DealDetail's priceContext),
// and below it runs the SAME Price Builder component (inline + simulated) that
// real Deals use, calling the SAME /api/pricing/builder engine path. חישוב
// אוטומטי inside the builder regenerates card lines + canonical first-line
// notes exactly as in a Deal; nothing here is ever saved.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

const EMPTY_FORM = {
  productId: '',
  productVariantId: '',
  activityTypeId: '',
  organizationTypeId: '',
  organizationSubtypeId: '',
  participants: '',
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.name}</option>
      ))}
    </select>
  );
}

export default function PricingSimulator() {
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [variants, setVariants] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // Bumping the key remounts the builder — the ONE reset mechanism (lines,
  // totals, computed result and validation state all start clean).
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    api.products.list().then(setProducts).catch(() => {});
    api.activityTypes.list().then(setActivityTypes).catch(() => {});
    api.organizationTypes.list().then(setOrgTypes).catch(() => {});
    api.organizationSubtypes.list().then(setOrgSubtypes).catch(() => {});
  }, []);

  // City list follows the chosen product (same product→variant relation a Deal
  // uses; the variant IS the city).
  useEffect(() => {
    let alive = true;
    if (!form.productId) {
      setVariants([]);
      return undefined;
    }
    api.products
      .get(form.productId)
      .then((p) => {
        if (alive) setVariants(p?.variants || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [form.productId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function pickProduct(productId) {
    setForm((f) => ({ ...f, productId, productVariantId: '' }));
  }
  function pickOrgType(organizationTypeId) {
    setForm((f) => ({ ...f, organizationTypeId, organizationSubtypeId: '' }));
  }

  function resetSimulator() {
    setForm(EMPTY_FORM);
    setVariants([]);
    setResetKey((k) => k + 1);
  }

  // The simulated Deal context — the exact shape DealDetail hands the builder.
  const simContext = useMemo(
    () => ({
      productId: form.productId || null,
      productVariantId: form.productVariantId || null,
      activityTypeId: form.activityTypeId || null,
      organizationTypeId: form.organizationTypeId || null,
      organizationSubtypeId: form.organizationSubtypeId || null,
      participantCount: form.participants === '' ? 0 : Number(form.participants),
    }),
    [form],
  );

  const subtypeOpts = [
    { value: '', name: '— ללא —' },
    ...orgSubtypes
      .filter((s) => !form.organizationTypeId || s.organizationTypeId === form.organizationTypeId)
      .map((s) => ({ value: s.id, name: s.label })),
  ];

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <SettingsChrome />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">סימולטור תמחור</h1>
          <p className="text-[15px] text-gray-500 mt-1.5">
            בדקו מה דיל עם הנתונים האלה היה מקבל — אותו בונה מחיר ואותו מנוע חישוב של דיל אמיתי. שום דבר לא נשמר.
          </p>
        </div>
        <button
          type="button"
          onClick={resetSimulator}
          className="shrink-0 mt-1 h-10 rounded-lg border border-gray-300 px-4 text-sm text-gray-700 hover:bg-gray-50"
        >
          איפוס סימולטור
        </button>
      </header>

      {/* Simulated Deal context — ONLY the fields that affect pricing. */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="מוצר">
            <Select
              value={form.productId}
              onChange={pickProduct}
              options={[{ value: '', name: '— בחרו מוצר —' }, ...products.map((p) => ({ value: p.id, name: p.nameHe }))]}
            />
          </Field>
          <Field label="עיר / מיקום">
            <Select
              value={form.productVariantId}
              onChange={(v) => set('productVariantId', v)}
              options={[{ value: '', name: '—' }, ...variants.map((v) => ({ value: v.id, name: v.location?.nameHe || v.id }))]}
            />
          </Field>
          <Field label="סוג פעילות">
            <Select
              value={form.activityTypeId}
              onChange={(v) => set('activityTypeId', v)}
              options={[{ value: '', name: '— בחרו —' }, ...activityTypes.map((a) => ({ value: a.id, name: a.nameHe }))]}
            />
          </Field>
          <Field label="סוג ארגון">
            <Select
              value={form.organizationTypeId}
              onChange={pickOrgType}
              options={[{ value: '', name: '— ללא —' }, ...orgTypes.map((t) => ({ value: t.id, name: t.label }))]}
            />
          </Field>
          <Field label="תת-סוג ארגון">
            <Select value={form.organizationSubtypeId} onChange={(v) => set('organizationSubtypeId', v)} options={subtypeOpts} />
          </Field>
          <Field label="משתתפים">
            <input
              dir="ltr"
              inputMode="numeric"
              value={form.participants}
              onChange={(e) => set('participants', e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className={INPUT}
            />
          </Field>
        </div>
      </div>

      {/* The SAME Private/Business Price Builder a real Deal opens — inline,
          simulated (no load, no save). חישוב אוטומטי is in its toolbar. */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
        <PriceBuilderDialog key={resetKey} inline simulated open deal={null} context={simContext} />
      </div>
    </div>
  );
}
