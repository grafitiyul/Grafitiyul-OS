import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import BackButton from '../common/BackButton.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { SettingsCard } from '../crm/settings/catalogKit.jsx';
import { formatMinor, toMinor, minorToInput } from '../../lib/money.js';

// Pricing settings (Slice 2): manage price lists + their rules, map org
// types/subtypes to a default price list, and a test calculator for the engine.
// NOT wired to Deals.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, className = '' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${className}`}>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.name}</option>
      ))}
    </select>
  );
}

// Major-unit money input → reports minor units (or null) via onChange.
function Money({ minor, onChange, placeholder }) {
  return (
    <input
      dir="ltr"
      inputMode="decimal"
      value={minorToInput(minor)}
      onChange={(e) => onChange(toMinor(e.target.value))}
      placeholder={placeholder || '0'}
      className={`${INPUT} text-left`}
    />
  );
}

const VAT_MODE_OPTS = [
  { value: 'included', name: 'מחיר כולל מע"מ' },
  { value: 'excluded', name: 'מחיר ללא מע"מ' },
];

export default function PricingSettings() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // Reference data for scope pickers / org defaults.
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [orgTypes, setOrgTypes] = useState([]);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [segments, setSegments] = useState([]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [l, p, at, ot, os, seg] = await Promise.all([
        api.priceLists.list(),
        api.products.list(),
        api.activityTypes.list(),
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
        api.pricingSegments.list(),
      ]);
      setLists(l);
      setProducts(p);
      setActivityTypes(at);
      setOrgTypes(ot);
      setOrgSubtypes(os);
      setSegments(seg);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const selected = lists.find((l) => l.id === selectedId) || null;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto space-y-6">
      <header>
        <BackButton to="/admin/settings/crm/pricing" label="חזרה לתמחור" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">תמחור — מצב מתקדם</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">
          תצוגת מנוע גולמית: חוקי תמחור, ברירות מחדל לפי ארגון, ומחשבון בדיקה. למסך העסקי חזרו לתמחור.
        </p>
      </header>

      {error && <div className="text-sm text-red-600">שגיאה: {error}</div>}

      <PriceListsSection
        lists={lists}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={refresh}
      />

      {selected && (
        <RulesSection
          list={selected}
          products={products}
          activityTypes={activityTypes}
          orgSubtypes={orgSubtypes}
        />
      )}

      <SegmentMappingSection
        segments={segments}
        activityTypes={activityTypes}
        orgSubtypes={orgSubtypes}
        onChanged={refresh}
      />

      <OrgDefaultsSection
        lists={lists}
        orgTypes={orgTypes}
        orgSubtypes={orgSubtypes}
        onChanged={refresh}
      />

      <CalculatorSection
        products={products}
        activityTypes={activityTypes}
        orgTypes={orgTypes}
        orgSubtypes={orgSubtypes}
      />
    </div>
  );
}

// ─────────────────────────────── Price lists ───────────────────────────────

