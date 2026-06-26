import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';

// Contacts index — reference/management list. Names are bilingual (He + En);
// full names are derived by the server (fullNameHe / fullNameEn), never stored.
export default function ContactsList() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    firstNameHe: '',
    lastNameHe: '',
    firstNameEn: '',
    lastNameEn: '',
  });
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setContacts(await api.contacts.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const canCreate =
    form.firstNameHe.trim() &&
    form.lastNameHe.trim() &&
    form.firstNameEn.trim() &&
    form.lastNameEn.trim();

  async function createContact(e) {
    e.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    try {
      await api.contacts.create({
        firstNameHe: form.firstNameHe.trim(),
        lastNameHe: form.lastNameHe.trim(),
        firstNameEn: form.firstNameEn.trim(),
        lastNameEn: form.lastNameEn.trim(),
      });
      setForm({ firstNameHe: '', lastNameHe: '', firstNameEn: '', lastNameEn: '' });
      await refresh();
    } catch (e) {
      alert('שגיאה ביצירת איש קשר: ' + e.message);
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.fullNameHe, c.fullNameEn, c.phones?.[0]?.value, c.emails?.[0]?.value]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [contacts, search]);

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-gray-900">אנשי קשר</h1>
        <span className="text-[12px] text-gray-500">({contacts.length})</span>
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
        onSubmit={createContact}
        className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end mb-4 bg-white border border-gray-200 rounded-lg p-3"
      >
        <Field label="שם פרטי (עברית)" value={form.firstNameHe} onChange={(v) => set('firstNameHe', v)} />
        <Field label="שם משפחה (עברית)" value={form.lastNameHe} onChange={(v) => set('lastNameHe', v)} />
        <Field label="First name (EN)" value={form.firstNameEn} onChange={(v) => set('firstNameEn', v)} ltr />
        <Field label="Last name (EN)" value={form.lastNameEn} onChange={(v) => set('lastNameEn', v)} ltr />
        <div className="col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={creating || !canCreate}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {creating ? 'יוצר…' : 'הוסף איש קשר'}
          </button>
        </div>
      </form>

      {loading && <div className="p-6 text-center text-sm text-gray-500">טוען…</div>}
      {error && (
        <div className="p-4 text-center text-sm text-red-600">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="p-10 text-center text-sm text-gray-500">
          {contacts.length === 0 ? 'אין אנשי קשר עדיין.' : 'לא נמצאו תוצאות.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>שם (עברית)</Th>
                <Th>שם (אנגלית)</Th>
                <Th>טלפון ראשי</Th>
                <Th>אימייל ראשי</Th>
                <Th>ארגונים</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <Td>
                    <Link
                      to={`/admin/crm/contacts/${c.id}`}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      {c.fullNameHe}
                    </Link>
                  </Td>
                  <Td>
                    <span dir="ltr">{c.fullNameEn}</span>
                  </Td>
                  <Td>
                    <span dir="ltr">{c.phones?.[0]?.value || '—'}</span>
                  </Td>
                  <Td>
                    <span dir="ltr">{c.emails?.[0]?.value || '—'}</span>
                  </Td>
                  <Td>{c._count?.orgLinks ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, ltr }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? 'ltr' : 'rtl'}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
      />
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
