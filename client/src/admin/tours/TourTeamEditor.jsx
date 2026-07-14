import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import AlertDialog from '../common/AlertDialog.jsx';
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

// Round staff avatar — real photo when the profile has one, initial otherwise.
// Shared by the assignment chips and the picker rows.
export function StaffAvatar({ src, name, className = 'h-6 w-6' }) {
  if (src) {
    return <img src={src} alt="" className={`${className} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-bold text-gray-600`}
      aria-hidden
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
}

// A single assigned guide — compact role-colored chip with the staff photo.
// Clicking the name opens the role picker; the ✕ removes the assignment.
function GuideChip({ a, onRoleChange, onRemove, busy }) {
  const [menu, setMenu] = useState(false);
  const gone = !a.personRef;
  const name = a.personRef?.displayName || a.displayName || '?';
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full py-1 ps-1 pe-1 text-[12px] font-semibold ${ASSIGNMENT_ROLE_STYLES[a.role]}`}
      >
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          title="שינוי תפקיד"
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <StaffAvatar src={a.personRef?.profile?.imageUrl} name={name} />
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

// The "+" opens a MULTI-SELECT staff popover (Gmail-recipients style): the
// popover stays open, people are checked on/off with search, and one confirm
// button assigns everyone at once. Much faster than one-popover-per-person.
function AddGuidesButton({ people, onPickMany, busy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const filtered = people.filter((p) =>
    (p.displayName || '').toLowerCase().includes(q.trim().toLowerCase()),
  );

  function closeReset() {
    setOpen(false);
    setQ('');
    setSelected(new Set());
  }
  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function applySelection() {
    const ids = [...selected];
    closeReset();
    if (ids.length) onPickMany(ids);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="הוספת אנשי צוות"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-300 text-lg leading-none text-gray-400 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={closeReset} />
          <div className="absolute z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="p-2 pb-1">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="חיפוש אנשי צוות…"
                className="h-8 w-full rounded-lg border border-gray-200 px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="max-h-56 overflow-y-auto px-1.5">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-[12px] text-gray-400">אין אנשי צוות זמינים</p>
              )}
              {filtered.map((p) => (
                <label
                  key={p.id}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] hover:bg-blue-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="rounded border-gray-300"
                  />
                  <StaffAvatar src={p.profile?.imageUrl} name={p.displayName} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName}
                    {p.lifecycleHint === 'trainee' ? ' · מתלמד' : ''}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 p-2">
              <button
                type="button"
                onClick={closeReset}
                className="rounded-lg px-2.5 py-1.5 text-[12px] text-gray-500 hover:bg-gray-100"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={applySelection}
                disabled={selected.size === 0}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                הוספת {selected.size || ''} נבחרים
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// `endpoints` adapts the SAME surface to another backend with identical method
// shapes (addAssignment(subjectId, data) / updateAssignment(id, data) /
// removeAssignment(id)) — used by the Deal tour-plan (api.dealTourPlan, where
// `tourId` is the deal id). Default: the real TourEvent APIs.
export default function TourTeamEditor({ tourId, assignments = [], onChanged, endpoints = api.tours }) {
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert

  useEffect(() => {
    // Canonical assignable list (active guides/trainees only) — the server
    // enforces the same rule on POST, so this filter is UX, not the gate.
    api.people
      .assignable()
      .then((r) => setPeople(r.people || []))
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

  // Multi-add: everyone joins as a plain guide (role is tuned on the chip).
  // One refresh at the end; an already_assigned race is skipped silently.
  async function addMany(personRefIds) {
    if (!personRefIds.length) return;
    setBusy(true);
    try {
      for (const personRefId of personRefIds) {
        try {
          await endpoints.addAssignment(tourId, { personRefId, role: 'guide' });
        } catch (e) {
          if (e.payload?.error !== 'already_assigned') throw e;
        }
      }
      await onChanged?.();
    } catch (e) {
      setAlertMsg(
        e.payload?.error === 'person_not_assignable'
          ? 'לא ניתן לשבץ: איש הצוות אינו פעיל במערכת (עזב, הושבת או שאינו בסטטוס מדריך/מתלמד).'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(a, role) {
    if (role === a.role) return;
    setBusy(true);
    try {
      await endpoints.updateAssignment(a.id, { role });
      await onChanged?.();
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }
  async function removeAssignment(a) {
    setBusy(true);
    try {
      await endpoints.removeAssignment(a.id);
      await onChanged?.();
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sorted.map((a) => (
        <GuideChip key={a.id} a={a} busy={busy} onRoleChange={changeRole} onRemove={removeAssignment} />
      ))}
      <AddGuidesButton people={available} onPickMany={addMany} busy={busy} />
      {sorted.length === 0 && (
        <span className="text-[13px] text-gray-400">עדיין לא שובצו מדריכים — הוסיפו עם +</span>
      )}
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </div>
  );
}
