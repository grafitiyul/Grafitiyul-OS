import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';

// Which canonical facts appear above a coordination form's questions.
//
// The operator picks FROM A CATALOG — there is no free-text field, no token to
// type and no query to write. That is the whole safety model: every option here
// came from the server's allowlist, and the server re-checks it on save, so the
// worst a mistake can do is show or hide a field.
//
// What they control: which fields, in what order, under what label (per
// language). What they cannot control: what any field says. The values are read
// from the Deal, Booking and Tour at render time and are never editable here.

const DRAG_KEY = 'application/x-gos-context-field';

export default function ContextFieldsCard({ purpose = 'coordination' }) {
  const [catalog, setCatalog] = useState([]);
  const [fields, setFields] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [dragKey, setDragKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.questionnaires.contextFields.get(purpose);
      setCatalog(data.catalog || []);
      setFields(data.fields || []);
      setConfigured(!!data.configured);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [purpose]);

  useEffect(() => { load(); }, [load]);

  const byKey = useMemo(
    () => Object.fromEntries(catalog.map((c) => [c.key, c])),
    [catalog],
  );

  const mutate = (next) => { setFields(next); setDirty(true); };

  const toggle = (key) =>
    mutate(fields.map((f) => (f.key === key ? { ...f, enabled: f.enabled === false } : f)));

  const relabel = (key, lang, value) =>
    mutate(fields.map((f) => (f.key === key ? { ...f, [lang === 'en' ? 'labelEn' : 'labelHe']: value } : f)));

  const move = (from, to) => {
    if (from === to || to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    mutate(next);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.questionnaires.contextFields.save(purpose, fields);
      setConfigured(true);
      setDirty(false);
    } catch (e) {
      setError(e.payload?.error === 'unknown_context_field'
        ? `שדה לא מוכר: ${e.payload.key}`
        : e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-5 text-[13.5px] text-gray-400">טוען…</div>;
  }

  const enabled = fields.filter((f) => f.enabled !== false);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-gray-900">פרטי הסיור שהמדריך רואה</h3>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-gray-500">
            הפרטים שמוצגים למדריך מעל שאלות שיחת התיאום. הנתונים נקראים מהדיל, מההזמנה
            ומהסיור בזמן הצפייה — כאן בוחרים אילו שדות יופיעו, באיזה סדר ובאיזו כותרת.
            {!configured && <span className="text-gray-400"> כרגע מוצגת ברירת המחדל.</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={load}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100"
            >
              ביטול
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      </div>

      {error && <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-[12.5px] text-red-700">{error}</p>}

      <ul className="divide-y divide-gray-100">
        {fields.map((f, i) => {
          const def = byKey[f.key];
          if (!def) return null; // catalog shrank — the server drops it too
          const on = f.enabled !== false;
          return (
            <li
              key={f.key}
              draggable
              onDragStart={(e) => { setDragKey(f.key); e.dataTransfer.setData(DRAG_KEY, f.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => {
                e.preventDefault();
                const from = fields.findIndex((x) => x.key === (e.dataTransfer.getData(DRAG_KEY) || dragKey));
                if (from >= 0) move(from, i);
                setDragKey(null);
              }}
              className={`flex flex-wrap items-center gap-3 px-5 py-3 ${dragKey === f.key ? 'opacity-50' : ''} ${on ? '' : 'bg-gray-50/60'}`}
            >
              <span className="cursor-grab select-none text-[15px] leading-none text-gray-300" aria-hidden>⠿</span>

              <label className="flex shrink-0 items-center gap-2">
                <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="h-4 w-4 accent-gray-900" />
                <span className={`text-[13.5px] font-medium ${on ? 'text-gray-900' : 'text-gray-400'}`}>
                  {def.labelHe}
                </span>
              </label>

              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <input
                  value={f.labelHe ?? def.labelHe}
                  onChange={(e) => relabel(f.key, 'he', e.target.value)}
                  disabled={!on}
                  placeholder={def.labelHe}
                  aria-label={`כותרת בעברית — ${def.labelHe}`}
                  className="w-40 rounded-lg border border-gray-200 px-2.5 py-1 text-[13px] disabled:bg-gray-50 disabled:text-gray-400"
                />
                <input
                  value={f.labelEn ?? def.labelEn}
                  onChange={(e) => relabel(f.key, 'en', e.target.value)}
                  disabled={!on}
                  dir="ltr"
                  placeholder={def.labelEn}
                  aria-label={`English label — ${def.labelEn}`}
                  className="w-40 rounded-lg border border-gray-200 px-2.5 py-1 text-[13px] disabled:bg-gray-50 disabled:text-gray-400"
                />
                {/* Keyboard equivalent of the drag handle — reordering must not
                    require a mouse. */}
                <span className="flex items-center">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                    aria-label="הזז למעלה"
                    className="rounded px-1.5 py-1 text-[12px] text-gray-400 hover:bg-gray-100 disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === fields.length - 1}
                    aria-label="הזז למטה"
                    className="rounded px-1.5 py-1 text-[12px] text-gray-400 hover:bg-gray-100 disabled:opacity-30">▼</button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* The preview shows STRUCTURE, not values: real values belong to a real
          booking, and inventing a plausible customer here would be the one thing
          this whole design refuses to do. */}
      <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
        <p className="mb-2 text-[12px] font-medium text-gray-500">
          כך ייראה הבלוק ({enabled.length} שדות). הערכים ממולאים מהסיור עצמו.
        </p>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <dl className="divide-y divide-gray-100">
            {enabled.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-gray-400">לא נבחרו שדות — המדריך יראה רק את השאלות.</p>
            ) : enabled.map((f) => (
              <div key={f.key} className="flex gap-4 px-4 py-2">
                <dt className="w-40 shrink-0 text-[12.5px] font-medium text-gray-500">
                  {f.labelHe ?? byKey[f.key]?.labelHe}
                </dt>
                <dd className="text-[13.5px] text-gray-300">— מהנתונים —</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
