import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PERSON_STATUS_LABELS, PERSON_STATUSES } from './config.js';

// Admin guides list. Clicking a row opens the full profile. The "פתח פורטל"
// action opens the guide's portal token URL in a new tab; "העתק קישור"
// copies the same URL to the clipboard.
//
// Creation is via a lightweight modal — admin enters the identity trio
// (externalPersonId + displayName + optional email/phone/team) and the
// server generates a portalToken automatically.
export default function PeopleList() {
  const navigate = useNavigate();
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [peopleData, teamsData] = await Promise.all([
        api.people.list(),
        api.teams.list(),
      ]);
      setPeople(peopleData);
      setTeams(teamsData);
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
          onClick={() => setCreateOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 text-sm font-medium"
        >
          + מדריך חדש
        </button>
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
            ? 'אין עדיין מדריכים. לחצו "מדריך חדש" כדי להוסיף את הראשון.'
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

      <CreatePersonDialog
        open={createOpen}
        teams={teams}
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          setCreateOpen(false);
          await refresh();
          navigate(`/admin/people/${created.id}`);
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

// ── Create dialog ──

function CreatePersonDialog({ open, teams, onClose, onCreated }) {
  const [form, setForm] = useState({
    externalPersonId: '',
    displayName: '',
    email: '',
    phone: '',
    teamRefId: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Reset whenever the dialog reopens.
  useEffect(() => {
    if (open) {
      setForm({
        externalPersonId: '',
        displayName: '',
        email: '',
        phone: '',
        teamRefId: '',
      });
      setErr(null);
    }
  }, [open]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await api.people.create({
        externalPersonId: form.externalPersonId.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        teamRefId: form.teamRefId || null,
      });
      await onCreated(created);
    } catch (e2) {
      setErr(e2?.payload?.error || e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-5"
      >
        <div className="text-lg font-semibold mb-3">מדריך חדש</div>

        <Field label="מזהה חיצוני (מערכת הגיוס)" required>
          <input
            type="text"
            value={form.externalPersonId}
            onChange={(e) =>
              setForm({ ...form, externalPersonId: e.target.value })
            }
            required
            dir="ltr"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </Field>

        <Field label="שם מלא" required>
          <input
            type="text"
            value={form.displayName}
            onChange={(e) =>
              setForm({ ...form, displayName: e.target.value })
            }
            required
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="אימייל">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </Field>
          <Field label="טלפון">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </Field>
        </div>

        <Field label="צוות">
          <select
            value={form.teamRefId}
            onChange={(e) => setForm({ ...form, teamRefId: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">— ללא צוות —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </Field>

        {err && (
          <div className="text-sm text-red-600 mb-2">{translateError(err)}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            ביטול
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
          >
            {busy ? 'יוצר…' : 'צור מדריך'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block mb-3">
      <div className="text-sm font-medium text-gray-800 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </div>
      {children}
    </label>
  );
}

function translateError(code) {
  if (code === 'externalPersonId_required') return 'חובה להזין מזהה חיצוני';
  if (code === 'displayName_required') return 'חובה להזין שם';
  if (code === 'externalPersonId_already_exists')
    return 'מזהה חיצוני זה כבר קיים במערכת';
  return code;
}
