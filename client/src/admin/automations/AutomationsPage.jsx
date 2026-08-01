import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import { STATUS_TONE, StatusBadge, fmtWhen } from './parts.jsx';

// Automation Registry — the operational control center.
//
// This is NOT a catalog. The first question it must answer is "is anything
// wrong right now?", so broken and erroring automations sort to the top and
// carry their reason inline; a "בעיות בלבד" filter narrows to exactly what
// needs attention.
//
// Everything here is READ-ONLY by design: the definitions live in code, and the
// registry is generated from the same modules the runtime executes. Making a
// field editable here would create the second source of truth this whole module
// exists to prevent.

const FILTERS = [
  { key: 'all', labelHe: 'הכל' },
  { key: 'problems', labelHe: 'בעיות בלבד' },
  { key: 'active', labelHe: 'פעילות' },
  { key: 'disabled', labelHe: 'מושבתות' },
];

// Problems first — the screen's job is to surface them without a click.
const SORT_RANK = { broken: 0, error: 1, waiting_dependency: 2, disabled: 3, active: 4, retired: 5 };

export default function AutomationsPage() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.automations.list();
      setRows(r.automations || []);
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const list = (rows || []).filter((r) => {
      if (filter === 'problems') return r.status === 'broken' || r.status === 'error';
      if (filter === 'active') return r.status === 'active';
      if (filter === 'disabled') return r.status === 'disabled';
      return true;
    }).filter((r) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return `${r.id} ${r.nameHe} ${r.questionnaireKey || ''}`.toLowerCase().includes(needle);
    });
    return list.sort((a, b) => (SORT_RANK[a.status] ?? 9) - (SORT_RANK[b.status] ?? 9) || a.id.localeCompare(b.id));
  }, [rows, filter, q]);

  const problems = (rows || []).filter((r) => r.status === 'broken' || r.status === 'error').length;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10" dir="rtl">
      <SettingsChrome />
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">אוטומציות</h1>
      </header>
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-gray-600">
          אוטומציות מוגדרות בקוד ומוצגות כאן לקריאה בלבד. כל אוטומציה מפעילה כלל
          קיים ב<Link to="/admin/settings/communication" className="text-blue-600 hover:underline">מרכז התקשורת</Link>,
          שנשאר האחראי הבלעדי על תוכן ההודעות היוצאות.
        </p>

        {/* Honest scope note: this registry does NOT cover every automated
            behaviour in GOS — existing subsystems keep owning their own. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          המרשם מציג אוטומציות שאלונים בלבד. התנהגויות אוטומטיות אחרות במערכת
          (דיווחי מנהלים, בקרה, סנכרונים ותהליכי רקע) מנוהלות במודולים שלהן.
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition ${
                filter === f.key
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {f.labelHe}
              {f.key === 'problems' && problems > 0 ? (
                <span className="ms-1.5 rounded-full bg-red-100 px-1.5 text-[11px] font-medium text-red-700">{problems}</span>
              ) : null}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש לפי מזהה, שם או שאלון"
            className="ms-auto w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px]"
          />
        </div>

        {rows === null ? (
          <div className="py-10 text-center text-[13px] text-gray-400">טוען…</div>
        ) : visible.length === 0 ? (
          <EmptyState hasAny={(rows || []).length > 0} filter={filter} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="bg-gray-50 text-[12px] text-gray-500">
                <tr>
                  <Th>מזהה</Th><Th>שם</Th><Th>סטטוס</Th><Th>מקור הפעלה</Th>
                  <Th>כללי תקשורת</Th><Th>הפעלה אחרונה</Th><Th>הרצות</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <Td>
                      <Link to={`/admin/settings/automations/${r.id}`} className="font-mono text-[12px] text-blue-600 hover:underline" dir="ltr">
                        {r.id}
                      </Link>
                    </Td>
                    <Td>
                      <Link to={`/admin/settings/automations/${r.id}`} className="font-medium text-gray-900 hover:underline">
                        {r.nameHe}
                      </Link>
                      {r.categoryHe ? <div className="text-[11.5px] text-gray-400">{r.categoryHe}</div> : null}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} label={r.statusHe} />
                      {/* The reason is inline so the list answers "what's wrong"
                          without a click. */}
                      {r.reasonHe ? (
                        <div className={`mt-0.5 max-w-[280px] text-[11.5px] ${
                          STATUS_TONE[r.status]?.muted || 'text-gray-500'
                        }`}>
                          {r.reasonHe}
                        </div>
                      ) : null}
                      {r.secondary?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.secondary.map((s) => (
                            <StatusBadge key={s.status} status={s.status} label={s.statusHe} small />
                          ))}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-[12px] text-gray-600">{r.triggerHe || '—'}</Td>
                    <Td className="text-[12px] text-gray-600">
                      {r.communicationRuleCount > 0 ? `${r.communicationRuleCount} מסרים` : '—'}
                    </Td>
                    <Td className="text-[12px] text-gray-600">{fmtWhen(r.lastRunAt)}</Td>
                    <Td className="text-[12px] text-gray-600">
                      {r.totalRuns}
                      {r.failedInWindow > 0 ? (
                        <span className="ms-1 rounded bg-red-100 px-1.5 text-[11px] text-red-700">{r.failedInWindow} נכשלו</span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasAny, filter }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-12 text-center">
      <div className="text-[14px] font-medium text-gray-700">
        {hasAny ? 'אין אוטומציות שמתאימות לסינון' : 'טרם הוגדרו אוטומציות'}
      </div>
      <div className="mt-1 text-[12.5px] text-gray-500">
        {hasAny
          ? (filter === 'problems' ? 'כל האוטומציות תקינות כרגע.' : 'נסו סינון אחר.')
          : 'אוטומציות מוגדרות בקוד ומופיעות כאן אוטומטית.'}
      </div>
    </div>
  );
}

const Th = ({ children }) => <th className="px-3 py-2 text-start font-medium">{children}</th>;
const Td = ({ children, className = '' }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
