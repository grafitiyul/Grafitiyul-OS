import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import PhoneDisplay from '../../common/PhoneDisplay.jsx';
import { useTableColumns, ColumnPicker, SortableHeaderRow, TableCell } from '../../common/tableColumns.jsx';
import ContactCreateDialog from './ContactCreateDialog.jsx';

// Contacts — a real CRM list (like Deals): dominant search + a configurable
// table, with creation via the "+ איש קשר חדש" dialog. All columns are backed by
// data the list API already returns (primary phone/email, linked orgs, deal
// count, timestamps); the column visibility + picker are the SHARED table-columns
// infra used by Deals.

const dash = <span className="text-gray-400">—</span>;

function fullName(c) {
  return c.fullNameHe || c.fullNameEn || '';
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}
function OrgCell({ contact }) {
  const links = contact.orgLinks || [];
  if (!links.length) return dash;
  const primary = links.find((l) => l.isPrimary) || links[0];
  const extra = links.length - 1;
  return (
    <span>
      {primary?.organization?.name || '—'}
      {extra > 0 && <span className="ms-1 text-[11px] text-gray-400">+{extra}</span>}
    </span>
  );
}

// `def` = part of the safe default set. Render functions read only fields the
// list API returns.
const COLUMNS = [
  { key: 'name', label: 'שם', def: true,
    render: (c) => (
      <Link to={`/admin/crm/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">
        {fullName(c) || '—'}
      </Link>
    ) },
  { key: 'nameEn', label: 'שם (אנגלית)', def: false,
    render: (c) => (c.fullNameEn ? <span dir="ltr">{c.fullNameEn}</span> : dash), cls: 'text-gray-600' },
  { key: 'phone', label: 'טלפון', def: true,
    render: (c) => (c.phones?.[0]?.value ? <PhoneDisplay value={c.phones[0].value} /> : dash),
    cls: 'text-gray-700' },
  { key: 'email', label: 'אימייל', def: true,
    render: (c) => (c.emails?.[0]?.value ? <span dir="ltr">{c.emails[0].value}</span> : dash), cls: 'text-gray-600' },
  { key: 'organizations', label: 'ארגונים', def: true,
    render: (c) => <OrgCell contact={c} />, cls: 'text-gray-600' },
  { key: 'deals', label: 'דילים', def: true, align: 'center',
    cls: 'text-center tabular-nums text-gray-600', render: (c) => c._count?.dealContacts ?? 0 },
  { key: 'updatedAt', label: 'עודכן', def: true, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (c) => fmtDate(c.updatedAt) },
  { key: 'createdAt', label: 'נוצר', def: false, dir: 'ltr',
    cls: 'text-gray-500 tabular-nums', render: (c) => fmtDate(c.createdAt) },
];

export default function ContactsList() {
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { colKeys, toggleCol, moveCol, visibleCols, orderedColumns } =
    useTableColumns('contacts.columns.v1', COLUMNS);

  async function refresh() {
    setError(null);
    try {
      const [c, o, t, st] = await Promise.all([
        api.contacts.list(),
        api.organizations.list(),
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
      ]);
      setContacts(c);
      setOrgs(o);
      setTypes(t);
      setSubtypes(st);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  // Client-side search over name / phone / email / organization names.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [
        c.fullNameHe,
        c.fullNameEn,
        c.phones?.[0]?.value,
        c.emails?.[0]?.value,
        ...(c.orgLinks || []).map((l) => l.organization?.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [contacts, search]);

  return (
    <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-lg shadow-sm">
            👤
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900 leading-tight">אנשי קשר</h1>
            <p className="text-[12px] text-gray-500">ניהול אנשי הקשר של העסק ({contacts.length})</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          + איש קשר חדש
        </button>
      </div>

      {/* Filter bar — search dominant + column picker */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 mb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-[2] min-w-[260px]">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון, אימייל או ארגון…"
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
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-20 text-center max-w-sm mx-auto">
            <div className="text-5xl mb-4 opacity-70">👤</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">אין אנשי קשר עדיין</h3>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">הוסיפו את איש הקשר הראשון כדי להתחיל.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              + איש קשר חדש
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
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/40 transition-colors">
                    {visibleCols.map((col) => (
                      <TableCell key={col.key} col={col}>{col.render(c)}</TableCell>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <ContactCreateDialog
          orgs={orgs}
          types={types}
          subtypes={subtypes}
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => refresh()}
        />
      )}
    </div>
  );
}

