import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  IDENTITY_SOURCES,
  IDENTITY_SOURCE_LABELS,
  PERSON_STATUS_LABELS,
  PERSON_STATUSES,
  PROCEDURE_STATE_COLORS,
  PROCEDURE_STATE_LABELS,
  PROCEDURE_STATES,
} from './config.js';

// Full guide profile — header + Identity + Profile + Bank + Procedures.
// Payments + Activity are separate slices (8E / 8F) and are intentionally
// not rendered here.
export default function PersonProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState(null);
  const [teams, setTeams] = useState([]);
  const [procedures, setProcedures] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, t, proc] = await Promise.all([
        api.people.get(id),
        api.teams.list(),
        api.people.procedures(id).catch(() => ({
          toLearn: [],
          available: [],
          learned: [],
        })),
      ]);
      setPerson(p);
      setTeams(t);
      setProcedures(proc);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="text-sm text-red-600 mb-2">שגיאה בטעינת הפרופיל</div>
        <div className="text-xs text-gray-500 font-mono" dir="ltr">
          {error}
        </div>
      </div>
    );
  }
  if (!person) {
    return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-6">
      <BackLink />
      <ProfileHeader person={person} onChanged={refresh} onDeleted={() => navigate('/admin/people')} />
      <IdentitySection person={person} onChanged={refresh} />
      <TeamSection person={person} teams={teams} onChanged={refresh} />
      <ProfileSection person={person} onChanged={refresh} />
      <BankSection person={person} onChanged={refresh} />
      <ProceduresSection procedures={procedures} />
    </div>
  );
}

