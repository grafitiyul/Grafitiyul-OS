import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from './SettingsChrome.jsx';

// קטלוג סוכנים — the owner-configurable commercial catalogue for the travel-
// agent channel. One row per business-bookable canonical variant; the owner
// controls visibility, the commercial (agent-facing) name, the commercial
// city grouping, an optional description line and display order. Nothing here
// duplicates the catalogue — rows are presentation over canonical variants,
// and clearing/hiding a row simply removes the variant from the agent form.

const INPUT =
  'h-9 w-full rounded-lg border border-gray-300 px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function AgentCatalogSettings() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    api.channelListings
      .list('agent')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  async function save(row, draft) {
    setSavingId(row.variantId);
    try {
      const listing = await api.channelListings.save(row.variantId, {
        channel: 'agent',
        ...draft,
      });
      setRows((rs) => rs.map((r) => (r.variantId === row.variantId ? { ...r, listing } : r)));
      return true;
    } catch (e) {
      alert(
        e?.payload?.error === 'display_fields_required'
          ? 'כדי להציג לסוכנים חובה למלא שם תצוגה ועיר מסחרית.'
          : 'שגיאה בשמירה: ' + e.message,
      );
      return false;
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      <header className="mb-6">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">קטלוג סוכנים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          מה סוכני נסיעות רואים בטופס ההזמנות: אילו פעילויות זמינות, באיזה שם מסחרי,
          תחת איזו עיר ובאיזה סדר. הוריאציות נשארות מקור האמת — כאן נקבעת רק התצוגה
          לערוץ הסוכנים.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : !rows ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
          אין וריאציות פעילות הזמינות לעסקיים.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <ListingRow
              key={row.variantId}
              row={row}
              busy={savingId === row.variantId}
              onSave={(draft) => save(row, draft)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingRow({ row, busy, onSave }) {
  const l = row.listing;
  const [draft, setDraft] = useState({
    visible: l?.visible || false,
    displayName: l?.displayName || '',
    displayNameEn: l?.displayNameEn || '',
    description: l?.description || '',
    commercialCity: l?.commercialCity || '',
    commercialCityEn: l?.commercialCityEn || '',
    sortOrder: l?.sortOrder ?? 0,
  });
  const [dirty, setDirty] = useState(false);
  const set = (f, v) => {
    setDraft((d) => ({ ...d, [f]: v }));
    setDirty(true);
  };

  async function submit(e) {
    e.preventDefault();
    if (await onSave(draft)) setDirty(false);
  }

  return (
    <form
      onSubmit={submit}
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        draft.visible ? 'border-emerald-200' : 'border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.visible}
            onChange={(e) => set('visible', e.target.checked)}
          />
          <span className="text-[13px] font-semibold text-gray-900">מוצג לסוכנים</span>
        </label>
        <span className="text-[12px] text-gray-400">
          פנימי: {row.internalProduct} · {row.internalLocation}
        </span>
        <div className="flex-1" />
        {dirty && (
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="שם תצוגה לסוכן *">
          <input value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} className={INPUT} />
        </Field>
        <Field label="עיר מסחרית *">
          <input value={draft.commercialCity} onChange={(e) => set('commercialCity', e.target.value)} placeholder='לדוגמה: "תל אביב"' className={INPUT} />
        </Field>
        <Field label="Display name (EN)">
          <input value={draft.displayNameEn} onChange={(e) => set('displayNameEn', e.target.value)} dir="ltr" className={INPUT} />
        </Field>
        <Field label="City (EN)">
          <input value={draft.commercialCityEn} onChange={(e) => set('commercialCityEn', e.target.value)} dir="ltr" className={INPUT} />
        </Field>
        <Field label="שורת תיאור (אופציונלי)" className="sm:col-span-2 lg:col-span-3">
          <input value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder='לדוגמה: "גילאי 13 ומעלה"' className={INPUT} />
        </Field>
        <Field label="סדר תצוגה">
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', Number(e.target.value) || 0)}
            className={INPUT}
          />
        </Field>
      </div>
    </form>
  );
}

function Field({ label, className = '', children }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] text-gray-500">{label}</span>
      {children}
    </label>
  );
}