function PriceListsSection({ lists, loading, selectedId, onSelect, onChanged }) {
  const [nameHe, setNameHe] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await api.priceLists.create({ nameHe: nameHe.trim() });
      setNameHe('');
      await onChanged();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function reorder(ids) {
    try { await api.priceLists.reorder(ids); } catch { /* visual only */ }
  }

  return (
    <SettingsCard
      title="מחירונים"
      description="כל מחירון מחזיק חוקי תמחור וברירות מע״מ/מטבע. מחירון אחד מסומן כברירת מחדל של המערכת."
      footer={
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם מחירון חדש"
            className={`flex-1 ${INPUT}`} />
          <button type="submit" disabled={busy || !nameHe.trim()}
            className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'מוסיף…' : 'הוסף מחירון'}
          </button>
        </form>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <ReorderableList
          items={lists}
          onReorder={reorder}
          emptyText="עדיין אין מחירונים. הוסיפו את הראשון למטה."
          renderRow={(list, { handle }) =>
            editingId === list.id ? (
              <PriceListEdit list={list} onClose={() => setEditingId(null)} onChanged={onChanged} />
            ) : (
              <div className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 ${selectedId === list.id ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}>
                {handle}
                <button onClick={() => onSelect(selectedId === list.id ? null : list.id)} className="flex-1 min-w-0 text-right">
                  <span className="font-medium text-gray-900 text-[15px]">{list.nameHe}</span>
                  {list.nameEn && <span className="text-[12px] text-gray-400 ms-2" dir="ltr">{list.nameEn}</span>}
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {list.defaultVatMode === 'included' ? 'כולל מע״מ' : 'ללא מע״מ'} · {list.defaultVatRate}% · {list.currency} · {list._count?.rules ?? 0} חוקים
                  </div>
                </button>
                {list.isDefault && <span className="text-[11px] rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 ring-1 ring-emerald-100">ברירת מחדל</span>}
                {!list.active && <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעיל</span>}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onSelect(selectedId === list.id ? null : list.id)} title="ניהול חוקים"
                    className="text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1 text-[12px] font-medium">
                    {selectedId === list.id ? 'סגור' : 'חוקים'}
                  </button>
                  {!list.isDefault && (
                    <button onClick={async () => { await api.priceLists.setDefault(list.id); onChanged(); }} title="קבע כברירת מחדל"
                      className="text-emerald-600 hover:bg-emerald-50 rounded-md p-1.5">★</button>
                  )}
                  <button onClick={() => setEditingId(list.id)} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                  <button
                    onClick={async () => {
                      if (!confirm(`למחוק את "${list.nameHe}"?`)) return;
                      try { await api.priceLists.remove(list.id); onChanged(); }
                      catch (e) { alert(e.payload?.error === 'cannot_delete_default' ? 'לא ניתן למחוק את מחירון ברירת המחדל.' : 'שגיאה: ' + e.message); }
                    }}
                    title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
                </div>
              </div>
            )
          }
        />
      )}
    </SettingsCard>
  );
}

function PriceListEdit({ list, onClose, onChanged }) {
  const [d, setD] = useState({
    nameHe: list.nameHe, nameEn: list.nameEn || '',
    defaultVatMode: list.defaultVatMode, defaultVatRate: String(list.defaultVatRate),
    currency: list.currency, active: list.active,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.priceLists.update(list.id, {
        nameHe: d.nameHe.trim(), nameEn: d.nameEn.trim() || null,
        defaultVatMode: d.defaultVatMode, defaultVatRate: Number(d.defaultVatRate) || 0,
        currency: d.currency || 'ILS', active: d.active,
      });
      onClose(); await onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Field label="שם (עברית)"><input value={d.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} /></Field>
      <Field label="Name (EN)"><input value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={INPUT} /></Field>
      <Field label="מטבע"><input value={d.currency} onChange={(e) => set('currency', e.target.value)} dir="ltr" className={INPUT} /></Field>
      <Field label="ברירת מע״מ"><Select value={d.defaultVatMode} onChange={(v) => set('defaultVatMode', v)} options={VAT_MODE_OPTS} /></Field>
      <Field label='שיעור מע״מ %'><input value={d.defaultVatRate} onChange={(e) => set('defaultVatRate', e.target.value)} dir="ltr" className={INPUT} /></Field>
      <label className="flex items-center gap-2 mt-6 text-sm text-gray-700">
        <input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} /> פעיל
      </label>
      <div className="col-span-2 sm:col-span-3 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}

// ──────────────────────────────── Price rules ──────────────────────────────

function RulesSection({ list, products, activityTypes, orgSubtypes }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRules(await api.priceRules.list(list.id)); }
    finally { setLoading(false); }
  }, [list.id]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SettingsCard
      title={`חוקי תמחור — ${list.nameHe}`}
      description='כל חוק יכול לצמצם לפי מוצר / וריאציה / סוג פעילות / תת-סוג ארגון. שדה ריק = "כל ערך". החוק הספציפי ביותר מנצח, ואז העדיפות.'
      footer={
        adding ? null : (
          <button onClick={() => setAdding(true)} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700">+ חוק חדש</button>
        )
      }
    >
      {adding && (
        <RuleForm list={list} products={products} activityTypes={activityTypes} orgSubtypes={orgSubtypes}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
      )}
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">טוען…</div>
      ) : rules.length === 0 && !adding ? (
        <div className="py-8 text-center text-sm text-gray-400">אין עדיין חוקים במחירון הזה.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rules.map((r) =>
            editing === r.id ? (
              <li key={r.id} className="py-2">
                <RuleForm list={list} rule={r} products={products} activityTypes={activityTypes} orgSubtypes={orgSubtypes}
                  onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
              </li>
            ) : (
              <li key={r.id} className="flex items-center gap-3 px-2 py-2.5">
                <div className="flex-1 min-w-0">
                  <RuleSummary rule={r} products={products} activityTypes={activityTypes} orgSubtypes={orgSubtypes} />
                </div>
                <span className="text-[11px] text-gray-500 shrink-0">עדיפות {r.priority}</span>
                {!r.active && <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">כבוי</span>}
                <button onClick={() => setEditing(r.id)} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                <button onClick={async () => { if (confirm('למחוק חוק זה?')) { await api.priceRules.remove(r.id); refresh(); } }}
                  title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
              </li>
            ),
          )}
        </ul>
      )}
    </SettingsCard>
  );
}

