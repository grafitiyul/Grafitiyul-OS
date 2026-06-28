import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { contactNamesFromParts } from '../../../lib/nameSplit.js';

// Manage an organization's linked contacts (the ContactOrganization membership).
// ONE source of truth, reused by the full Organization page AND the Deal →
// Organization edit dialog — so linking/creating a contact never duplicates
// logic. Renders content only; the caller supplies the surrounding card /
// collapsible. `org` must include contactLinks (+ units); onChange() reloads it.
const IN = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';

function contactName(c) {
  return (
    `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim() ||
    `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() ||
    'איש קשר'
  );
}

export default function OrgContactsSection({ org, onChange }) {
  const [mode, setMode] = useState(null); // null | 'existing' | 'new'

  async function unlink(linkId) {
    if (!confirm('להסיר את הקישור לאיש הקשר? איש הקשר עצמו לא יימחק.')) return;
    try {
      await api.contacts.removeOrganization(linkId);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }
  async function afterChange() {
    setMode(null);
    await onChange();
  }

  return (
    <div className="space-y-3">
      {org.contactLinks?.length ? (
        <ul className="divide-y divide-gray-100">
          {org.contactLinks.map((l) => (
            <li key={l.id} className="py-2 text-sm flex items-center gap-2">
              <Link to={`/admin/crm/contacts/${l.contact.id}`} className="text-blue-700 hover:underline font-medium">
                {contactName(l.contact)}
              </Link>
              {l.isPrimary && (
                <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">ראשי</span>
              )}
              {l.organizationUnit && <span className="text-[12px] text-gray-500">· {l.organizationUnit.name}</span>}
              {l.role && <span className="text-[12px] text-gray-400">· {l.role}</span>}
              <div className="flex-1" />
              <button onClick={() => unlink(l.id)} className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1">הסר</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400">אין אנשי קשר מקושרים.</div>
      )}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMode('existing')} className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5">
            חבר איש קשר קיים
          </button>
          <button onClick={() => setMode('new')} className="text-sm text-gray-700 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            צור איש קשר חדש
          </button>
        </div>
      )}
      {mode === 'existing' && <ConnectExisting org={org} onCancel={() => setMode(null)} onDone={afterChange} />}
      {mode === 'new' && <CreateAndLink org={org} onCancel={() => setMode(null)} onDone={afterChange} />}
    </div>
  );
}

// Pick an existing contact (search) + optional unit/role/primary → create the link.
function ConnectExisting({ org, onCancel, onDone }) {
  const [contacts, setContacts] = useState(null);
  const [search, setSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [role, setRole] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.contacts.list().then((c) => { if (live) setContacts(c); }).catch(() => { if (live) setContacts([]); });
    return () => { live = false; };
  }, []);

  const linkedIds = new Set((org.contactLinks || []).map((l) => l.contact.id));
  const q = search.trim().toLowerCase();
  const available = (contacts || []).filter((c) => !linkedIds.has(c.id));
  const filtered = q
    ? available.filter((c) => (c.fullNameHe || '').toLowerCase().includes(q) || (c.fullNameEn || '').toLowerCase().includes(q))
    : available;

  async function submit(e) {
    e.preventDefault();
    if (!contactId) return;
    setBusy(true);
    try {
      await api.contacts.addOrganization(contactId, {
        organizationId: org.id,
        organizationUnitId: unitId || null,
        role: role.trim() || null,
        isPrimary,
      });
      await onDone();
    } catch (e) {
      if (e.status === 409) alert('איש הקשר כבר מקושר לארגון זה.');
      else alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-gray-200 rounded-md p-3 bg-gray-50 space-y-3">
      <div className="text-[12px] font-semibold text-gray-700">חיבור איש קשר קיים</div>
      {contacts === null ? (
        <div className="text-sm text-gray-500">טוען אנשי קשר…</div>
      ) : (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש שם…" className={IN} />
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            size={Math.min(6, Math.max(2, filtered.length + 1))}
            className={`${IN} bg-white`}
          >
            {filtered.length === 0 && <option value="" disabled>— אין אנשי קשר זמינים —</option>}
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>{c.fullNameHe || c.fullNameEn || c.id}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!org.units?.length} className={`${IN} bg-white disabled:bg-gray-100`}>
              <option value="">— יחידה (אופציונלי) —</option>
              {(org.units || []).map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
            </select>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="תפקיד (אופציונלי)" className={IN} />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            איש קשר ראשי
          </label>
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !contactId} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
          {busy ? 'מחבר…' : 'חבר'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-100">ביטול</button>
      </div>
    </form>
  );
}

// Create a brand-new contact (first name in EITHER language + phone) and link it.
// Reuses the shared name-split helper and the existing contact APIs.
function CreateAndLink({ org, onCancel, onDone }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [unitId, setUnitId] = useState('');
  const [role, setRole] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = first.trim() && phone.trim();

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const contact = await api.contacts.create(contactNamesFromParts(first, last));
      await api.contacts.addPhone(contact.id, { value: phone.trim(), isPrimary: true });
      if (email.trim()) await api.contacts.addEmail(contact.id, { value: email.trim(), isPrimary: true });
      await api.contacts.addOrganization(contact.id, {
        organizationId: org.id,
        organizationUnitId: unitId || null,
        role: role.trim() || null,
        isPrimary,
      });
      await onDone();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-gray-200 rounded-md p-3 bg-gray-50 space-y-3">
      <div className="text-[12px] font-semibold text-gray-700">איש קשר חדש</div>
      <div className="grid grid-cols-2 gap-2">
        <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="שם פרטי *" className={IN} />
        <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="שם משפחה" className={IN} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="טלפון *" dir="ltr" className={IN} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="אימייל" dir="ltr" className={IN} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!org.units?.length} className={`${IN} bg-white disabled:bg-gray-100`}>
          <option value="">— יחידה (אופציונלי) —</option>
          {(org.units || []).map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
        </select>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="תפקיד (אופציונלי)" className={IN} />
      </div>
      <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        איש קשר ראשי
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !ready} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
          {busy ? 'יוצר…' : 'צור וחבר'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-100">ביטול</button>
      </div>
    </form>
  );
}
