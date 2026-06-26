import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import BackButton from '../common/BackButton.jsx';

// Products catalog (Settings → CRM → Products). Each product has bilingual name
// + rich marketing descriptions and one or more variants (Product × Location).
export default function ProductsSettings() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameHe, setNameHe] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.products.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function add(e) {
    e.preventDefault();
    if (!nameHe.trim()) return;
    setBusy(true);
    try {
      const p = await api.products.create({ nameHe: nameHe.trim() });
      setNameHe('');
      navigate(`/admin/settings/crm/products/${p.id}`);
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">מוצרים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5">קטלוג המוצרים שאנחנו מוכרים. כל מוצר מתקיים בוריאציות לפי מיקום.</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-2 sm:p-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600">שגיאה: {error}</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-gray-400">עדיין אין מוצרים. הוסיפו את הראשון למטה.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-2.5 py-3 rounded-lg hover:bg-gray-50">
                  <Link to={`/admin/settings/crm/products/${p.id}`} className="font-medium text-[15px] text-blue-700 hover:underline">
                    {p.nameHe}
                  </Link>
                  {p.nameEn && <span className="text-[12px] text-gray-400" dir="ltr">{p.nameEn}</span>}
                  <span className="text-[11px] text-gray-500">· {p._count?.variants ?? 0} וריאציות</span>
                  {!p.active && <span className="text-[11px] text-gray-400">(לא פעיל)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 sm:px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
            <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם המוצר (עברית)"
              className="flex-1 h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
            <button type="submit" disabled={busy || !nameHe.trim()}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'יוצר…' : 'מוצר חדש'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