function nameOf(arr, id, field = 'nameHe') {
  const x = arr.find((a) => a.id === id);
  return x ? (x[field] || x.label || x.nameHe) : null;
}

function RuleSummary({ rule, products, activityTypes, orgSubtypes }) {
  const scopes = [];
  if (rule.productId) scopes.push(`מוצר: ${nameOf(products, rule.productId) || '—'}`);
  if (rule.productVariantId) scopes.push('וריאציה ספציפית');
  if (rule.activityTypeId) scopes.push(`פעילות: ${nameOf(activityTypes, rule.activityTypeId) || '—'}`);
  if (rule.organizationSubtypeId) scopes.push(`תת-סוג: ${nameOf(orgSubtypes, rule.organizationSubtypeId, 'label') || '—'}`);
  let price;
  if (rule.priceModel === 'per_head') {
    price = `לראש — מבוגר ${formatMinor(rule.adultPriceMinor)} / ילד ${formatMinor(rule.childPriceMinor)}`;
  } else if (rule.priceModel === 'fixed') {
    price = `קבוע — ${formatMinor(rule.fixedPriceMinor)}`;
  } else if (rule.priceModel === 'tiered_group') {
    const n = rule.tiers?.length ?? 0;
    price = `מדרגות קבוצה — ${n} מדרגות, +${formatMinor(rule.perAdditionalParticipantMinor)} מעל האחרונה`;
  } else {
    price = `מדורג — בסיס ${formatMinor(rule.basePriceMinor)} עד ${rule.baseParticipants ?? 0} משתתפים, +${formatMinor(rule.perAdditionalParticipantMinor)} לכל נוסף`;
  }
  return (
    <div>
      <div className="text-[14px] text-gray-900">{price}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{scopes.length ? scopes.join(' · ') : 'חל על הכול (ללא צמצום)'}</div>
    </div>
  );
}

