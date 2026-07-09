import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../../common/tableColumns.jsx';

// Organizations index — reference/management list. Bank Leumi is one
// Organization; its divisions/departments are Organization Units (managed on
// the detail page), NOT separate organizations.
//
// UI matches the Deals/Contacts standard: premium header, dominant search bar,
// and the SHARED table infrastructure (column chooser + drag-reorderable,
// persisted columns). Creation logic is unchanged — the same inline form,
// restyled to sit inside the filter card row.

const dash = <span className="text-gray-400">—</span>;

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

const COLUMNS = [
  { key: 'name', label: 'שם ארגון', def: true,
    render: (o) => (
      <span className="font-semibold text-gray-900 text-[15px] group-hover:text-blue-700">{o.name}</span>
    ) },
  { key: 'type', label: 'סוג', def: true, cls: 'text-gray-600',
    render: (o) => o.organizationType?.label || dash },
  { key: 'units', label: 'יחידות', def: true, align: 'center',
    cls: 'text-center tabular-nums text-gray-600', render: (o) => o._count?.units ?? 0 },
  { key: 'contacts', label: 'אנשי קשר', def: true, align: 'center',
    cls: 'text-center tabular-nums text-gray-600', render: (o) => o._count?.contactLinks ?? 0 },
  { key: 'updatedAt', label: 'עודכן', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (o) => fmtDate(o.updatedAt) },
  { key: 'createdAt', label: 'נוצר', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (o) => fmtDate(o.createdAt) },
];

export default function OrganizationsList() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const { colKeys, toggleCol, moveCol, visibleCols, orderedColumns } =
    useTableColumns('organizations.columns.v1', COLUMNS);

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
      setShowCreate(false);
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
    <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-lg shadow-sm">
            🏢
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 leading-tight">ארגונים</h1>
            <p className="text-[12px] text-gray-500">ניהול הארגונים והלקוחות העסקיים ({orgs.length})</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          + ארגון חדש
        </button>
      </div>

      {/* Create form — the same creation logic, shown on demand. */}
      {showCreate && (
        <form
          onSubmit={createOrg}
          className="flex flex-wrap items-end gap-2.5 mb-3 bg-white border border-gray-200 rounded-xl shadow-sm p-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">שם ארגון</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: בנק לאומי"
              className="h-10 w-64 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">סוג ארגון</label>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="h-10 w-48 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            >
              <option value="">— ללא —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'יוצר…' : 'הוסף ארגון'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50"
          >
            ביטול
          </button>
        </form>
      )}

      {/* Filter bar — search dominant + column picker */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-[2] min-w-[260px]">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם ארגון…"
              className="h-11 w-full rounded-lg border border-gray-300 bg-gray-50/60 pr-10 pl-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
          <div className="ms-auto">
            <ColumnPicker columns={orderedColumns} colKeys={colKeys} onToggle={toggleCol} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">טוען…</div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-600">
            שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : orgs.length === 0 ? (
          <div className="py-20 text-center max-w-sm mx-auto">
            <div className="text-5xl mb-4 opacity-70">🏢</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">אין ארגונים עדיין</h3>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">הוסיפו את הארגון הראשון כדי להתחיל.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              + ארגון חדש
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">לא נמצאו תוצאות.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <SortableHeaderRow
                  cols={visibleCols}
                  onMove={moveCol}
                  trClassName="text-gray-500 bg-gray-50/70 border-b border-gray-100"
                />
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className="group hover:bg-blue-50/40 cursor-pointer transition-colors"
                    onClick={() => navigate(`/admin/crm/organizations/${o.id}`)}
                  >
                    {visibleCols.map((c) => (
                      <TableCell key={c.key} col={c}>{c.render(o)}</TableCell>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
