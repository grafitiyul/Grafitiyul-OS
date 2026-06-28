import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import BackButton from '../../common/BackButton.jsx';
import ChannelSection from '../common/ChannelSection.jsx';
import PhoneDisplay from '../../common/PhoneDisplay.jsx';
import WorkspaceLayout from '../../../shell/WorkspaceLayout.jsx';
import TimelineFeed from '../../common/timeline/TimelineFeed.jsx';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

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
  const [original, setOriginal] = useState(null);
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
      const init = {
        firstNameHe: c.firstNameHe,
        lastNameHe: c.lastNameHe,
        firstNameEn: c.firstNameEn,
        lastNameEn: c.lastNameEn,
        notes: c.notes || '',
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Unsaved-work guard (auto-update): dirty when names/notes diverge from the
  // loaded values; clears on revert and after save (refresh resets the baseline).
  useDirtyWhen(form, original, { active: !!form && !!original });

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

  const fullName =
    `${contact.firstNameHe || ''} ${contact.lastNameHe || ''}`.trim() ||
    `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim() ||
    'איש קשר';
  const fullNameEn = `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim();

  // RIGHT panel — the contact's static identity & relationships.
  const detailsPanel = (
    <div className="space-y-4">
      <Section title="פרטי איש קשר">
        <div className="grid grid-cols-2 gap-3">
          <Input label="שם פרטי (עברית)" value={form.firstNameHe} onChange={(v) => set('firstNameHe', v)} />
          <Input label="שם משפחה (עברית)" value={form.lastNameHe} onChange={(v) => set('lastNameHe', v)} />
          <Input label="First name (EN)" value={form.firstNameEn} onChange={(v) => set('firstNameEn', v)} ltr />
          <Input label="Last name (EN)" value={form.lastNameEn} onChange={(v) => set('lastNameEn', v)} ltr />
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-gray-500">אודות</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="תיאור קבוע על איש הקשר (לא היסטוריה — היסטוריה נכתבת בציר הזמן)"
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button onClick={removeContact} className="text-sm text-red-700 border border-red-300 rounded-md px-4 py-1.5 hover:bg-red-50">
            מחק
          </button>
        </div>
      </Section>

      <ChannelSection
        title="טלפונים"
        items={contact.phones}
        placeholder="מספר טלפון (ישראלי או בינלאומי, לדוגמה +44…)"
        ltr
        formatValue={(v) => <PhoneDisplay value={v} />}
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

      <Section title="מטא-דאטה">
        <dl className="space-y-1 text-[13px]">
          <Row label="נוצר" value={fmtDate(contact.createdAt)} />
          <Row label="עודכן" value={fmtDate(contact.updatedAt)} />
        </dl>
      </Section>
    </div>
  );

  // CENTER = the reusable Timeline, aggregating this contact's items + items from
  // the deals they're on (read-only, source-badged). RIGHT = details panel.
  return (
    <WorkspaceLayout
      storageKey="gos.workspace.contact"
      right={{ title: 'פרטי איש קשר', content: detailsPanel, defaultWidth: 420, minWidth: 320, maxWidth: 640 }}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <BackButton to="/admin/crm/contacts" label="חזרה לאנשי קשר" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 lg:p-5">
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900">{fullName}</h1>
        {fullNameEn && fullNameEn !== fullName && (
          <div className="text-sm text-gray-500 mt-0.5" dir="ltr">{fullNameEn}</div>
        )}
      </div>
      <TimelineFeed subjectType="contact" subjectId={id} aggregate />
    </WorkspaceLayout>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 tabular-nums" dir="ltr">{value}</dd>
    </div>
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
