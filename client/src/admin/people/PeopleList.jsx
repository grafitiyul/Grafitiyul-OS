import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PERSON_STATUS_LABELS, PERSON_STATUSES } from './config.js';

// Admin guides list.
//
// The list is UPSTREAM-BACKED with sync-on-read: every page load hits the
// server, which refreshes local PersonRef rows from the recruitment
// export, then returns the merged roster (identity = recruitment,
// operational = local: portalToken, portalEnabled, status, team, profile).
//
// There is no manual "import" action — guides appear automatically as
// soon as they exist in recruitment. If the upstream refresh fails on a
// given load, the server still returns the last-known local rows and
// flags `upstream.ok=false` so this component can surface the problem
// instead of silently showing stale data.
export default function PeopleList() {
  const [people, setPeople] = useState([]);
  const [upstream, setUpstream] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.people.list();
      setPeople(r.people || []);
      setUpstream(r.upstream || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function forceRefresh() {
    setRefreshing(true);
    try {
      await api.people.forceRefresh();
      await refresh();
    } catch (e) {
      // Surfacing the error via the upstream banner is enough — refresh()
      // re-runs the list and will capture the failure through the normal
      // response shape.
      console.warn('force refresh failed:', e.message);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const hay = [
        p.displayName,
        p.email,
        p.phone,
        p.externalPersonId,
        p.team?.displayName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [people, search]);

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-gray-900">מדריכים</h1>
        <span className="text-[12px] text-gray-500">({people.length})</span>
        <div className="flex-1" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש…"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
        <button
          onClick={forceRefresh}
          disabled={refreshing || loading}
          title="רענון מיידי מול מערכת הגיוס"
          className="text-[12px] border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded-md px-3 py-1.5 disabled:opacity-50"
        >
          {refreshing ? 'מרענן…' : '⟳ רענון'}
        </button>
      </div>

      <UpstreamStatus upstream={upstream} />

      {loading && (
        <div className="p-6 text-center text-sm text-gray-500">טוען…</div>
      )}
      {error && (
        <div className="p-6 text-center">
          <div className="text-sm text-red-600 mb-2">שגיאה בטעינה</div>
          <div className="text-xs text-gray-500 font-mono" dir="ltr">
            {error}
          </div>
          <button
            onClick={refresh}
            className="mt-3 border border-gray-300 rounded px-3 py-1 text-sm"
          >
            נסו שוב
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="p-10 text-center text-sm text-gray-500">
          {people.length === 0
            ? upstream?.ok === false
              ? 'לא ניתן לטעון מדריכים ממערכת הגיוס. ראו הודעת השגיאה למעלה.'
              : 'אין מדריכים במערכת הגיוס.'
            : 'לא נמצאו תוצאות.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>שם</Th>
                <Th>צוות</Th>
                <Th>סטטוס</Th>
                <Th>אימייל</Th>
                <Th>טלפון</Th>
                <Th className="text-left">פעולות</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UpstreamStatus({ upstream }) {
  if (!upstream) return null;
  if (upstream.ok) {
    return (
      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
        המדריכים נטענים ישירות ממערכת הגיוס. נתונים תפעוליים (תמונה,
        הערות, פרטי בנק, שיוך צוות) נשמרים במערכת זו ומתמזגים עם הזהות
        המגיעה מהגיוס.
      </div>
    );
  }
  return (
    <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
      <div className="font-semibold mb-1">
        לא ניתן לסנכרן עם מערכת הגיוס כרגע.
      </div>
      <div>
        מוצג מידע מקומי אחרון. סיבה:{' '}
        <span className="font-mono" dir="ltr">
          {upstream.error}
          {upstream.detail ? ` — ${upstream.detail}` : ''}
        </span>
      </div>
    </div>
  );
}

function PersonRow({ person }) {
  const portalUrl = `${window.location.origin}/p/${person.portalToken}`;
  const [copied, setCopied] = useState(false);

  function onCopy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <tr className="hover:bg-gray-50">
      <Td>
        <Link
          to={`/admin/people/${person.id}`}
          className="text-blue-700 hover:underline font-medium"
        >
          {person.displayName}
        </Link>
      </Td>
      <Td>{person.team?.displayName || <Muted>—</Muted>}</Td>
      <Td>
        <StatusChip status={person.status} />
        {!person.portalEnabled && (
          <span className="mr-2 text-[10px] text-gray-500">פורטל חסום</span>
        )}
      </Td>
      <Td>{person.email || <Muted>—</Muted>}</Td>
      <Td>{person.phone || <Muted>—</Muted>}</Td>
      <Td className="text-left">
        <div className="flex gap-1 justify-end">
          <button
            onClick={onCopy}
            className="text-[12px] text-gray-600 hover:bg-gray-100 rounded px-2 py-1"
            title="העתק קישור פורטל"
          >
            {copied ? 'הועתק ✓' : 'העתק קישור'}
          </button>
          <a
            href={portalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1"
          >
            פתח פורטל ↗
          </a>
        </div>
      </Td>
    </tr>
  );
}

function Th({ children, className = '' }) {
  return (
    <th
      className={`text-right text-[11px] uppercase tracking-wide font-semibold px-3 py-2 ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function Muted({ children }) {
  return <span className="text-gray-400">{children}</span>;
}

function StatusChip({ status }) {
  const active = status === PERSON_STATUSES.ACTIVE;
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded ${
        active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {PERSON_STATUS_LABELS[status] || status}
    </span>
  );
}
