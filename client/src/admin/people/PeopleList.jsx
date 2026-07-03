import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PERSON_STATUS_LABELS, PERSON_STATUSES } from './config.js';

// Unified "אנשים וגישה" surface.
//
// Architectural intent (see audit + spec):
//   * One identity layer (PersonRef) for everyone — trainee / staff /
//     evaluator are lifecycle hints, not separate person types.
//   * Recruitment is the upstream source of truth for lifecycle.
//     GOS owns access (portalEnabled + audit timestamps).
//   * No separate tabs per role. Two filter dimensions instead:
//     lifecycle and access state.
//
// The previous "מדריכים" header + columns are gone. Same DB-level
// data, same upstream sync, same per-person profile route — only the
// admin surface evolved.

// Display labels live here, in the client. The server stores stable
// English values. New upstream lifecycles can be added by extending
// this map + the filter list below.
const LIFECYCLE_LABEL = {
  trainee: 'מתלמד',
  staff: 'צוות',
  // No 'evaluator' here — recruitment doesn't currently expose
  // "evaluator" as a stable lifecycle distinct from staff/guide.
  // Treat evaluators as a role/permission concept (Phase 2), not a
  // separate identity type.
};
const LIFECYCLE_PILL_CLS = {
  trainee: 'bg-blue-100 text-blue-800 border-blue-200',
  staff: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const LIFECYCLE_FILTERS = [
  { key: 'all', label: 'כולם' },
  { key: 'trainee', label: 'מתלמדים' },
  { key: 'staff', label: 'צוות' },
  { key: 'unknown', label: 'ללא סיווג' },
];

const ACCESS_FILTERS = [
  { key: 'all', label: 'כולם' },
  { key: 'granted', label: 'יש גישה' },
  { key: 'revoked', label: 'אין גישה' },
];

export default function PeopleList() {
  const [people, setPeople] = useState([]);
  const [upstream, setUpstream] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [pendingAccessId, setPendingAccessId] = useState(null);

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
      console.warn('force refresh failed:', e.message);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleAccess(person, nextEnabled) {
    setPendingAccessId(person.id);
    try {
      const updated = await api.people.setAccess(person.id, nextEnabled);
      setPeople((rows) =>
        rows.map((p) => (p.id === updated.id ? updated : p)),
      );
    } catch (e) {
      console.warn('access toggle failed:', e.message);
      // Refresh to recover from server-side state surprises (e.g.
      // person was deleted in another tab).
      refresh();
    } finally {
      setPendingAccessId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (lifecycleFilter === 'unknown') {
        if (p.lifecycleHint) return false;
      } else if (lifecycleFilter !== 'all') {
        if (p.lifecycleHint !== lifecycleFilter) return false;
      }
      if (accessFilter === 'granted' && !p.portalEnabled) return false;
      if (accessFilter === 'revoked' && p.portalEnabled) return false;
      if (q) {
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
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [people, search, lifecycleFilter, accessFilter]);

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-gray-900">צוות</h1>
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

      {/* Filter chips. Two dimensions, both narrowing — lifecycle
          (from upstream) and access state (local GOS truth). No tabs:
          the same row can be a trainee with access OR a staff member
          without access; both shapes exist concurrently. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-[12px]">
        <FilterRow
          label="סוג"
          options={LIFECYCLE_FILTERS}
          value={lifecycleFilter}
          onChange={setLifecycleFilter}
        />
        <FilterRow
          label="גישה"
          options={ACCESS_FILTERS}
          value={accessFilter}
          onChange={setAccessFilter}
        />
      </div>

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
              ? 'לא ניתן לטעון אנשים ממערכת הגיוס. ראו הודעת השגיאה למעלה.'
              : 'אין אנשים במערכת הגיוס.'
            : 'לא נמצאו תוצאות.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>שם</Th>
                <Th>סוג</Th>
                <Th>גישה</Th>
                <Th>צוות</Th>
                <Th>סטטוס</Th>
                <Th className="text-left">פעולות</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  pendingAccess={pendingAccessId === p.id}
                  onToggleAccess={toggleAccess}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500">{label}:</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
              value === o.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UpstreamStatus({ upstream }) {
  if (!upstream) return null;
  if (upstream.ok) {
    return (
      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
        רשימת האנשים נטענת ישירות ממערכת הגיוס. סיווג (מתלמד / צוות /
        מעריך) הוא הלקסיקון של מערכת הגיוס. הגישה לפורטל היא נפרדת
        לחלוטין — מנוהלת כאן.
      </div>
    );
  }
  return (
    <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
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

function PersonRow({ person, pendingAccess, onToggleAccess }) {
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
      <Td>
        <LifecyclePill hint={person.lifecycleHint} />
      </Td>
      <Td>
        <AccessPill enabled={person.portalEnabled} />
      </Td>
      <Td>{person.team?.displayName || <Muted>—</Muted>}</Td>
      <Td>
        <StatusChip status={person.status} />
      </Td>
      <Td className="text-left">
        <div className="flex gap-1 justify-end items-center flex-wrap">
          <button
            type="button"
            onClick={() => onToggleAccess(person, !person.portalEnabled)}
            disabled={pendingAccess}
            className={`text-[12px] rounded px-2 py-1 border disabled:opacity-50 ${
              person.portalEnabled
                ? 'border-red-300 text-red-700 hover:bg-red-50'
                : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
            }`}
            title={
              person.portalEnabled
                ? 'בטל את הגישה של האדם לפורטל GOS'
                : 'תן לאדם גישה לפורטל GOS'
            }
          >
            {pendingAccess
              ? '…'
              : person.portalEnabled
              ? 'בטל גישה'
              : 'תן גישה'}
          </button>
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

function LifecyclePill({ hint }) {
  if (!hint) {
    return <span className="text-[11px] text-gray-400">—</span>;
  }
  const label = LIFECYCLE_LABEL[hint] || hint;
  const cls = LIFECYCLE_PILL_CLS[hint] || 'bg-gray-100 text-gray-800 border-gray-200';
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function AccessPill({ enabled }) {
  if (enabled) {
    return (
      <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
        יש גישה
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
      אין גישה
    </span>
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
