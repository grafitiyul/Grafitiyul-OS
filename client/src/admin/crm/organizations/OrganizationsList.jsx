import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';

// Organizations index — reference/management list. Bank Leumi is one
// Organization; its divisions/departments are Organization Units (managed on
// the detail page), NOT separate organizations.
export default function OrganizationsList() {
  const [orgs, setOrgs] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [o, t] = await Promise.all([
        api.organizations.list(),
        api.organizationTypes.list(),
      ]);
      setOrgs(o);
      setTypes(t);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createOrg(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setCreating(true);
    try {
      await api.organizations.create({
        name: clean,
        organizationTypeId: typeId || null,
      });
      setName('');
      setTypeId('');
      await refresh();
    } catch (e) {
      alert('שגיאה ביצירת ארגון: ' + e.message);
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => (o.name || '').toLowerCase().includes(q));
  }, [orgs, search]);

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-gray-900">ארגונים</h1>
        <span className="text-[12px] text-gray-500">({orgs.length})</span>
        <div className="flex-1" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש…"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </div>

      <form
        onSubmit={createOrg}
        className="flex flex-wrap items-end gap-2 mb-4 bg-white border border-gray-200 rounded-lg p-3"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">שם ארגון</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: בנק לאומי"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">סוג ארגון</label>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-48 bg-white"
          >
            <option value="">— ללא —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          {creating ? 'יוצר…' : 'הוסף ארגון'}
        </button>
      </form>

      {loading && <div className="p-6 text-center text-sm text-gray-500">טוען…</div>}
      {error && (
        <div className="p-4 text-center text-sm text-red-600">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="p-10 text-center text-sm text-gray-500">
          {orgs.length === 0 ? 'אין ארגונים עדיין.' : 'לא נמצאו תוצאות.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>שם</Th>
                <Th>סוג</Th>
                <Th>יחידות</Th>
                <Th>אנשי קשר</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <Td>
                    <Link
                      to={`/admin/crm/organizations/${o.id}`}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      {o.name}
                    </Link>
                  </Td>
                  <Td>
                    {o.organizationType?.label || (
                      <span className="text-gray-400">—</span>
                    )}
                  </Td>
                  <Td>{o._count?.units ?? 0}</Td>
                  <Td>{o._count?.contactLinks ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="text-right text-[11px] uppercase tracking-wide font-semibold px-3 py-2">
      {children}
    </th>
  );
}
function Td({ children }) {
  return <td className="px-3 py-2">{children}</td>;
}
