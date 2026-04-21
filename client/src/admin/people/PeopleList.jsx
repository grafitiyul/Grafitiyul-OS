import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PERSON_STATUS_LABELS, PERSON_STATUSES } from './config.js';

// Admin guides list. Guides are NEVER created manually here — identity
// comes from the recruitment system and flows in through the Import
// action. The list displays whatever has been imported; selection for
// further work (profile, assignment) happens via the usual row click or
// the AssignmentDialog.
//
// "פתח פורטל" opens the guide's portal token URL; "העתק קישור" copies
// it. Portal is disabled per-person via the profile screen.
export default function PeopleList() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPeople(await api.people.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
          onClick={() => setImportOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 text-sm font-medium"
          title="ייבוא מדריכים ממערכת הגיוס"
        >
          ⬇ ייבוא ממערכת הגיוס
        </button>
      </div>

      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
        המדריכים והצוותים אינם נוצרים כאן. הם מגיעים ממערכת הגיוס דרך
        פעולת הייבוא. ייבוא חוזר מעדכן שמות, אימייל, טלפון ושיוך צוות
        לרשומות שכבר קיימות.
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
            ? 'אין מדריכים. לחצו "ייבוא ממערכת הגיוס" כדי לייבא את הרשימה.'
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

      <ImportPeopleDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setImportOpen(false);
          await refresh();
        }}
      />
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

// ── Import dialog ───────────────────────────────────────────────────────────
// Previews the recruitment snapshot (what would be imported) before the
// admin triggers the upsert. No fields are user-editable — the only
// action is "ייבא" which hits POST /api/people/import. Teams should be
// imported first so person ↔ team linkage resolves correctly.

function ImportPeopleDialog({ open, onClose, onImported }) {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setErr(null);
    setSnap(null);
    (async () => {
      try {
        setSnap(await api.recruitment.people());
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, [open]);

  if (!open) return null;

  async function doImport() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.people.importFromRecruitment();
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col"
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-lg font-semibold text-gray-900 flex-1">
            ייבוא מדריכים ממערכת הגיוס
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!snap && !err && (
            <div className="text-sm text-gray-500">טוען רשימת מקור…</div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
          {snap && (
            <>
              <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                הרשומות למטה מגיעות ממערכת הגיוס — שם, אימייל וטלפון.
                הייבוא מעדכן מדריכים קיימים לפי המזהה החיצוני ויוצר
                רשומות חדשות למי שעדיין לא קיים. שיוך לצוותים מנוהל
                בעמוד הפרופיל של כל מדריך ולא נגזר מהייבוא.
              </div>

              <ul className="border border-gray-200 rounded divide-y divide-gray-100">
                {snap.map((p) => (
                  <li
                    key={p.externalPersonId}
                    className="px-3 py-2 text-sm flex items-center gap-2"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 block truncate">
                        {p.displayName}
                      </span>
                      <span
                        className="text-[11px] text-gray-500 font-mono block truncate"
                        dir="ltr"
                      >
                        {p.externalPersonId}
                      </span>
                    </span>
                    <span className="text-[11px] text-gray-600 truncate">
                      {p.email || p.phone || ''}
                    </span>
                  </li>
                ))}
                {snap.length === 0 && (
                  <li className="px-3 py-3 text-[12px] text-gray-500 italic">
                    אין רשומות במקור.
                  </li>
                )}
              </ul>

              {result && (
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  ייבוא הושלם: {result.created} חדשים, {result.updated}{' '}
                  עודכנו.
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            סגור
          </button>
          <button
            onClick={result ? onImported : doImport}
            disabled={busy || !snap}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {busy ? 'מייבא…' : result ? 'סיום' : 'ייבא'}
          </button>
        </div>
      </div>
    </div>
  );
}
