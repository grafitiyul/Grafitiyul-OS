import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { dealPath } from '../../deals/config.js';

// הזמנות סוכנים — the reservation sessions inbox. Sessions are immutable
// audit records; the ONE mutation is "עבד מחדש" (reprocess), which calls the
// same exactly-once processor as the inline attempt and the sweep. Refetches
// on window focus (submissions arrive from outside the admin's browser).

const STATUS = {
  submitted: { label: 'התקבל', cls: 'bg-blue-50 text-blue-700' },
  processing: { label: 'בעיבוד', cls: 'bg-blue-50 text-blue-700' },
  processed: { label: 'טופל', cls: 'bg-emerald-50 text-emerald-700' },
  partially_processed: { label: 'טופל חלקית', cls: 'bg-amber-50 text-amber-700' },
  failed: { label: 'נכשל', cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-100 text-gray-500' },
};

// Filter chips — "פתוח" is everything that still needs attention.
const FILTERS = [
  { key: 'all', label: 'הכל', match: () => true },
  { key: 'open', label: 'דורש טיפול', match: (s) => !['processed', 'cancelled'].includes(s.status) },
  { key: 'processed', label: 'טופלו', match: (s) => s.status === 'processed' },
];

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

export default function ReservationsList() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(() => {
    api.reservations
      .list()
      .then(setSessions)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    // Submissions come from agents' phones — refetch when the admin returns.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  async function reprocess(id) {
    setBusyId(id);
    try {
      await api.reservations.process(id);
    } catch (e) {
      if (e?.status !== 409) alert('שגיאה בעיבוד: ' + e.message);
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)?.match || (() => true);
    return (sessions || []).filter(match);
  }, [sessions, filter]);

  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!sessions) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">הזמנות סוכנים</h1>
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-[12px] transition ${
                filter === f.key
                  ? 'bg-blue-50 font-semibold text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-[12px] text-gray-600 hover:bg-gray-50"
        >
          רענון
        </button>
      </div>
      <p className="mt-1 text-[13px] text-gray-500">
        בקשות הזמנה שהוגשו בטופס הסוכנים. כל קבוצה הופכת לדיל נפרד לאחר עיבוד.
      </p>

      {!visible.length ? (
        <div className="mt-10 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
          {sessions.length ? 'אין בקשות בסינון הנוכחי.' : 'עדיין לא הוגשו הזמנות.'}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((s) => {
            const st = STATUS[s.status] || STATUS.submitted;
            const reprocessable = !['processed', 'cancelled'].includes(s.status);
            return (
              <section key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold text-gray-900">בקשה #{s.sessionNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
                  <span className="text-[12px] text-gray-500">{fmtWhen(s.submittedAt)}</span>
                  <div className="flex-1" />
                  {s.contact && (
                    <Link to={`/admin/crm/contacts/${s.contact.contactNo ?? s.contact.id}`} className="text-[13px] text-blue-700 hover:underline">
                      {s.contact.name}
                    </Link>
                  )}
                  {s.organization && (
                    <Link
                      to={`/admin/crm/organizations/${s.organization.orgNo ?? s.organization.id}`}
                      className="text-[13px] text-gray-600 hover:underline"
                    >
                      · {s.organization.name}
                    </Link>
                  )}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {s.groups.length} קבוצות · {s.participantsTotal} משתתפים
                  </span>
                  {reprocessable && (
                    <button
                      type="button"
                      onClick={() => reprocess(s.id)}
                      disabled={busyId === s.id}
                      className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-[12px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {busyId === s.id ? 'מעבד…' : 'עבד מחדש'}
                    </button>
                  )}
                </div>

                <ul className="mt-3 divide-y divide-gray-100">
                  {s.groups.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                      <span className="font-medium text-gray-900">{g.groupName}</span>
                      <span className="text-gray-500">
                        {[g.locationLabel, g.productLabel, g.tourDate, g.tourTime, `${g.participants} משתתפים`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {g.onSiteContactName && (
                        <span className="text-[12px] text-gray-400">
                          · נציג בשטח: {g.onSiteContactName} <bdi dir="ltr">{g.onSiteContactPhone}</bdi>
                        </span>
                      )}
                      <div className="flex-1" />
                      {g.deal ? (
                        <Link
                          to={dealPath(g.deal)}
                          className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-700"
                          dir="ltr"
                        >
                          GOS-{g.deal.orderNo}
                        </Link>
                      ) : g.status === 'failed' ? (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[12px] text-red-700" title={g.lastError || ''}>
                          נכשל
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[12px] text-blue-700">ממתין</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
