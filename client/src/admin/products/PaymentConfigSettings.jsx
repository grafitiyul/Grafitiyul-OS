import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';

// Payment Configuration — Payment Terms and Payment Methods, each able to point
// at a default of the other type (auto-fills the Deal in Slice 3).
export default function PaymentConfigSettings() {
  const [terms, setTerms] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [t, m] = await Promise.all([api.payment.listTerms(), api.payment.listMethods()]);
      setTerms(t);
      setMethods(m);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">הגדרות תשלום</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">תנאי תשלום ואמצעי תשלום, וברירות מחדל ביניהם.</p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">שגיאה: {error}</div>
      ) : (
        <div className="space-y-8">
          <CatalogSection
            title="תנאי תשלום"
            description="לדוגמה: מיידי, לפני הפעילות, שוטף + 30. ניתן לקבוע אמצעי תשלום ברירת מחדל לכל תנאי."
            rows={terms}
            relationLabel="אמצעי ברירת מחדל"
            relationOptions={methods}
            relationKey="defaultPaymentMethodId"
            relationView={(r) => r.defaultPaymentMethod?.nameHe}
            onChange={refresh}
            api={{
              create: api.payment.createTerm,
              update: api.payment.updateTerm,
              remove: api.payment.removeTerm,
            }}
          />
          <CatalogSection
            title="אמצעי תשלום"
            description="לדוגמה: כרטיס אשראי, העברה בנקאית, צ'ק, מזומן, BIT, PayBox. ניתן לקבוע תנאי ברירת מחדל לכל אמצעי."
            rows={methods}
            relationLabel="תנאי ברירת מחדל"
            relationOptions={terms}
            relationKey="defaultPaymentTermId"
            relationView={(r) => r.defaultPaymentTerm?.nameHe}
            onChange={refresh}
            api={{
              create: api.payment.createMethod,
              update: api.payment.updateMethod,
              remove: api.payment.removeMethod,
            }}
          />
        </div>
      )}
    </div>
  );
}

function CatalogSection({ title, description, rows, relationLabel, relationOptions, relationKey, relationView, onChange, api: ops }) {
  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [rel, setRel] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await ops.create({ nameHe: nameHe.trim(), nameEn: nameEn.trim() || null, [relationKey]: rel || null });
      setNameHe(''); setNameEn(''); setRel('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-gray-100">
        <h2 className="text-[17px] font-semibold text-gray-900">{title}</h2>
        <p className="text-[13px] text-gray-500 mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="p-2 sm:p-3">
        {rows.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-gray-400">עדיין אין רשומות.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => (
              <CatalogRow
                key={row.id}
                row={row}
                relationLabel={relationLabel}
                relationOptions={relationOptions}
                relationKey={relationKey}
                relationView={relationView}
                onChange={onChange}
                ops={ops}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="px-4 sm:px-5 py-4 border-t border-gray-100 bg-gray-50/60">
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם בעברית"
            className="flex-1 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Name (EN)" dir="ltr"
            className="sm:w-40 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <select value={rel} onChange={(e) => setRel(e.target.value)}
            className="sm:w-44 h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="">{relationLabel} —</option>
            {relationOptions.map((o) => (<option key={o.id} value={o.id}>{o.nameHe}</option>))}
          </select>
          <button type="submit" disabled={busy || !nameHe.trim()}
            className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy ? '…' : 'הוסף'}
          </button>
        </form>
      </div>
    </section>
  );
}

function CatalogRow({ row, relationLabel, relationOptions, relationKey, relationView, onChange, ops }) {
  const [editing, setEditing] = useState(false);
  const [nameHe, setNameHe] = useState(row.nameHe);
  const [nameEn, setNameEn] = useState(row.nameEn || '');
  const [rel, setRel] = useState(row[relationKey] || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      await ops.update(row.id, { nameHe: nameHe.trim(), nameEn: nameEn.trim() || null, [relationKey]: rel || null });
      setEditing(false);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`למחוק את "${row.nameHe}"?`)) return;
    try { await ops.remove(row.id); await onChange(); }
    catch (e) { alert('שגיאה: ' + e.message); }
  }

  if (editing) {
    return (
      <li className="py-2">
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 px-1">
          <input autoFocus value={nameHe} onChange={(e) => setNameHe(e.target.value)} className="flex-1 min-w-[8rem] h-10 rounded-lg border border-gray-300 px-3 text-sm" />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" placeholder="Name (EN)" className="min-w-[6rem] sm:w-36 h-10 rounded-lg border border-gray-300 px-3 text-sm" />
          <select value={rel} onChange={(e) => setRel(e.target.value)} className="sm:w-44 h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm">
            <option value="">{relationLabel} —</option>
            {relationOptions.map((o) => (<option key={o.id} value={o.id}>{o.nameHe}</option>))}
          </select>
          <div className="flex gap-1.5 shrink-0 ms-auto">
            <button type="submit" disabled={busy || !nameHe.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'שומר…' : 'שמור'}</button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
          </div>
        </form>
      </li>
    );
  }

  const relName = relationView(row);
  return (
    <li className="group flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-gray-50">
      <span className="font-medium text-gray-900 text-[15px]">{row.nameHe}</span>
      {row.nameEn && <span className="text-[12px] text-gray-400" dir="ltr">{row.nameEn}</span>}
      {relName && (
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-100">
          {relationLabel}: {relName}
        </span>
      )}
      <div className="flex-1" />
      <button onClick={() => setEditing(true)} className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5" title="עריכה">✎</button>
      <button onClick={remove} className="text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5" title="מחק">🗑</button>
    </li>
  );
}
