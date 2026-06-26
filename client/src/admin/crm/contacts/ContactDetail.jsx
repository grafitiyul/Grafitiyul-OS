import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';

// Contact detail — edit bilingual names, manage phones / emails / organization
// memberships, and see future communication sections as placeholders.
export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, o] = await Promise.all([
        api.contacts.get(id),
        api.organizations.list(),
      ]);
      setContact(c);
      setOrgs(o);
      setForm({
        firstNameHe: c.firstNameHe,
        lastNameHe: c.lastNameHe,
        firstNameEn: c.firstNameEn,
        lastNameEn: c.lastNameEn,
        notes: c.notes || '',
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    setSaving(true);
    try {
      await api.contacts.update(id, form);
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeContact() {
    if (!confirm('למחוק את איש הקשר?')) return;
    try {
      await api.contacts.remove(id);
      navigate('/admin/crm/contacts');
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!contact || !form) return null;

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-[13px]">
        <Link to="/admin/crm/contacts" className="text-blue-700 hover:underline">
          ← אנשי קשר
        </Link>
      </div>

      <Section title="פרטי איש קשר">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Input label="שם פרטי (עברית)" value={form.firstNameHe} onChange={(v) => set('firstNameHe', v)} />
          <Input label="שם משפחה (עברית)" value={form.lastNameHe} onChange={(v) => set('lastNameHe', v)} />
          <Input label="First name (EN)" value={form.firstNameEn} onChange={(v) => set('firstNameEn', v)} ltr />
          <Input label="Last name (EN)" value={form.lastNameEn} onChange={(v) => set('lastNameEn', v)} ltr />
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-gray-500">הערות</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button
            onClick={removeContact}
            className="text-sm text-red-700 border border-red-300 rounded-md px-4 py-1.5 hover:bg-red-50"
          >
            מחק
          </button>
        </div>
      </Section>

      <ChannelSection
        title="טלפונים"
        items={contact.phones}
        placeholder="מספר טלפון"
        ltr
        onAdd={(value) => api.contacts.addPhone(id, { value })}
        onSetPrimary={(itemId) => api.contacts.updatePhone(itemId, { isPrimary: true })}
        onRemove={(itemId) => api.contacts.removePhone(itemId)}
        onChange={refresh}
      />

      <ChannelSection
        title="כתובות אימייל"
        items={contact.emails}
        placeholder="אימייל"
        ltr
        onAdd={(value) => api.contacts.addEmail(id, { value })}
        onSetPrimary={(itemId) => api.contacts.updateEmail(itemId, { isPrimary: true })}
        onRemove={(itemId) => api.contacts.removeEmail(itemId)}
        onChange={refresh}
      />

      <MembershipsSection contact={contact} orgs={orgs} onChange={refresh} />

      {/* Future communication sections — placeholders until integrations land. */}
      <Section title="תקשורת ומסמכים (בקרוב)">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Placeholder title="היסטוריית WhatsApp" />
          <Placeholder title="היסטוריית Gmail" />
          <Placeholder title="קבצים" />
          <Placeholder title="הערות" />
          <Placeholder title="מסמכים" />
          <Placeholder title="שליחת WhatsApp / אימייל" />
        </div>
        <div className="text-[12px] text-gray-400 mt-2">
          ייפתח אחרי חיבור WhatsApp / Gmail והמודולים הרלוונטיים.
        </div>
      </Section>
    </div>
  );
}

function ChannelSection({ title, items, placeholder, ltr, onAdd, onSetPrimary, onRemove, onChange }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await onAdd(clean);
      setValue('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn) {
    try {
      await fn();
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Section title={title}>
      {items?.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {items.map((it) => (
            <li key={it.id} className="py-2 flex items-center gap-2 text-sm">
              <span dir={ltr ? 'ltr' : 'rtl'}>{it.value}</span>
              {it.isPrimary ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ראשי
                </span>
              ) : (
                <button
                  onClick={() => act(() => onSetPrimary(it.id))}
                  className="text-[11px] text-gray-500 hover:text-gray-800 underline"
                >
                  הפוך לראשי
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => act(() => onRemove(it.id))}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                מחק
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין עדיין.</div>
      )}
      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          dir={ltr ? 'ltr' : 'rtl'}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          הוסף
        </button>
      </form>
    </Section>
  );
}

function MembershipsSection({ contact, orgs, onChange }) {
  const [orgId, setOrgId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedOrg = orgs.find((o) => o.id === orgId);
  // The list endpoint doesn't include units; fetch on demand when an org is
  // chosen would be ideal, but to keep this simple we only offer units we
  // already know about. Units are optional anyway (link can be org-level).
  const [units, setUnits] = useState([]);

  async function chooseOrg(value) {
    setOrgId(value);
    setUnitId('');
    setUnits([]);
    if (value) {
      try {
        const full = await api.organizations.get(value);
        setUnits(full.units || []);
      } catch {
        setUnits([]);
      }
    }
  }

  async function add(e) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      await api.contacts.addOrganization(contact.id, {
        organizationId: orgId,
        organizationUnitId: unitId || null,
        role: role.trim() || null,
      });
      setOrgId('');
      setUnitId('');
      setRole('');
      setUnits([]);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId) {
    try {
      await api.contacts.removeOrganization(linkId);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Section title="שיוך לארגונים">
      <div className="text-[12px] text-gray-500 mb-2">
        איש קשר יכול להיות משויך למספר ארגונים, ואופציונלית ליחידה ספציפית.
      </div>
      {contact.orgLinks?.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {contact.orgLinks.map((l) => (
            <li key={l.id} className="py-2 flex items-center gap-2 text-sm">
              <Link
                to={`/admin/crm/organizations/${l.organization.id}`}
                className="text-blue-700 hover:underline"
              >
                {l.organization.name}
              </Link>
              {l.organizationUnit && (
                <span className="text-[12px] text-gray-500">· {l.organizationUnit.name}</span>
              )}
              {l.role && <span className="text-[12px] text-gray-400">· {l.role}</span>}
              <div className="flex-1" />
              <button
                onClick={() => remove(l.id)}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">לא משויך לארגון.</div>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">ארגון</label>
          <select
            value={orgId}
            onChange={(e) => chooseOrg(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-52"
          >
            <option value="">— בחר ארגון —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">יחידה (אופציונלי)</label>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!selectedOrg || units.length === 0}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-48 disabled:bg-gray-100"
          >
            <option value="">— ללא —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">תפקיד (אופציונלי)</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-40"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !orgId}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          שייך
        </button>
      </form>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Input({ label, value, onChange, ltr }) {
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
function Placeholder({ title }) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 text-center">
      <div className="text-[13px] font-semibold text-gray-500">{title}</div>
      <div className="text-[11px] text-gray-400 mt-1">בקרוב</div>
    </div>
  );
}
