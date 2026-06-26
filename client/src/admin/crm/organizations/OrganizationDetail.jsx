import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';

const FINANCE_FIELDS = [
  ['taxId', 'ח.פ / עוסק'],
  ['address', 'כתובת'],
  ['financeContactName', 'איש קשר כספים'],
  ['financePhone', 'טלפון כספים'],
  ['financeEmail', 'אימייל כספים'],
];

// Organization detail — edit the organization, manage its Units, and see the
// (future) business sections as placeholders until Deals are built.
export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

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
      setForm({
        name: o.name || '',
        organizationTypeId: o.organizationTypeId || '',
        notes: o.notes || '',
        taxId: o.taxId || '',
        address: o.address || '',
        financeContactName: o.financeContactName || '',
        financePhone: o.financePhone || '',
        financeEmail: o.financeEmail || '',
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

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-[13px]">
        <Link to="/admin/crm/organizations" className="text-blue-700 hover:underline">
          ← ארגונים
        </Link>
      </div>

      {/* Core fields */}
      <Section title="פרטי ארגון">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
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
        <div className="mt-4">
          <div className="text-[11px] text-gray-500 mb-2">
            פרטי כספים (אופציונלי). אם עסקה תקושר ליחידה — ערכי היחידה גוברים.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {FINANCE_FIELDS.map(([f, label]) => (
              <Input key={f} label={label} value={form[f]} onChange={(v) => set(f, v)} />
            ))}
          </div>
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
            onClick={removeOrg}
            className="text-sm text-red-700 border border-red-300 rounded-md px-4 py-1.5 hover:bg-red-50"
          >
            מחק ארגון
          </button>
        </div>
      </Section>

      <UnitsSection org={org} onChange={refresh} />

      {/* Linked contacts (read-only here; managed from the contact page) */}
      <Section title="אנשי קשר מקושרים">
        {org.contactLinks?.length ? (
          <ul className="divide-y divide-gray-100">
            {org.contactLinks.map((l) => (
              <li key={l.id} className="py-2 text-sm flex items-center gap-2">
                <Link
                  to={`/admin/crm/contacts/${l.contact.id}`}
                  className="text-blue-700 hover:underline"
                >
                  {`${l.contact.firstNameHe} ${l.contact.lastNameHe}`.trim()}
                </Link>
                {l.organizationUnit && (
                  <span className="text-[12px] text-gray-500">
                    · {l.organizationUnit.name}
                  </span>
                )}
                {l.role && (
                  <span className="text-[12px] text-gray-400">· {l.role}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-400">אין אנשי קשר מקושרים.</div>
        )}
      </Section>

      {/* Future business sections — placeholders until Deals exist. */}
      <Section title="עסקים ופעילות (בקרוב)">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Placeholder title="היסטוריית עסקאות" />
          <Placeholder title="עסקאות שנסגרו" />
          <Placeholder title="עסקאות שאבדו" />
          <Placeholder title="הכנסות" />
          <Placeholder title="פעילות אחרונה" />
        </div>
        <div className="text-[12px] text-gray-400 mt-2">
          ייפתח אחרי בניית מודול העסקאות (Deals).
        </div>
      </Section>
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
function Placeholder({ title }) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 text-center">
      <div className="text-[13px] font-semibold text-gray-500">{title}</div>
      <div className="text-[11px] text-gray-400 mt-1">בקרוב</div>
    </div>
  );
}
