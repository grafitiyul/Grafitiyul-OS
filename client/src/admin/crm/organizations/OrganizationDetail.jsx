import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BackButton from '../../common/BackButton.jsx';
import { api } from '../../../lib/api.js';
import WorkspaceLayout from '../../../shell/WorkspaceLayout.jsx';
import TimelineFeed from '../../common/timeline/TimelineFeed.jsx';
import OrgContactsSection from '../common/OrgContactsSection.jsx';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

const FINANCE_FIELDS = [
  ['taxId', 'ח.פ / עוסק'],
  ['address', 'כתובת'],
  ['financeContactName', 'איש קשר כספים'],
  ['financePhone', 'טלפון כספים'],
  ['financeEmail', 'אימייל כספים'],
];

// Organization detail — edit the organization, manage its Units, work with its
// linked Contacts (the daily-important part), and keep finance/billing data as a
// lower secondary section. Business sections (Deals) remain placeholders.
//
// Page hierarchy (top → bottom):
//   1. Organization main details
//   2. Units / departments
//   3. Linked contacts   ← most important for daily work
//   4. Finance details   ← secondary admin/billing data
//   5. Deals / activity placeholders
export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, t] = await Promise.all([
        api.organizations.get(id),
        api.organizationTypes.list(),
      ]);
      setOrg(o);
      setTypes(t);
      const init = {
        name: o.name || '',
        organizationTypeId: o.organizationTypeId || '',
        notes: o.notes || '',
        taxId: o.taxId || '',
        address: o.address || '',
        financeContactName: o.financeContactName || '',
        financePhone: o.financePhone || '',
        financeEmail: o.financeEmail || '',
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

  // Unsaved-work guard (auto-update): dirty when the org details diverge from the
  // loaded values; clears on revert and after save (refresh resets the baseline).
  useDirtyWhen(form, original, { active: !!form && !!original });

  async function save() {
    setSaving(true);
    try {
      await api.organizations.update(id, {
        ...form,
        organizationTypeId: form.organizationTypeId || null,
      });
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeOrg() {
    if (!confirm('למחוק את הארגון? יחידות וקישורי אנשי קשר יימחקו גם הם.')) return;
    try {
      await api.organizations.remove(id);
      navigate('/admin/crm');
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
  if (!org || !form) return null;

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  // RIGHT panel — the organization's static details, structure & relationships.
  const detailsPanel = (
    <div className="space-y-4">
      <Section title="פרטי ארגון">
        <div className="space-y-3">
          <Input label="שם ארגון" value={form.name} onChange={(v) => set('name', v)} />
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">סוג ארגון</label>
            <select
              value={form.organizationTypeId}
              onChange={(e) => set('organizationTypeId', e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
            >
              <option value="">— ללא —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-gray-500">אודות</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="תיאור קבוע על הארגון (לא היסטוריה — היסטוריה נכתבת בציר הזמן)"
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button onClick={removeOrg} className="text-sm text-red-700 border border-red-300 rounded-md px-4 py-1.5 hover:bg-red-50">
            מחק ארגון
          </button>
        </div>
      </Section>

      <UnitsSection org={org} onChange={refresh} />
      <Section title="אנשי קשר מקושרים">
        <div className="text-[12px] text-gray-500 mb-3">
          האנשים שעובדים מול הארגון. אפשר לחבר איש קשר קיים או ליצור חדש.
        </div>
        <OrgContactsSection org={org} onChange={refresh} />
      </Section>
      <FinanceSection form={form} set={set} onSave={save} saving={saving} />

      <Section title="מטא-דאטה">
        <dl className="space-y-1 text-[13px]">
          <Row label="נוצר" value={fmtDate(org.createdAt)} />
          <Row label="עודכן" value={fmtDate(org.updatedAt)} />
        </dl>
      </Section>
    </div>
  );

  // CENTER = the reusable Timeline, aggregating this org's items + items from its
  // deals AND its linked contacts (read-only, source-badged, filterable).
  return (
    <WorkspaceLayout
      storageKey="gos.workspace.organization"
      right={{ title: 'פרטי ארגון', content: detailsPanel, defaultWidth: 440, minWidth: 320, maxWidth: 680 }}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <BackButton to="/admin/crm/organizations" label="חזרה לארגונים" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 lg:p-5">
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900">{org.name}</h1>
        {org.organizationType?.label && (
          <div className="text-sm text-gray-500 mt-0.5">{org.organizationType.label}</div>
        )}
      </div>
      <TimelineFeed subjectType="organization" subjectId={id} aggregate />
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

function UnitsSection({ org, onChange }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function addUnit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await api.organizations.addUnit(org.id, { name: clean });
      setName('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUnit(unitId) {
    if (!confirm('למחוק יחידה?')) return;
    try {
      await api.organizations.removeUnit(unitId);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Section title="יחידות / מחלקות">
      <div className="text-[12px] text-gray-500 mb-2">
        חטיבות ומחלקות שייכות לארגון. ארגון יכול גם לא לכלול יחידות כלל.
      </div>
      {org.units?.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {org.units.map((u) => (
            <li key={u.id} className="py-2 flex items-center gap-2 text-sm">
              <span className="font-medium">{u.name}</span>
              {u.financeContactName && (
                <span className="text-[12px] text-gray-500">
                  · כספים: {u.financeContactName}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => removeUnit(u.id)}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                מחק
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין יחידות.</div>
      )}
      <form onSubmit={addUnit} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">שם יחידה</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: חטיבת שוק ההון"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-64"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          הוסף יחידה
        </button>
      </form>
    </Section>
  );
}

// Finance details — secondary admin/billing data. Visually muted and placed
// below the contacts so it doesn't compete with the main organization content.
function FinanceSection({ form, set, onSave, saving }) {
  return (
    <section className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <h2 className="text-[13px] font-semibold text-gray-600 mb-1">
        פרטי איש הכספים
      </h2>
      <div className="text-[12px] text-gray-400 mb-3">
        נתוני חיוב / הנהלת חשבונות (אופציונלי). אם עסקה תקושר ליחידה — ערכי היחידה גוברים.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FINANCE_FIELDS.map(([f, label]) => (
          <Input key={f} label={label} value={form[f]} onChange={(v) => set(f, v)} />
        ))}
      </div>
      <div className="mt-4">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-gray-700 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'שמור פרטי כספים'}
        </button>
      </div>
    </section>
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
function Input({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
      />
    </div>
  );
}
