import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { dealPath } from '../../deals/config.js';

// הזמנות סוכנים — minimal READ-ONLY sessions list (Slice 2). Sessions are
// immutable audit records; the full review inbox (shared table infra,
// reprocess actions, realtime) is a later slice. Group rows link to their
// created Deal once the processor (Slice 3) stamps it.

const STATUS = {
  submitted: { label: 'התקבל', cls: 'bg-blue-50 text-blue-700' },
  processing: { label: 'בעיבוד', cls: 'bg-blue-50 text-blue-700' },
  processed: { label: 'טופל', cls: 'bg-emerald-50 text-emerald-700' },
  partially_processed: { label: 'טופל חלקית', cls: 'bg-amber-50 text-amber-700' },
  failed: { label: 'נכשל', cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-100 text-gray-500' },
};

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

  useEffect(() => {
    let alive = true;
    api.reservations
      .list()
      .then((rows) => alive && setSessions(rows))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!sessions) return <div className="p-6 text-sm text-gray-500">טוען…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold tracking-tight text-gray-900">הזמנות סוכנים</h1>
      <p className="mt-1 text-[13px] text-gray-500">
        בקשות הזמנה שהוגשו בטופס הסוכנים. כל קבוצה הופכת לדיל נפרד לאחר עיבוד.
      </p>

      {!sessions.length ? (
        <div className="mt-10 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
          עדיין לא הוגשו הזמנות.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {sessions.map((s) => {
            const st = STATUS[s.status] || STATUS.submitted;
            return (
              <section key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold text-gray-900">בקשה #{s.sessionNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
                  <span className="text-[12px] text-gray-500">{fmtWhen(s.submittedAt)}</span>
                  <div className="flex-1" />
                  {s.contact && (
                    <Link to={`/admin/crm/contacts/${s.contact.id}`} className="text-[13px] text-blue-700 hover:underline">
                      {s.contact.name}
                    </Link>
                  )}
                  {s.organization && (
                    <Link
                      to={`/admin/crm/organizations/${s.organization.id}`}
                      className="text-[13px] text-gray-600 hover:underline"
                    >
                      · {s.organization.name}
                    </Link>
                  )}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {s.groups.length} קבוצות · {s.participantsTotal} משתתפים
                  </span>
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