function BackLink() {
  return (
    <button
      onClick={() => window.history.back()}
      className="text-[12px] text-gray-500 hover:text-gray-800"
    >
      ← חזרה לרשימה
    </button>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ person, onChanged, onDeleted }) {
  const portalUrl = `${window.location.origin}/p/${person.portalToken}`;
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  async function togglePortal() {
    await api.people.setPortalEnabled(person.id, !person.portalEnabled);
    onChanged();
  }
  async function rotateToken() {
    if (!window.confirm('להחליף את הטוקן? הקישור הנוכחי יפסיק לעבוד מיידית.'))
      return;
    setRotating(true);
    try {
      await api.people.rotateToken(person.id);
      onChanged();
    } finally {
      setRotating(false);
    }
  }
  async function toggleStatus() {
    const next =
      person.status === PERSON_STATUSES.ACTIVE
        ? PERSON_STATUSES.BLOCKED
        : PERSON_STATUSES.ACTIVE;
    await api.people.update(person.id, { status: next });
    onChanged();
  }
  async function doDelete() {
    await api.people.remove(person.id);
    onDeleted();
  }

  return (
    <section>
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-4">
        <ProfileImage person={person} onChanged={onChanged} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {person.displayName}
            </h1>
            <StatusChip status={person.status} />
            {person.team && (
              <span className="text-[11px] bg-gray-100 text-gray-700 rounded px-2 py-0.5">
                {person.team.displayName}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-gray-500 font-mono" dir="ltr">
            {person.externalPersonId}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={copyLink}
              className="text-[12px] border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
            >
              {copied ? 'הועתק ✓' : 'העתק קישור פורטל'}
            </button>
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] border border-blue-300 text-blue-700 bg-blue-50 rounded px-3 py-1 hover:bg-blue-100"
            >
              פתח פורטל ↗
            </a>
            <label className="flex items-center gap-2 text-[12px] text-gray-700 mr-2">
              <input
                type="checkbox"
                checked={person.portalEnabled}
                onChange={togglePortal}
              />
              פורטל פעיל
            </label>
            <button
              onClick={rotateToken}
              disabled={rotating}
              className="text-[12px] text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              {rotating ? 'מחליף…' : 'החלף טוקן'}
            </button>
            <div className="flex-1" />
            <button
              onClick={toggleStatus}
              className={`text-[12px] rounded px-3 py-1 border ${
                person.status === PERSON_STATUSES.ACTIVE
                  ? 'border-red-200 text-red-700 hover:bg-red-50'
                  : 'border-green-200 text-green-700 hover:bg-green-50'
              }`}
            >
              {person.status === PERSON_STATUSES.ACTIVE ? 'חסום' : 'הפעל'}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[12px] text-red-600 hover:bg-red-50 rounded px-3 py-1 border border-red-200"
            >
              מחק
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        הטוקן = גישה. אל תשתפו בפומבי, החליפו אם דלף.
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="מחיקת מדריך"
          body={`למחוק את "${person.displayName}"? פעולה זו תסיר גם את הפרופיל, ההקצאות והקישור לפורטל. לא ניתן לבטל.`}
          confirmLabel="מחק"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </section>
  );
}

function ProfileImage({ person, onChanged }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const src = person.profile?.imageUrl || null;

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.people.uploadImage(person.id, file);
      await onChanged();
    } catch (err) {
      window.alert('העלאת תמונה נכשלה: ' + err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="relative shrink-0">
      <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center text-gray-400 text-2xl">
        {src ? (
          <img
            src={src}
            alt={person.displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          initials(person.displayName)
        )}
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="absolute -bottom-1 -left-1 bg-white border border-gray-300 rounded-full shadow-sm text-[11px] px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
        title="העלאת תמונה"
      >
        {busy ? '…' : '✎'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFile}
      />
    </div>
  );
}

function initials(name) {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?'
  );
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

// ── Identity section ────────────────────────────────────────────────────────
// Identity = displayName, email, phone. Source of truth is controlled by
// `identitySource`:
//   * 'recruitment' — these fields mirror the recruitment export and are
//     strictly read-only here. To correct a value, fix it in recruitment
//     and re-import. No local-edit override: it would drift from the
//     upstream truth and get overwritten on next import anyway.
//   * 'management' — management owns identity. Edit here directly.
//
// The team field is NOT identity — it's management-owned relationship
// data. See <TeamSection> below, which is rendered as a separate section.

function IdentitySection({ person, onChanged }) {
  const isRecruitment = person.identitySource === IDENTITY_SOURCES.RECRUITMENT;
  if (isRecruitment) {
    return <ReadOnlyIdentity person={person} />;
  }
  return <EditableIdentity person={person} onChanged={onChanged} />;
}

function ReadOnlyIdentity({ person }) {
  return (
    <Section
      title="זהות"
      headerRight={
        <span className="text-[11px] text-gray-500">
          {IDENTITY_SOURCE_LABELS[person.identitySource]}
        </span>
      }
    >
      <div className="text-[12px] bg-gray-50 border border-gray-200 text-gray-700 rounded px-3 py-2 mb-3">
        שדות הזהות מגיעים ממערכת הגיוס ואינם ניתנים לעריכה כאן. תיקון
        ערך מתבצע במערכת הגיוס ונטען בייבוא הבא.
      </div>
      <ReadOnlyField label="שם מלא" value={person.displayName} />
      <ReadOnlyField label="אימייל" value={person.email || '—'} />
      <ReadOnlyField label="טלפון" value={person.phone || '—'} />
    </Section>
  );
}

function EditableIdentity({ person, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    displayName: person.displayName,
    email: person.email || '',
    phone: person.phone || '',
  });

  useEffect(() => {
    setForm({
      displayName: person.displayName,
      email: person.email || '',
      phone: person.phone || '',
    });
  }, [person]);

  async function save() {
    setSaving(true);
    try {
      await api.people.update(person.id, {
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      });
      await onChanged();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="זהות"
      headerRight={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {IDENTITY_SOURCE_LABELS[person.identitySource]}
          </span>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-0.5"
            >
              עריכה
            </button>
          )}
        </div>
      }
    >
      {!editing ? (
        <>
          <ReadOnlyField label="שם מלא" value={person.displayName} />
          <ReadOnlyField label="אימייל" value={person.email || '—'} />
          <ReadOnlyField label="טלפון" value={person.phone || '—'} />
        </>
      ) : (
        <>
          <Field label="שם מלא">
            <input
              type="text"
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="אימייל">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="טלפון">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
            >
              ביטול
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
            >
              {saving ? 'שומר…' : 'שמור'}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[12px] text-gray-600 mb-1">{label}</div>
      <div className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded px-3 py-2">
        {value}
      </div>
    </div>
  );
}

// ── Team section ────────────────────────────────────────────────────────────
// Team assignment is management-owned. It does NOT live in the Identity
// section because it isn't identity data, and it stays fully editable
// regardless of identitySource. Changes save immediately on select.

function TeamSection({ person, teams, onChanged }) {
  const [saving, setSaving] = useState(false);

  async function setTeam(teamRefId) {
    setSaving(true);
    try {
      await api.people.update(person.id, { teamRefId: teamRefId || null });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="שיוך צוות"
      headerRight={
        saving ? <span className="text-[11px] text-gray-500">שומר…</span> : null
      }
    >
      <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
        צוותים מנוהלים במערכת הזו, לא במערכת הגיוס. השיוך נשמר כאן בלבד.
      </div>
      <Field label="צוות">
        <select
          value={person.teamRefId || ''}
          onChange={(e) => setTeam(e.target.value)}
          disabled={saving}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">— ללא צוות —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
      </Field>
      {teams.length === 0 && (
        <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          אין צוותים. צרו צוות במסך "אנשים → צוותים".
        </div>
      )}
    </Section>
  );
}

// ── Profile section ─────────────────────────────────────────────────────────
// Description + notes. Image lives in the header. Autosave on blur keeps
// things simple.

function ProfileSection({ person, onChanged }) {
  const [description, setDescription] = useState(
    person.profile?.description || '',
  );
  const [notes, setNotes] = useState(person.profile?.notes || '');
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef({
    description: person.profile?.description || '',
    notes: person.profile?.notes || '',
  });

  useEffect(() => {
    const d = person.profile?.description || '';
    const n = person.profile?.notes || '';
    setDescription(d);
    setNotes(n);
    lastSaved.current = { description: d, notes: n };
  }, [person]);

  async function saveIfChanged() {
    const patch = {};
    if (description !== lastSaved.current.description)
      patch.description = description;
    if (notes !== lastSaved.current.notes) patch.notes = notes;
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      await api.people.updateProfile(person.id, patch);
      lastSaved.current = { description, notes };
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="פרופיל"
      headerRight={
        saving ? <span className="text-[11px] text-gray-500">שומר…</span> : null
      }
    >
      <Field label="תיאור">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveIfChanged}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="קצר: תפקיד, התמחות, תחומי אחריות…"
        />
      </Field>
      <Field label="הערות פנימיות">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveIfChanged}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="לא מוצג למדריך. לשימוש ניהולי בלבד."
        />
      </Field>
    </Section>
  );
}

// ── Bank section ────────────────────────────────────────────────────────────
// Flexible JSON per Slice 8 decision #4. Hidden by default per spec.
// Edit-as-JSON for now — later we'll add a real form when the shape stabilizes.

function BankSection({ person, onChanged }) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(() =>
    JSON.stringify(person.profile?.bankDetails || {}, null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setRaw(JSON.stringify(person.profile?.bankDetails || {}, null, 2));
    setEditing(false);
    setErr(null);
  }, [person]);

  async function save() {
    setErr(null);
    let parsed;
    try {
      parsed = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      setErr('JSON לא תקין');
      return;
    }
    setSaving(true);
    try {
      await api.people.updateProfile(person.id, { bankDetails: parsed });
      await onChanged();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const hasData =
    person.profile?.bankDetails &&
    Object.keys(person.profile.bankDetails || {}).length > 0;

  return (
    <Section
      title="פרטי בנק"
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVisible((v) => !v)}
            className="text-[12px] text-gray-600 hover:bg-gray-100 rounded px-2 py-0.5"
          >
            {visible ? 'הסתר' : 'הצג'}
          </button>
        </div>
      }
    >
      {!visible && (
        <div className="text-sm text-gray-500 italic">
          {hasData ? 'פרטי בנק מוסתרים. לחצו "הצג".' : 'אין פרטי בנק.'}
        </div>
      )}
      {visible && !editing && (
        <>
          <pre
            className="text-[12px] bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto"
            dir="ltr"
          >
            {hasData
              ? JSON.stringify(person.profile.bankDetails, null, 2)
              : '{}'}
          </pre>
          <button
            onClick={() => setEditing(true)}
            className="mt-2 text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1"
          >
            עריכה
          </button>
        </>
      )}
      {visible && editing && (
        <>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            dir="ltr"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
            spellCheck={false}
          />
          {err && <div className="text-sm text-red-600 mt-1">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => {
                setEditing(false);
                setRaw(
                  JSON.stringify(person.profile?.bankDetails || {}, null, 2),
                );
                setErr(null);
              }}
              disabled={saving}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
            >
              ביטול
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
            >
              {saving ? 'שומר…' : 'שמור'}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

// ── Procedures section ──────────────────────────────────────────────────────

function ProceduresSection({ procedures }) {
  if (!procedures) {
    return (
      <Section title="נהלים">
        <div className="text-sm text-gray-500">טוען…</div>
      </Section>
    );
  }
  return (
    <Section title="נהלים">
      <ProcedureBucket
        label="נהלים ללמידה"
        emptyLabel="אין נהלים ממתינים."
        rows={procedures.toLearn}
      />
      <ProcedureBucket
        label="נהלים זמינים"
        emptyLabel="אין נהלים זמינים נוספים."
        rows={procedures.available}
      />
      <ProcedureBucket
        label="נהלים שנלמדו"
        emptyLabel="עדיין לא השלים נהלים."
        rows={procedures.learned}
        renderExtra={(row) =>
          row.answers && row.answers.length > 0 ? (
            <ApprovedAnswers answers={row.answers} />
          ) : null
        }
      />
    </Section>
  );
}

function ProcedureBucket({ label, emptyLabel, rows, renderExtra }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
        {label} <span className="font-normal">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 italic">{emptyLabel}</div>
      ) : (
        <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
          {rows.map((row) => {
            const open = expanded === row.flowId;
            const extra = renderExtra?.(row);
            return (
              <li key={row.flowId}>
                <button
                  onClick={() =>
                    extra ? setExpanded(open ? null : row.flowId) : null
                  }
                  className={`w-full flex items-center gap-2 px-3 py-2 text-right ${
                    extra ? 'hover:bg-gray-50' : ''
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900 truncate block">
                      {row.title}
                    </span>
                    {row.description && (
                      <span className="text-[11px] text-gray-500 truncate block">
                        {row.description}
                      </span>
                    )}
                  </span>
                  <StateChip state={row.state} />
                  {row.mandatory ? (
                    <span className="text-[10px] text-gray-500">חובה</span>
                  ) : (
                    <span className="text-[10px] text-gray-500">אופציונלי</span>
                  )}
                  {extra && (
                    <span className="text-[10px] text-gray-400">
                      {open ? '▲' : '▼'}
                    </span>
                  )}
                </button>
                {open && extra}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StateChip({ state }) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded ${
        PROCEDURE_STATE_COLORS[state] || 'bg-gray-100 text-gray-700'
      }`}
    >
      {PROCEDURE_STATE_LABELS[state] || state}
    </span>
  );
}

function ApprovedAnswers({ answers }) {
  return (
    <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
      <ul className="space-y-2">
        {answers.map((a) => (
          <li
            key={a.flowNodeId}
            className="text-[13px] bg-white border border-gray-200 rounded p-2"
          >
            <div className="text-[11px] text-gray-500 font-mono" dir="ltr">
              {a.questionItemId}
            </div>
            <div className="text-gray-900">
              {a.openText || a.answerLabel || a.answerChoice || '—'}
            </div>
            {a.adminComment && (
              <div className="mt-1 text-[11px] text-gray-500 border-t border-gray-100 pt-1">
                הערת מנהל: {a.adminComment}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Shared primitives ───────────────────────────────────────────────────────

function Section({ title, headerRight, children }) {
  return (
    <section>
      <div className="flex items-center mb-2">
        <h2 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold flex-1">
          {title}
        </h2>
        {headerRight}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3 last:mb-0">
      <div className="text-[12px] text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-5"
      >
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-700 mb-4 whitespace-pre-line">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            ביטול
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-md font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
