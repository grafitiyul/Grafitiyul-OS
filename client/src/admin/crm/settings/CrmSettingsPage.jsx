import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

// CRM settings — Organization Types and Organization Subtypes catalogs.
//
// Type belongs to the Organization (School/Corporate/…) and will later drive
// pricing/templates/terms. Subtype belongs to the future DEAL (e.g. School →
// Teachers/Students); it is prepared here as a catalog with NO consumer until
// Deals are built.
export default function CrmSettingsPage() {
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, s] = await Promise.all([
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
      ]);
      setTypes(t);
      setSubtypes(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <TypesCard types={types} onChange={refresh} />
      <SubtypesCard subtypes={subtypes} types={types} onChange={refresh} />
    </div>
  );
}

function TypesCard({ types, onChange }) {
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationTypes.create({
        label: label.trim(),
        labelEn: labelEn.trim() || null,
      });
      setLabel('');
      setLabelEn('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('למחוק סוג ארגון? ארגונים מקושרים יישארו ללא סוג.')) return;
    try {
      await api.organizationTypes.remove(id);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-1">סוגי ארגון</h2>
      <p className="text-[12px] text-gray-500 mb-3">
        ישפיע בהמשך על תמחור, נוסח הצעות מחיר, תנאי תשלום ותבניות.
      </p>
      {types.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {types.map((t) => (
            <li key={t.id} className="py-2 flex items-center gap-2 text-sm">
              <span className="font-medium">{t.label}</span>
              {t.labelEn && <span className="text-[12px] text-gray-400" dir="ltr">{t.labelEn}</span>}
              <span className="text-[11px] text-gray-400" dir="ltr">{t.key}</span>
              <span className="text-[12px] text-gray-500">· {t._count?.organizations ?? 0} ארגונים</span>
              <div className="flex-1" />
              <button
                onClick={() => remove(t.id)}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                מחק
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין סוגי ארגון.</div>
      )}
      <form onSubmit={add} className="flex items-end gap-2">
        <Field label="שם (עברית)" value={label} onChange={setLabel} />
        <Field label="Label (EN)" value={labelEn} onChange={setLabelEn} ltr />
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          הוסף
        </button>
      </form>
    </section>
  );
}

function SubtypesCard({ subtypes, types, onChange }) {
  const [label, setLabel] = useState('');
  const [typeId, setTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationSubtypes.create({
        label: label.trim(),
        organizationTypeId: typeId || null,
      });
      setLabel('');
      setTypeId('');
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('למחוק תת-סוג?')) return;
    try {
      await api.organizationSubtypes.remove(id);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-1">תת-סוגים (לעסקאות)</h2>
      <p className="text-[12px] text-gray-500 mb-3">
        תת-סוג שייך לעסקה, לא לארגון (לדוגמה: בית ספר → מורים / תלמידים). מוכן
        כקטלוג — ייכנס לשימוש כשייבנה מודול העסקאות.
      </p>
      {subtypes.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {subtypes.map((s) => (
            <li key={s.id} className="py-2 flex items-center gap-2 text-sm">
              <span className="font-medium">{s.label}</span>
              {s.organizationType && (
                <span className="text-[12px] text-gray-500">· {s.organizationType.label}</span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => remove(s.id)}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                מחק
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין תת-סוגים.</div>
      )}
      <form onSubmit={add} className="flex items-end gap-2 flex-wrap">
        <Field label="שם תת-סוג" value={label} onChange={setLabel} />
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">שיוך לסוג ארגון (אופציונלי)</label>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-48"
          >
            <option value="">— כללי —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
        >
          הוסף
        </button>
      </form>
    </section>
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
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-44"
      />
    </div>
  );
}
