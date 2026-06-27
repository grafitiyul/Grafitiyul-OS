import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import BackButton from '../common/BackButton.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { SettingsCard } from '../crm/settings/catalogKit.jsx';
import { formatMinor, toMinor, minorToInput } from '../../lib/money.js';

// Add-ons settings (Slice 2): sellable extras that are NOT products. Manage the
// catalog (default price + VAT behaviour) and per-price-list overrides. NOT
// wired to Deals.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

function Field({ label, children }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}</label>;
}
function Select({ value, onChange, options, className = '' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${className}`}>
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.name}</option>)}
    </select>
  );
}
function Money({ minor, onChange, placeholder }) {
  return (
    <input dir="ltr" inputMode="decimal" value={minorToInput(minor)}
      onChange={(e) => onChange(toMinor(e.target.value))} placeholder={placeholder || '0'}
      className={`${INPUT} text-left`} />
  );
}
// Wording matches the Pricing Cards VAT labels. Values are the engine vatMode
// strings (DB-stored) — unchanged. 'exempt' (פטור) is fully supported by the
// engine's splitVat, so the rate is ignored / forced to 0 for it.
const VAT_MODE_OPTS = [
  { value: 'included', name: 'כולל מע״מ' },
  { value: 'excluded', name: 'לפני מע״מ' },
  { value: 'exempt', name: 'פטור ממע״מ' },
];
const vatLabel = (m, rate) =>
  m === 'exempt' ? 'פטור ממע״מ' : m === 'excluded' ? `לפני מע״מ ${rate}%` : `כולל מע״מ ${rate}%`;

export default function AddonsSettings() {
  const [addons, setAddons] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [a, l] = await Promise.all([api.addons.list(), api.priceLists.list()]);
      setAddons(a);
      setLists(l);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try { await api.addons.create({ nameHe: nameHe.trim() }); setNameHe(''); await refresh(); }
    catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }
  async function reorder(ids) { try { await api.addons.reorder(ids); } catch { /* visual */ } }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-6">
        <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">תוספות</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">
          תוספות הן פריטים נמכרים שאינם מוצרים (הסעה, ביטוח, חומרים…). לכל תוספת מחיר ברירת מחדל ואפשר להוסיף עקיפות לפי מחירון.
        </p>
      </header>

      {error && <div className="text-sm text-red-600 mb-3">שגיאה: {error}</div>}

      <SettingsCard
        title="קטלוג תוספות"
        footer={
          <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
            <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם תוספת חדשה" className={`flex-1 ${INPUT}`} />
            <button type="submit" disabled={busy || !nameHe.trim()}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'מוסיף…' : 'הוסף תוספת'}
            </button>
          </form>
        }
      >
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">טוען…</div>
        ) : (
          <ReorderableList
            items={addons}
            onReorder={reorder}
            emptyText="עדיין אין תוספות. הוסיפו את הראשונה למטה."
            renderRow={(addon, { handle }) => (
              <div className="rounded-lg hover:bg-gray-50">
                {editingId === addon.id ? (
                  <AddonEdit addon={addon} onClose={() => setEditingId(null)} onChanged={refresh} />
                ) : (
                  <div className="flex items-center gap-3 px-2.5 py-2.5">
                    {handle}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 text-[15px]">{addon.nameHe}</span>
                      {addon.nameEn && <span className="text-[12px] text-gray-400 ms-2" dir="ltr">{addon.nameEn}</span>}
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {formatMinor(addon.defaultPriceMinor, addon.currency)} · {vatLabel(addon.vatMode, addon.vatRate)} · כמות ברירת מחדל {addon.defaultQuantity}
                        {addon.priceRules?.length ? ` · ${addon.priceRules.length} עקיפות` : ''}
                      </div>
                    </div>
                    {!addon.active && <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">לא פעיל</span>}
                    <button onClick={() => setExpandedId(expandedId === addon.id ? null : addon.id)}
                      className="text-blue-600 hover:bg-blue-50 rounded-md px-2 py-1 text-[12px] font-medium">
                      {expandedId === addon.id ? 'סגור' : 'עקיפות מחיר'}
                    </button>
                    <button onClick={() => setEditingId(addon.id)} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
                    <button onClick={async () => { if (confirm(`למחוק את "${addon.nameHe}"?`)) { await api.addons.remove(addon.id); refresh(); } }}
                      title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
                  </div>
                )}
                {expandedId === addon.id && editingId !== addon.id && (
                  <OverridesPanel addon={addon} lists={lists} onChanged={refresh} />
                )}
              </div>
            )}
          />
        )}
      </SettingsCard>
    </div>
  );
}

function AddonEdit({ addon, onClose, onChanged }) {
  const [d, setD] = useState({
    nameHe: addon.nameHe, nameEn: addon.nameEn || '',
    defaultPriceMinor: addon.defaultPriceMinor ?? 0, currency: addon.currency,
    vatMode: addon.vatMode, vatRate: String(addon.vatRate),
    defaultQuantity: String(addon.defaultQuantity), active: addon.active,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addons.update(addon.id, {
        nameHe: d.nameHe.trim(), nameEn: d.nameEn.trim() || null,
        defaultPriceMinor: d.defaultPriceMinor ?? 0, currency: d.currency || 'ILS',
        vatMode: d.vatMode, vatRate: d.vatMode === 'exempt' ? 0 : (Number(d.vatRate) || 0),
        defaultQuantity: Number(d.defaultQuantity) || 1, active: d.active,
      });
      onClose(); await onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="bg-blue-50/50 ring-1 ring-blue-100 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Field label="שם (עברית)"><input value={d.nameHe} onChange={(e) => set('nameHe', e.target.value)} className={INPUT} /></Field>
      <Field label="Name (EN)"><input value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={INPUT} /></Field>
      <Field label="מחיר ברירת מחדל"><Money minor={d.defaultPriceMinor} onChange={(v) => set('defaultPriceMinor', v ?? 0)} /></Field>
      <Field label="מטבע"><input value={d.currency} onChange={(e) => set('currency', e.target.value)} dir="ltr" className={INPUT} /></Field>
      <Field label="מע״מ"><Select value={d.vatMode} onChange={(v) => set('vatMode', v)} options={VAT_MODE_OPTS} /></Field>
      {d.vatMode !== 'exempt' && (
        <Field label='שיעור מע״מ %'><input value={d.vatRate} onChange={(e) => set('vatRate', e.target.value)} dir="ltr" className={INPUT} /></Field>
      )}
      <Field label="כמות ברירת מחדל"><input value={d.defaultQuantity} onChange={(e) => set('defaultQuantity', e.target.value)} dir="ltr" className={INPUT} /></Field>
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

// Per-price-list price/VAT overrides for one add-on.
function OverridesPanel({ addon, lists, onChanged }) {
  const [rules, setRules] = useState(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setRules(await api.addonPriceRules.list(addon.id));
  }, [addon.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const listName = (id) => lists.find((l) => l.id === id)?.nameHe || (id ? '—' : 'כל המחירונים (גלובלי)');
  const listOpts = [{ value: '', name: 'כל המחירונים (גלובלי)' }, ...lists.map((l) => ({ value: l.id, name: l.nameHe }))];

  return (
    <div className="mx-2.5 mb-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-gray-700">עקיפות מחיר לפי מחירון</span>
        {!adding && <button onClick={() => setAdding(true)} className="text-blue-600 hover:bg-blue-100 rounded-md px-2 py-1 text-[12px] font-medium">+ עקיפה</button>}
      </div>

      {adding && (
        <OverrideForm addon={addon} listOpts={listOpts}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); onChanged(); }} />
      )}

      {rules === null ? (
        <div className="text-[12px] text-gray-400 py-2">טוען…</div>
      ) : rules.length === 0 && !adding ? (
        <div className="text-[12px] text-gray-400 py-2">אין עקיפות. התוספת תשתמש במחיר ברירת המחדל.</div>
      ) : (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 bg-white rounded-md px-2.5 py-2 text-sm">
              <span className="flex-1 text-gray-800">{listName(r.priceListId)}</span>
              <span className="text-gray-900">{formatMinor(r.priceMinor, r.currency)}</span>
              <span className="text-[11px] text-gray-500">{vatLabel(r.vatMode, r.vatRate)}</span>
              <button onClick={async () => { if (confirm('למחוק עקיפה זו?')) { await api.addonPriceRules.remove(r.id); refresh(); onChanged(); } }}
                title="מחק" className="text-red-500 hover:bg-red-50 rounded-md p-1">🗑</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OverrideForm({ addon, listOpts, onClose, onSaved }) {
  const [d, setD] = useState({
    priceListId: '', priceMinor: addon.defaultPriceMinor ?? 0,
    currency: addon.currency, vatMode: addon.vatMode, vatRate: String(addon.vatRate),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addonPriceRules.create({
        addonId: addon.id, priceListId: d.priceListId || null,
        priceMinor: d.priceMinor ?? 0, currency: d.currency || 'ILS',
        vatMode: d.vatMode, vatRate: d.vatMode === 'exempt' ? 0 : (Number(d.vatRate) || 0),
      });
      onSaved();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="bg-white ring-1 ring-blue-100 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
      <Field label="מחירון"><Select value={d.priceListId} onChange={(v) => set('priceListId', v)} options={listOpts} /></Field>
      <Field label="מחיר"><Money minor={d.priceMinor} onChange={(v) => set('priceMinor', v ?? 0)} /></Field>
      <Field label="מע״מ"><Select value={d.vatMode} onChange={(v) => set('vatMode', v)} options={VAT_MODE_OPTS} /></Field>
      {d.vatMode !== 'exempt' && (
        <Field label='שיעור %'><input value={d.vatRate} onChange={(e) => set('vatRate', e.target.value)} dir="ltr" className={INPUT} /></Field>
      )}
      <div className="col-span-2 sm:col-span-4 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'הוסף עקיפה'}</button>
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </form>
  );
}