function RuleForm({ list, rule, products, activityTypes, orgSubtypes, onClose, onSaved }) {
  const [d, setD] = useState({
    priceModel: rule?.priceModel || 'per_head',
    productId: rule?.productId || '',
    productVariantId: rule?.productVariantId || '',
    activityTypeId: rule?.activityTypeId || '',
    organizationSubtypeId: rule?.organizationSubtypeId || '',
    adultPriceMinor: rule?.adultPriceMinor ?? null,
    childPriceMinor: rule?.childPriceMinor ?? null,
    basePriceMinor: rule?.basePriceMinor ?? null,
    baseParticipants: rule?.baseParticipants ?? null,
    perAdditionalParticipantMinor: rule?.perAdditionalParticipantMinor ?? null,
    vatMode: rule?.vatMode || '',
    vatRate: rule?.vatRate ?? '',
    priority: rule?.priority ?? 0,
    active: rule?.active ?? true,
  });
  const [variants, setVariants] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));

  // Load variants for the chosen product (scope picker).
  useEffect(() => {
    let alive = true;
    if (!d.productId) { setVariants([]); return; }
    api.products.get(d.productId).then((p) => { if (alive) setVariants(p.variants || []); }).catch(() => {});
    return () => { alive = false; };
  }, [d.productId]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        priceListId: list.id,
        priceModel: d.priceModel,
        productId: d.productId || null,
        productVariantId: d.productVariantId || null,
        activityTypeId: d.activityTypeId || null,
        organizationSubtypeId: d.organizationSubtypeId || null,
        adultPriceMinor: d.adultPriceMinor,
        childPriceMinor: d.childPriceMinor,
        basePriceMinor: d.basePriceMinor,
        baseParticipants: d.baseParticipants,
        perAdditionalParticipantMinor: d.perAdditionalParticipantMinor,
        vatMode: d.vatMode || null,
        vatRate: d.vatRate === '' ? null : Number(d.vatRate),
        priority: Number(d.priority) || 0,
        active: d.active,
      };
      if (rule) await api.priceRules.update(rule.id, payload);
      else await api.priceRules.create(payload);
      onSaved();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  const productOpts = [{ value: '', name: 'כל המוצרים' }, ...products.map((p) => ({ value: p.id, name: p.nameHe }))];
  const variantOpts = [{ value: '', name: 'כל הוריאציות' }, ...variants.map((v) => ({ value: v.id, name: v.location?.nameHe || v.id }))];
  const activityOpts = [{ value: '', name: 'כל סוגי הפעילות' }, ...activityTypes.map((a) => ({ value: a.id, name: `${a.nameHe} (${a.priceModel === 'per_head' ? 'לראש' : 'מדורג'})` }))];
  const subtypeOpts = [{ value: '', name: 'כל תתי-הסוגים' }, ...orgSubtypes.map((s) => ({ value: s.id, name: s.label }))];

  return (
    <form onSubmit={save} className="rounded-lg bg-blue-50/50 ring-1 ring-blue-100 p-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="מודל תמחור">
          <Select value={d.priceModel} onChange={(v) => set('priceModel', v)} options={[{ value: 'per_head', name: 'לראש' }, { value: 'tiered', name: 'מדורג' }]} />
        </Field>
        <Field label="מוצר"><Select value={d.productId} onChange={(v) => { set('productId', v); set('productVariantId', ''); }} options={productOpts} /></Field>
        <Field label="וריאציה"><Select value={d.productVariantId} onChange={(v) => set('productVariantId', v)} options={variantOpts} /></Field>
        <Field label="סוג פעילות"><Select value={d.activityTypeId} onChange={(v) => set('activityTypeId', v)} options={activityOpts} /></Field>
        <Field label="תת-סוג ארגון"><Select value={d.organizationSubtypeId} onChange={(v) => set('organizationSubtypeId', v)} options={subtypeOpts} /></Field>
      </div>

      {d.priceModel === 'per_head' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="מחיר מבוגר"><Money minor={d.adultPriceMinor} onChange={(v) => set('adultPriceMinor', v)} /></Field>
          <Field label="מחיר ילד"><Money minor={d.childPriceMinor} onChange={(v) => set('childPriceMinor', v)} /></Field>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Field label="מחיר בסיס"><Money minor={d.basePriceMinor} onChange={(v) => set('basePriceMinor', v)} /></Field>
          <Field label="משתתפים בבסיס"><input dir="ltr" value={d.baseParticipants ?? ''} onChange={(e) => set('baseParticipants', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} /></Field>
          <Field label="מחיר לכל משתתף נוסף"><Money minor={d.perAdditionalParticipantMinor} onChange={(v) => set('perAdditionalParticipantMinor', v)} /></Field>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="מע״מ (עוקף מחירון)">
          <Select value={d.vatMode} onChange={(v) => set('vatMode', v)} options={[{ value: '', name: 'ברירת מחדל של המחירון' }, ...VAT_MODE_OPTS]} />
        </Field>
        <Field label='שיעור מע״מ % (עוקף)'><input dir="ltr" value={d.vatRate} onChange={(e) => set('vatRate', e.target.value)} placeholder="ירושה" className={INPUT} /></Field>
        <Field label="עדיפות"><input dir="ltr" value={d.priority} onChange={(e) => set('priority', e.target.value)} className={INPUT} /></Field>
        <label className="flex items-center gap-2 mt-6 text-sm text-gray-700">
          <input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} /> פעיל
        </label>
      </div>

      <div className="flex gap-1.5">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור חוק'}</button>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}

// ───────────────────────── Segment (tab) mappings ──────────────────────────
//
// The business Pricing screen shows tabs (PricingSegment). Each tab maps to an
// Activity Type and/or Organization Subtype — this is the one-time configuration
// that connects a business tab to the engine's resolution scope. Changing a
// mapping here propagates to existing cards in that tab (server-side).

function SegmentMappingSection({ segments, activityTypes, orgSubtypes, onChanged }) {
  const atOpts = [{ value: '', name: '— ללא —' }, ...activityTypes.map((a) => ({ value: a.id, name: a.nameHe }))];
  const osOpts = [{ value: '', name: '— ללא —' }, ...orgSubtypes.map((s) => ({ value: s.id, name: s.label }))];

  async function setBinding(id, patch) {
    try { await api.pricingSegments.update(id, patch); onChanged(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  return (
    <SettingsCard
      title="מיפוי לשוניות תמחור"
      description="לכל לשונית עסקית (קבוצתי / פרטי / עסקי / בית ספר / סוכנים / מפיקים) אפשר לקשר סוג פעילות ו/או תת-סוג ארגון. זהו חיבור חד-פעמי בין המסך העסקי למנוע. שינוי כאן מתעדכן גם בכרטיסים קיימים."
    >
      <div className="space-y-2 p-2">
        {segments.length === 0 && <div className="text-[12px] text-gray-400">אין לשוניות.</div>}
        {segments.map((s) => (
          <div key={s.id} className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_1fr] gap-2 items-center">
            <span className="text-sm font-medium text-gray-800">{s.nameHe}</span>
            <Select value={s.activityTypeId || ''} onChange={(v) => setBinding(s.id, { activityTypeId: v || null })} options={atOpts} />
            <Select value={s.organizationSubtypeId || ''} onChange={(v) => setBinding(s.id, { organizationSubtypeId: v || null })} options={osOpts} />
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

// ───────────────────────── Org type/subtype defaults ───────────────────────

function OrgDefaultsSection({ lists, orgTypes, orgSubtypes, onChanged }) {
  const listOpts = [{ value: '', name: '— (ברירת מחדל של המערכת) —' }, ...lists.map((l) => ({ value: l.id, name: l.nameHe }))];

  async function setType(id, defaultPriceListId) {
    try { await api.organizationTypes.update(id, { defaultPriceListId }); onChanged(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }
  async function setSubtype(id, defaultPriceListId) {
    try { await api.organizationSubtypes.update(id, { defaultPriceListId }); onChanged(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  return (
    <SettingsCard
      title="מחירון ברירת מחדל לפי ארגון"
      description="לכל סוג או תת-סוג ארגון אפשר לקבוע מחירון ברירת מחדל. תת-סוג גובר על סוג. ריק = יורש את ברירת המחדל של המערכת."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-2">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-700 mb-2">סוגי ארגון</h4>
          <div className="space-y-1.5">
            {orgTypes.length === 0 && <div className="text-[12px] text-gray-400">אין סוגי ארגון.</div>}
            {orgTypes.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-gray-800 truncate">{t.label}</span>
                <Select value={t.defaultPriceListId || ''} onChange={(v) => setType(t.id, v)} options={listOpts} className="!w-56" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-[13px] font-semibold text-gray-700 mb-2">תתי-סוג</h4>
          <div className="space-y-1.5">
            {orgSubtypes.length === 0 && <div className="text-[12px] text-gray-400">אין תתי-סוג.</div>}
            {orgSubtypes.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-gray-800 truncate">{s.label}</span>
                <Select value={s.defaultPriceListId || ''} onChange={(v) => setSubtype(s.id, v)} options={listOpts} className="!w-56" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

// ──────────────────────────── Pricing calculator ───────────────────────────

const ERROR_LABELS = {
  activity_type_required: 'יש לבחור סוג פעילות.',
  activity_type_not_found: 'סוג הפעילות לא נמצא.',
  no_price_list: 'לא נמצא מחירון מתאים.',
  no_price_rule: 'לא נמצא חוק תמחור תואם להקשר הזה.',
  ambiguous_price_rule: 'נמצאו שני חוקים זהים ברמת ספציפיות ועדיפות — לא ניתן להכריע. הגדירו עדיפות שונה.',
  rule_incomplete: 'לחוק התואם חסרים שדות מחיר עבור המודל.',
  unknown_price_model: 'מודל תמחור לא מוכר.',
};

function CalculatorSection({ products, activityTypes, orgTypes, orgSubtypes }) {
  const [f, setF] = useState({
    productId: '', productVariantId: '', activityTypeId: '',
    organizationTypeId: '', organizationSubtypeId: '',
    adultCount: '', childCount: '', participantCount: '', groupCount: '1',
  });
  const [variants, setVariants] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let alive = true;
    if (!f.productId) { setVariants([]); return; }
    api.products.get(f.productId).then((p) => { if (alive) setVariants(p.variants || []); }).catch(() => {});
    return () => { alive = false; };
  }, [f.productId]);

  async function run(e) {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      const num = (v) => (v === '' ? undefined : Number(v));
      const res = await api.pricing.calculate({
        productId: f.productId || undefined,
        productVariantId: f.productVariantId || undefined,
        activityTypeId: f.activityTypeId || undefined,
        organizationTypeId: f.organizationTypeId || undefined,
        organizationSubtypeId: f.organizationSubtypeId || undefined,
        adultCount: num(f.adultCount), childCount: num(f.childCount),
        participantCount: num(f.participantCount), groupCount: num(f.groupCount) ?? 1,
      });
      setResult(res);
    } catch (e) { setResult({ ok: false, error: 'request_failed', message: e.message }); }
    finally { setBusy(false); }
  }

  const productOpts = [{ value: '', name: '—' }, ...products.map((p) => ({ value: p.id, name: p.nameHe }))];
  const variantOpts = [{ value: '', name: '—' }, ...variants.map((v) => ({ value: v.id, name: v.location?.nameHe || v.id }))];
  const activityOpts = [{ value: '', name: '— בחרו —' }, ...activityTypes.map((a) => ({ value: a.id, name: a.nameHe }))];
  const typeOpts = [{ value: '', name: '— (לא רלוונטי) —' }, ...orgTypes.map((t) => ({ value: t.id, name: t.label }))];
  const subtypeOpts = [{ value: '', name: '— (לא רלוונטי) —' }, ...orgSubtypes.map((s) => ({ value: s.id, name: s.label }))];

  return (
    <SettingsCard title="בדיקת תמחור (מחשבון)" description="כלי בדיקה למנוע התמחור בלבד. לא נשמר דבר ואין קשר לדילים.">
      <form onSubmit={run} className="p-2 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="מוצר"><Select value={f.productId} onChange={(v) => { set('productId', v); set('productVariantId', ''); }} options={productOpts} /></Field>
          <Field label="וריאציה"><Select value={f.productVariantId} onChange={(v) => set('productVariantId', v)} options={variantOpts} /></Field>
          <Field label="סוג פעילות *"><Select value={f.activityTypeId} onChange={(v) => set('activityTypeId', v)} options={activityOpts} /></Field>
          <Field label="סוג ארגון"><Select value={f.organizationTypeId} onChange={(v) => set('organizationTypeId', v)} options={typeOpts} /></Field>
          <Field label="תת-סוג ארגון"><Select value={f.organizationSubtypeId} onChange={(v) => set('organizationSubtypeId', v)} options={subtypeOpts} /></Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="מבוגרים"><input dir="ltr" value={f.adultCount} onChange={(e) => set('adultCount', e.target.value)} className={INPUT} /></Field>
          <Field label="ילדים"><input dir="ltr" value={f.childCount} onChange={(e) => set('childCount', e.target.value)} className={INPUT} /></Field>
          <Field label="משתתפים (מדורג)"><input dir="ltr" value={f.participantCount} onChange={(e) => set('participantCount', e.target.value)} className={INPUT} /></Field>
          <Field label="מספר קבוצות"><input dir="ltr" value={f.groupCount} onChange={(e) => set('groupCount', e.target.value)} className={INPUT} /></Field>
        </div>
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'מחשב…' : 'חשב מחיר'}</button>
      </form>

      {result && <CalcResult result={result} />}
    </SettingsCard>
  );
}

function CalcResult({ result }) {
  if (!result.ok) {
    return (
      <div className="mx-2 mb-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="font-medium">{ERROR_LABELS[result.error] || result.error}</div>
        {result.details && Object.keys(result.details).length > 0 && (
          <pre dir="ltr" className="mt-2 text-[11px] text-red-500 whitespace-pre-wrap">{JSON.stringify(result.details, null, 2)}</pre>
        )}
        {result.message && <div className="mt-1 text-[12px]">{result.message}</div>}
      </div>
    );
  }
  const cur = result.currency;
  return (
    <div className="mx-2 mb-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="נטו" value={formatMinor(result.netMinor, cur)} />
        <Stat label='מע״מ' value={formatMinor(result.vatMinor, cur)} />
        <Stat label="ברוטו" value={formatMinor(result.grossMinor, cur)} strong />
      </div>
      <div className="text-[12px] text-gray-600 leading-relaxed">
        מחירון: <b>{result.priceList?.nameHe}</b> ({sourceLabel(result.priceListSource)}) · מודל: <b>{result.priceModel === 'per_head' ? 'לראש' : 'מדורג'}</b> ·
        מע״מ: <b>{result.vatMode === 'included' ? 'כולל' : 'ללא'} {result.vatRate}%</b> · חוק תואם בעדיפות {result.rule?.priority} (ספציפיות {result.rule?.specificity})
      </div>
      <pre dir="ltr" className="text-[11px] text-gray-500 bg-white/70 rounded p-2 whitespace-pre-wrap">{JSON.stringify(result.debug, null, 2)}</pre>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`mt-0.5 ${strong ? 'text-lg font-bold text-gray-900' : 'text-[15px] text-gray-800'}`}>{value}</div>
    </div>
  );
}

function sourceLabel(s) {
  return { organization_subtype: 'תת-סוג ארגון', organization_type: 'סוג ארגון', system_default: 'ברירת מחדל' }[s] || s;
}
