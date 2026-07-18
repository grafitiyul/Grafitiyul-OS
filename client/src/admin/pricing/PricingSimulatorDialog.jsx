import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import PriceBuilderDialog from '../deals/PriceBuilderDialog.jsx';

// Pricing Simulator — a POPUP over CRM Settings → תמחור, not a page. It answers
// "what would a Deal with these inputs price at?" by rendering the REAL
// Private/Business Price Builder dialog (same shell, same layout, same
// /api/pricing/builder engine path) in simulated mode, with the Deal-context
// fields that affect pricing as a block directly above the builder
// (headerExtra). Nothing is persisted: no Deal, no Quote, no side effects.
//
// Reset (איפוס סימולטור, in the dialog footer) clears the context AND remounts
// the builder (key bump) without closing the popup. The parent renders this
// component only while open, so closing + reopening always starts clean.

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

export default function PricingSimulatorDialog({ open, onClose }) {
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [variants, setVariants] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // Key bump remounts the builder — the ONE reset mechanism (lines, totals,
  // computed result and validation state all start clean; popup stays open).
  const [resetSeq, setResetSeq] = useState(0);

  useEffect(() => {
    if (!open) return;
    api.products.list().then(setProducts).catch(() => {});
    api.activityTypes.list().then(setActivityTypes).catch(() => {});
    api.organizationTypes.list().then(setOrgTypes).catch(() => {});
    api.organizationSubtypes.list().then(setOrgSubtypes).catch(() => {});
  }, [open]);

  // City list follows the chosen product (the variant IS the city — the same
  // product→variant relation a Deal uses).
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

  function resetSimulator() {
    setForm(EMPTY_FORM);
    setVariants([]);
    setResetSeq((k) => k + 1);
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

  // The simulated Deal-context block, rendered INSIDE the builder popup directly
  // above the lines — one complete builder experience.
  const contextBlock = (
    <div className="mx-2 mt-1 mb-4 rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3.5">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <span className="text-[13px] font-semibold text-gray-800">נתוני הדיל המדומה</span>
        <span className="text-[11px] text-gray-400">שום דבר לא נשמר — סימולציה בלבד</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="מוצר">
          <Select
            value={form.productId}
            onChange={(v) => setForm((f) => ({ ...f, productId: v, productVariantId: '' }))}
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
            onChange={(v) => setForm((f) => ({ ...f, organizationTypeId: v, organizationSubtypeId: '' }))}
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
  );

  if (!open) return null;

  return (
    <PriceBuilderDialog
      key={resetSeq}
      open={open}
      simulated
      deal={null}
      context={simContext}
      onClose={onClose}
      onReset={resetSimulator}
      title="סימולטור תמחור"
      headerExtra={contextBlock}
    />
  );
}
