import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLE_STYLES,
  ASSIGNMENT_ROLE_DOTS,
} from './config.js';

// Shared guide-assignment editor ("צוות משובץ") — the ONE implementation used by
// BOTH the Tour modal and the Deal-side tour editor, so staff assignment logic,
// role vocabulary, colors and the person picker can never diverge. Self-
// contained: it owns the people list and the add/change/remove calls against the
// tour assignment API, and calls onChanged() after each write.

// A single assigned guide, shown as a compact role-colored chip. Clicking the
// name opens the role picker; the ✕ removes the assignment.
function GuideChip({ a, onRoleChange, onRemove, busy }) {
  const [menu, setMenu] = useState(false);
  const gone = !a.personRef;
  const name = a.personRef?.displayName || a.displayName || '?';
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1 text-[12px] font-semibold ${ASSIGNMENT_ROLE_STYLES[a.role]}`}
      >
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          title="שינוי תפקיד"
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span aria-hidden>👤</span>
          <span className="whitespace-nowrap">{name}</span>
          <span className="opacity-75">· {ASSIGNMENT_ROLE_LABELS[a.role] || a.role}</span>
          {gone && <span className="opacity-70">(הוסר)</span>}
        </button>
        <button
          type="button"
          onClick={() => onRemove(a)}
          disabled={busy}
          title="הסרת השיבוץ"
          className="flex h-4 w-4 items-center justify-center rounded-full text-current opacity-70 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {ASSIGNMENT_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onRoleChange(a, r);
                  setMenu(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] hover:bg-gray-50 ${
                  r === a.role ? 'font-bold text-gray-900' : 'text-gray-700'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${ASSIGNMENT_ROLE_DOTS[r]}`} />
                {ASSIGNMENT_ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The "+" that opens a searchable popover of assignable staff. Picking a person
// assigns them immediately (as a plain guide — role is tuned on the chip after).
function AddGuideButton({ people, onPick, busy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = people.filter((p) =>
    (p.displayName || '').toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="הוספת איש צוות"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-300 text-lg leading-none text-gray-400 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש איש צוות…"
              className="mb-1.5 h-8 w-full rounded-lg border border-gray-200 px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-[12px] text-gray-400">אין אנשי צוות זמינים</p>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick(p.id);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] hover:bg-blue-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600">
                    {(p.displayName || '?').slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName}
                    {p.lifecycleHint === 'trainee' ? ' · מתלמד' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function TourTeamEditor({ tourId, assignments = [], onChanged }) {
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.people
      .list()
      .then((r) => setPeople((r.people || []).filter((p) => p.status !== 'blocked')))
      .catch(() => {});
  }, []);

  const sorted = useMemo(
    () =>
      [...assignments].sort(
        (a, b) => ASSIGNMENT_ROLES.indexOf(a.role) - ASSIGNMENT_ROLES.indexOf(b.role),
      ),
    [assignments],
  );
  const assignedIds = new Set(assignments.map((a) => a.personRefId).filter(Boolean));
  const available = people.filter((p) => !assignedIds.has(p.id));

  async function addAssignment(personRefId, role = 'guide') {
    if (!personRefId) return;
    setBusy(true);
    try {
      await api.tours.addAssignment(tourId, { personRefId, role });
      await onChanged?.();
    } catch (e) {
      alert(
        e.payload?.error === 'already_assigned'
          ? 'איש הצוות כבר משובץ לסיור הזה.'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(a, role) {
    if (role === a.role) return;
    setBusy(true);
    try {
      await api.tours.updateAssignment(a.id, { role });
      await onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function removeAssignment(a) {
    setBusy(true);
    try {
      await api.tours.removeAssignment(a.id);
      await onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sorted.map((a) => (
        <GuideChip key={a.id} a={a} busy={busy} onRoleChange={changeRole} onRemove={removeAssignment} />
      ))}
      <AddGuideButton people={available} onPick={addAssignment} busy={busy} />
      {sorted.length === 0 && (
        <span className="text-[13px] text-gray-400">עדיין לא שובצו מדריכים — הוסיפו עם +</span>
      )}
    </div>
  );
}
