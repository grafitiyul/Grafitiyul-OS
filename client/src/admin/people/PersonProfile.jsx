import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../common/BackButton.jsx';
import { useFileDrop } from '../common/useFileDrop.js';
import { api } from '../../lib/api.js';
import { useDirtyForm } from '../../lib/dirtyForms.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import AvatarCropDialog from '../../avatar/AvatarCropDialog.jsx';
import BankDetailsFields from '../../profile/BankDetailsFields.jsx';
import {
  IDENTITY_SOURCES,
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
      {/* Read-first hero — identity at a glance. Editing lives below. */}
      <ProfileHero person={person} onChanged={refresh} />
      <IdentityAccessSection person={person} onChanged={refresh} onDeleted={() => navigate('/admin/people')} />
      {/* Trainees (recruitment-mirrored) also get the read-only identity card. */}
      {person.identitySource !== IDENTITY_SOURCES.MANAGEMENT && (
        <IdentitySection person={person} onChanged={refresh} />
      )}
      <TrainingFactsSection person={person} onChanged={refresh} />
      <TeamSection person={person} teams={teams} onChanged={refresh} />
      <ProfileSection person={person} onChanged={refresh} />
      <BankSection person={person} onChanged={refresh} />
      <ProceduresSection procedures={procedures} onChanged={refresh} />
      <StationAccessSection person={person} onChanged={refresh} />
      <ChangesSection person={person} onChanged={refresh} />
    </div>
  );
}

function BackLink() {
  return <BackButton onClick={() => window.history.back()} label="חזרה לרשימה" />;
}

// ── Hero — display-first header ("This is Avi", not "this is a form") ──────
//
// The first screen SHOWS the person: photo, name, role, status, contact and
// the key operational facts. Everything editable moved down into the tabs
// (IdentityAccessSection there keeps the exact same logic — relocated only).

const LIFECYCLE_ROLE_LABELS = {
  staff: 'מדריך',
  trainee: 'מתלמד',
  former: 'עזב',
};

function fmtDateHe(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function ProfileHero({ person, onChanged }) {
  const facts = [
    { label: 'תחילת הדרכות', value: fmtDateHe(person.profile?.trainingStartDate) },
    { label: 'מחזור הכשרה', value: person.profile?.trainingCohort },
    {
      label: 'מערכי הדרכה פתוחים',
      value: person.trainingStations > 0 ? String(person.trainingStations) : null,
      sub: person.trainingTours > 0 ? `ב־${person.trainingTours} מערכים` : 'תחנות',
    },
    {
      label: 'סיורים',
      value: person.toursCount > 0 ? String(person.toursCount) : null,
      sub: 'סה״כ שיבוצים',
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:p-6">
      <div className="flex flex-wrap items-start gap-5">
        {/* The avatar stays the shared editable one — clicking opens the crop
            editor; that's identity care, not form-editing. */}
        <ProfileImage person={person} onChanged={onChanged} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {person.displayName}
            </h1>
            <StatusChip status={person.status} />
          </div>
          <div className="mt-0.5 text-[14px] text-gray-500">
            {LIFECYCLE_ROLE_LABELS[person.lifecycleHint] || 'ללא סיווג'}
            {person.team?.displayName ? ` · ${person.team.displayName}` : ''}
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-[13.5px] text-gray-700">
            {person.email && (
              <div className="flex items-center gap-2">
                <HeroIcon d="M4 6h16v12H4z M4 7l8 6 8-6" />
                <span dir="ltr">{person.email}</span>
              </div>
            )}
            {person.phone && (
              <div className="flex items-center gap-2">
                <HeroIcon d="M6 3h4l1.5 5-2.5 1.5a12 12 0 0 0 5.5 5.5L16 12.5l5 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2" />
                <span dir="ltr" className="tabular-nums">{person.phone}</span>
              </div>
            )}
            {person.profile?.trainingStartDate && (
              <div className="flex items-center gap-2 text-gray-500">
                <HeroIcon d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                חבר צוות מאז: {fmtDateHe(person.profile.trainingStartDate)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Key operational facts — quiet stat tiles, list-scan friendly. */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-3">
            <div className="text-[11.5px] font-medium text-gray-500">{f.label}</div>
            <div className="mt-0.5 truncate text-[17px] font-bold text-gray-900">
              {f.value || <span className="font-normal text-gray-300">—</span>}
            </div>
            {f.value && f.sub && (
              <div className="text-[11px] text-gray-400">{f.sub}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function HeroIcon({ d }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// ── Identity + access management (was the header) ───────────────────────────
// The exact editing/portal/lifecycle controls that used to dominate the
// header — logic untouched, relocated below the hero (into the technical
// tab). Renders WITHOUT the avatar (the hero owns it now).

function IdentityAccessSection({ person, onChanged, onDeleted }) {
  const portalUrl = `${window.location.origin}/p/${person.portalToken}`;
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acceptConfirm, setAcceptConfirm] = useState(false);
  const [acceptBusy, setAcceptBusy] = useState(false);

  // Staff identity is GOS-owned and edited RIGHT HERE, inline in the header —
  // this is the single primary identity editor for staff. Trainees
  // (identitySource='recruitment') keep a read-only name (their identity is
  // mirrored from recruitment).
  const isManagement = person.identitySource === IDENTITY_SOURCES.MANAGEMENT;
  const idBaseline = {
    displayName: person.displayName || '',
    email: person.email || '',
    phone: person.phone || '',
  };
  const [idForm, setIdForm] = useState(idBaseline);
  const [idSaving, setIdSaving] = useState(false);
  useEffect(() => {
    setIdForm({
      displayName: person.displayName || '',
      email: person.email || '',
      phone: person.phone || '',
    });
  }, [person]);
  const idDirty =
    isManagement &&
    (idForm.displayName !== idBaseline.displayName ||
      idForm.email !== idBaseline.email ||
      idForm.phone !== idBaseline.phone);
  // Unsaved-work guard so a version-gate reload / navigation can't silently drop
  // an in-progress identity edit.
  useDirtyForm(idDirty);

  async function saveIdentity() {
    if (!idForm.displayName.trim()) {
      window.alert('שם מלא הוא שדה חובה.');
      return;
    }
    setIdSaving(true);
    try {
      await api.people.update(person.id, {
        displayName: idForm.displayName.trim(),
        email: idForm.email.trim() || null,
        phone: idForm.phone.trim() || null,
      });
      await onChanged();
    } finally {
      setIdSaving(false);
    }
  }

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
  // Lifecycle is GOS-owned. Explicit control — 'trainee'|'staff'|'former'|'none'.
  // EXCEPTION: trainee → staff is the official "accepted to team" BUSINESS EVENT,
  // not a plain edit. It must be confirmed and routed through recruitment so
  // exactly one accepted_to_team event fires. All other transitions are direct.
  async function changeLifecycle(value) {
    if (person.lifecycleHint === 'trainee' && value === 'staff') {
      setAcceptConfirm(true);
      return;
    }
    await api.people.setLifecycle(person.id, value);
    onChanged();
  }
  async function confirmAcceptToTeam() {
    setAcceptBusy(true);
    try {
      await api.people.acceptToTeam(person.id);
      setAcceptConfirm(false);
      await onChanged();
    } catch (e) {
      window.alert('שגיאה בקבלה לצוות: ' + (e.payload?.error || e.message));
    } finally {
      setAcceptBusy(false);
    }
  }
  // Reject in training: recruitment records it (sole writer); GOS then deletes.
  async function rejectTraining() {
    if (!window.confirm('לסמן ככישלון/דחייה בהכשרה? הפעולה תירשם במערכת הגיוס והאדם יוסר מ-GOS. לא ניתן לבטל מ-GOS.')) return;
    try {
      await api.people.rejectTraining(person.id);
      onDeleted();
    } catch (e) {
      window.alert('שגיאה: ' + (e.payload?.error || e.message));
    }
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
    <Section title="זהות וגישה">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isManagement ? (
              <input
                type="text"
                value={idForm.displayName}
                onChange={(e) => setIdForm({ ...idForm, displayName: e.target.value })}
                placeholder="שם מלא"
                aria-label="שם מלא"
                className="text-lg font-semibold text-gray-900 bg-transparent border-b border-dashed border-gray-300 hover:border-gray-400 focus:border-emerald-500 focus:outline-none px-0.5 min-w-[8rem] flex-1"
              />
            ) : (
              <div className="text-lg font-semibold text-gray-900 truncate">
                {person.displayName}
              </div>
            )}
            <LifecycleChip lifecycle={person.lifecycleHint} />
          </div>
          <div className="mt-1 text-[12px] text-gray-500 font-mono" dir="ltr">
            {person.externalPersonId}
          </div>

          {isManagement && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-[12px] text-gray-600">
                אימייל
                <input
                  type="email"
                  dir="ltr"
                  value={idForm.email}
                  onChange={(e) => setIdForm({ ...idForm, email: e.target.value })}
                  className="mt-0.5 w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
              </label>
              <label className="text-[12px] text-gray-600">
                טלפון
                <input
                  type="tel"
                  dir="ltr"
                  value={idForm.phone}
                  onChange={(e) => setIdForm({ ...idForm, phone: e.target.value })}
                  className="mt-0.5 w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
                <button
                  onClick={saveIdentity}
                  disabled={idSaving || !idDirty}
                  className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-md font-medium disabled:opacity-50"
                >
                  {idSaving ? 'שומר…' : 'שמור'}
                </button>
                {idDirty && (
                  <button
                    onClick={() => setIdForm(idBaseline)}
                    disabled={idSaving}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
                  >
                    בטל שינויים
                  </button>
                )}
                <span className="text-[11px] text-emerald-700">
                  השינויים נשמרים ומשתקפים מיד במערכת הגיוס
                </span>
              </div>
            </div>
          )}

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
            <label className="flex items-center gap-1.5 text-[12px] text-gray-700">
              סטטוס:
              <select
                value={
                  person.lifecycleHint === 'staff'
                    ? 'staff'
                    : person.lifecycleHint === 'trainee'
                    ? 'trainee'
                    : 'none'
                }
                onChange={(e) => changeLifecycle(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-[12px] bg-white"
              >
                <option value="trainee">מתלמד</option>
                <option value="staff">צוות</option>
                <option value="former">עזב</option>
                <option value="none">ללא שיוך</option>
              </select>
            </label>
            {person.lifecycleHint === 'trainee' && (
              <button
                onClick={rejectTraining}
                className="text-[12px] rounded px-3 py-1 border border-red-200 text-red-700 hover:bg-red-50"
                title="נכשל/נדחה במהלך ההכשרה — המערכת תרשום זאת בגיוס והאדם יוסר מ-GOS"
              >
                נכשל בהכשרה
              </button>
            )}
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

      <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
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

      {acceptConfirm && (
        <ConfirmModal
          title="קבלה לצוות"
          body={`המתלמד "${person.displayName}" יתקבל באופן רשמי לצוות. הפעולה תירשם במערכת הגיוס ותהפוך אותו לחבר צוות. האם אתה בטוח?`}
          confirmLabel={acceptBusy ? 'מקבל…' : 'קבל לצוות'}
          danger={false}
          busy={acceptBusy}
          onCancel={() => setAcceptConfirm(false)}
          onConfirm={confirmAcceptToTeam}
        />
      )}
    </Section>
  );
}

// ── Training onboarding facts (תחילת הדרכה / מחזור הכשרה) ───────────────────
// Two management-owned fields on PersonProfile; changes land in the person
// changelog like every other tracked profile field.

function TrainingFactsSection({ person, onChanged }) {
  const stored = person.profile || {};
  const baseline = {
    trainingStartDate: stored.trainingStartDate || '',
    trainingCohort: stored.trainingCohort || '',
  };
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({
      trainingStartDate: stored.trainingStartDate || '',
      trainingCohort: stored.trainingCohort || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person]);
  const dirty =
    form.trainingStartDate !== baseline.trainingStartDate ||
    form.trainingCohort !== baseline.trainingCohort;
  useDirtyForm(dirty);

  async function save() {
    setSaving(true);
    try {
      await api.people.updateProfile(person.id, {
        trainingStartDate: form.trainingStartDate || null,
        trainingCohort: form.trainingCohort || null,
      });
      await onChanged();
    } catch (e) {
      window.alert('שמירה נכשלה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="הכשרה">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="תאריך תחילת הדרכות">
          <input
            type="date"
            value={form.trainingStartDate}
            onChange={(e) => setForm((f) => ({ ...f, trainingStartDate: e.target.value }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </Field>
        <Field label="מחזור הכשרה">
          <input
            type="text"
            value={form.trainingCohort}
            placeholder='למשל: "מרץ 2026" או "מחזור 14"'
            onChange={(e) => setForm((f) => ({ ...f, trainingCohort: e.target.value }))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </Field>
      </div>
      <div className="flex justify-end pt-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </Section>
  );
}

function ProfileImage({ person, onChanged }) {
  const [busy, setBusy] = useState(false);
  // { src, originalFile?, originalUrl?, initialCrop? } — shared crop flow.
  const [cropState, setCropState] = useState(null);
  const src = person.profile?.imageUrl || null;
  const originalUrl = person.profile?.imageOriginalUrl || null;

  // A picked/dropped file opens the SHARED crop tool (same component the
  // guide portal uses) instead of uploading as-is.
  function onFiles(files) {
    const file = files?.[0];
    if (!file) return;
    setCropState({ src: URL.createObjectURL(file), originalFile: file });
  }

  // Clicking the AVATAR ITSELF opens the editor: recrop the current photo
  // when one exists (the stored original when available, else the current
  // rendition), otherwise straight to the file picker.
  function openEditor() {
    if (busy) return;
    if (src) {
      setCropState(
        originalUrl
          ? { src: originalUrl, originalUrl, initialCrop: person.profile?.imageCrop || null }
          : { src, originalUrl: null, initialCrop: null },
      );
    } else {
      open();
    }
  }

  async function saveCrop(blob, crop) {
    setBusy(true);
    try {
      let oUrl = cropState.originalUrl || null;
      if (cropState.originalFile) {
        oUrl = (await api.people.uploadImageOriginal(person.id, cropState.originalFile)).url;
      } else if (!oUrl && cropState.src) {
        // Recropping a legacy photo (no stored original): the current
        // rendition becomes the original going forward.
        oUrl = cropState.src;
      }
      await api.people.uploadImage(person.id, blob, {
        filename: 'avatar.webp',
        originalUrl: oUrl,
        crop,
      });
      setCropState(null);
      await onChanged();
    } catch (err) {
      window.alert('העלאת תמונה נכשלה: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await api.people.updateProfile(person.id, { imageUrl: null });
      setCropState(null);
      await onChanged();
    } catch (err) {
      window.alert('הסרת התמונה נכשלה: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  const { dragOver, open, dropProps, inputProps } = useFileDrop({
    accept: 'image/jpeg,image/png,image/webp',
    onFiles,
    disabled: busy,
    onReject: () => window.alert('קובץ לא נתמך — יש לבחור תמונה (JPG/PNG/WebP).'),
  });

  return (
    <div className="relative shrink-0" {...dropProps} title="לחצו לעריכת התמונה, או גררו תמונה חדשה">
      <button
        type="button"
        onClick={openEditor}
        disabled={busy}
        aria-label="עריכת תמונת פרופיל"
        className={`w-20 h-20 rounded-full bg-gray-100 border overflow-hidden flex items-center justify-center text-gray-400 text-2xl transition ${
          dragOver ? 'border-blue-400 ring-2 ring-blue-300' : 'border-gray-200 hover:ring-2 hover:ring-blue-200'
        }`}
      >
        {src ? (
          <img
            src={src}
            alt={person.displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          initials(person.displayName)
        )}
      </button>
      {dragOver && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-blue-500/10 text-[10px] font-medium text-blue-700">
          שחררו כאן
        </span>
      )}
      <button
        type="button"
        onClick={openEditor}
        disabled={busy}
        className="absolute -bottom-1 -left-1 bg-white border border-gray-300 rounded-full shadow-sm text-[11px] px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
        title="עריכת תמונה"
      >
        {busy ? '…' : '✎'}
      </button>
      <input {...inputProps} />
      {cropState && (
        <AvatarCropDialog
          key={cropState.src}
          open
          src={cropState.src}
          initialCrop={cropState.initialCrop || null}
          saving={busy}
          onCancel={() => !busy && setCropState(null)}
          onSave={saveCrop}
          onPickNew={(file) =>
            setCropState({ src: URL.createObjectURL(file), originalFile: file })
          }
          onRemove={src ? removePhoto : null}
        />
      )}
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

// Current lifecycle at a glance — GOS-owned. Always rendered so the person's
// status is explicit (including "ללא שיוך" when unset).
function LifecycleChip({ lifecycle }) {
  const map = {
    staff: ['צוות', 'bg-blue-100 text-blue-800'],
    trainee: ['מתלמד', 'bg-amber-100 text-amber-800'],
    former: ['עזב', 'bg-gray-200 text-gray-700'],
  };
  const [label, cls] = map[lifecycle] || ['ללא שיוך', 'bg-gray-100 text-gray-600'];
  return <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

// ── Details section (read-only, trainees only) ──────────────────────────────
// Staff (identitySource='management') edit name/email/phone inline in the
// header — this section is not rendered for them. Trainees
// (identitySource='recruitment') see their details read-only here (mirrored
// from recruitment). Presentation only avoids the word "זהות"/"identity".

function IdentitySection({ person }) {
  return (
    <Section title="פרטים">
      <div className="text-[12px] bg-gray-50 border border-gray-200 text-gray-700 rounded px-3 py-2 mb-3">
        הפרטים מגיעים ממערכת הגיוס ואינם ניתנים לעריכה כאן. תיקון ערך מתבצע
        במערכת הגיוס ונטען בייבוא הבא.
      </div>
      <ReadOnlyField label="שם מלא" value={person.displayName} />
      <ReadOnlyField label="אימייל" value={person.email || '—'} />
      <ReadOnlyField label="טלפון" value={person.phone || '—'} />
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

  // Unsaved-work guard (auto-update): dirty when description/notes diverge from
  // the last saved values.
  useDirtyForm(
    description !== lastSaved.current.description || notes !== lastSaved.current.notes,
  );

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

// Structured bank details — the shared BankDetailsFields form (same component
// the Guide Portal uses) instead of the old free-form JSON editor. Bank
// details are not secret in this product: every admin sees them (no extra
// permission toggle). The server normalizes and records changes in history.
function BankSection({ person, onChanged }) {
  const stored = person.profile?.bankDetails || {};
  const baseline = {
    beneficiary: stored.beneficiary || null,
    bankCode: stored.bankCode || null,
    bankName: stored.bankName || null,
    branchCode: stored.branchCode || null,
    branchName: stored.branchName || null,
    accountNumber: stored.accountNumber || null,
  };
  const [form, setForm] = useState(baseline);
  const [banks, setBanks] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      beneficiary: stored.beneficiary || null,
      bankCode: stored.bankCode || null,
      bankName: stored.bankName || null,
      branchCode: stored.branchCode || null,
      branchName: stored.branchName || null,
      accountNumber: stored.accountNumber || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person]);

  useEffect(() => {
    api.bankCatalog
      .get()
      .then((r) => setBanks(r.banks || []))
      .catch(() => setBanks([])); // catalog failure never blocks editing
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useDirtyForm(dirty);

  async function save() {
    setSaving(true);
    try {
      await api.people.updateProfile(person.id, { bankDetails: form });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="פרטי בנק">
      <BankDetailsFields
        value={form}
        banks={banks}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
      />
      <div className="flex justify-end pt-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md font-medium disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </Section>
  );
}

// ── הרשאות למערכי הדרכה — guide → Station permission chips ─────────────────
//
// Explicit per-station rows are the ONE truth (Gmail-selection semantics):
// "בחר הכל" / "נקה הכל" per tour are bulk conveniences that create/delete
// rows, and individual chips keep toggling freely afterwards. Green = has
// access, grey = doesn't. Enforcement is server-side on the portal routes.

function StationAccessSection({ person, onChanged }) {
  const [tours, setTours] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAccess = useCallback(() => {
    api.people
      .stationAccess(person.id)
      .then((r) => setTours(r.tours || []))
      .catch(() => setTours([]));
  }, [person.id]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  async function apply(body) {
    if (busy) return;
    setBusy(true);
    try {
      await api.people.updateStationAccess(person.id, body);
      loadAccess();
      onChanged?.(); // refreshes the person → the history section reloads too
    } catch (e) {
      window.alert('עדכון ההרשאות נכשל: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (tours === null) {
    return (
      <Section title="הרשאות למערכי הדרכה">
        <div className="text-sm text-gray-400">טוען…</div>
      </Section>
    );
  }
  if (tours.length === 0) {
    return (
      <Section title="הרשאות למערכי הדרכה">
        <div className="text-sm text-gray-500 italic">
          אין עדיין מערכי הדרכה פעילים עם תחנות.
        </div>
      </Section>
    );
  }

  return (
    <Section title="הרשאות למערכי הדרכה">
      <div className="space-y-4">
        {tours.map((tour) => {
          const grantedCount = tour.stations.filter((s) => s.granted).length;
          return (
            <div key={tour.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-[13.5px] font-semibold text-gray-800">{tour.titleHe}</h3>
                <span className="text-[11.5px] text-gray-400">
                  {grantedCount}/{tour.stations.length} תחנות
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={busy || grantedCount === tour.stations.length}
                  onClick={() => apply({ grant: tour.stations.map((s) => s.id) })}
                  className="rounded px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                >
                  בחר הכל
                </button>
                <button
                  type="button"
                  disabled={busy || grantedCount === 0}
                  onClick={() => apply({ revoke: tour.stations.map((s) => s.id) })}
                  className="rounded px-2 py-0.5 text-[11.5px] font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                >
                  נקה הכל
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tour.stations.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      apply(s.granted ? { revoke: [s.id] } : { grant: [s.id] })
                    }
                    title={s.granted ? 'לחיצה תסיר גישה' : 'לחיצה תעניק גישה'}
                    className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-50 ${
                      s.granted
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {s.granted ? '✓ ' : ''}
                    {s.titleHe}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Profile change history (immutable) + restore ────────────────────────────
//
// Reads the shared person changelog (TimelineEntry kind='change'). Every row
// shows old → new (photos as thumbnails), who changed it, from which surface
// (admin / guide portal), and offers a one-click restore — which is itself a
// new audited change; the original record never mutates.

const CHANGE_SOURCE_LABELS = {
  guide_portal: 'פורטל המדריך',
  admin: 'אדמין',
  recruitment_sync: 'סנכרון גיוס',
};

function ChangesSection({ person, onChanged }) {
  const [entries, setEntries] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const loadChanges = useCallback(() => {
    api.people
      .changes(person.id)
      .then((r) => setEntries(r.entries || []))
      .catch(() => setEntries([]));
  }, [person.id]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges, person]);

  async function restore(entryId, fieldKey) {
    const key = `${entryId}:${fieldKey}`;
    if (busyKey) return;
    if (!window.confirm('לשחזר את הערך הקודם? הפעולה תירשם כשינוי חדש בהיסטוריה.')) return;
    setBusyKey(key);
    try {
      await api.people.restoreChange(person.id, entryId, fieldKey);
      await onChanged();
      loadChanges();
    } catch (e) {
      window.alert('השחזור נכשל: ' + e.message);
    } finally {
      setBusyKey(null);
    }
  }

  if (entries === null) {
    return (
      <Section title="היסטוריית שינויים">
        <div className="text-sm text-gray-400">טוען…</div>
      </Section>
    );
  }
  if (entries.length === 0) {
    return (
      <Section title="היסטוריית שינויים">
        <div className="text-sm text-gray-500 italic">אין עדיין שינויים מתועדים.</div>
      </Section>
    );
  }

  return (
    <Section title="היסטוריית שינויים">
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500">
              <span className="font-medium text-gray-700">
                {entry.createdByName || entry.actorLabel || 'מערכת'}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                {CHANGE_SOURCE_LABELS[entry.data?.source] || 'מערכת'}
              </span>
              {entry.data?.restoredFromEntryId && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                  שחזור
                </span>
              )}
              <span className="ms-auto tabular-nums" dir="ltr">
                {new Date(entry.createdAt).toLocaleString('he-IL', {
                  day: '2-digit',
                  month: '2-digit',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {entry.kind === 'station_access' ? (
              // Training-permission audit — immutable, no restore action.
              <ul className="space-y-1 text-[13px]">
                {(entry.data?.granted || []).length > 0 && (
                  <li className="text-emerald-800">
                    <span className="font-semibold">הוענקה גישה: </span>
                    {entry.data.granted.join(', ')}
                  </li>
                )}
                {(entry.data?.revoked || []).length > 0 && (
                  <li className="text-red-700">
                    <span className="font-semibold">הוסרה גישה: </span>
                    {entry.data.revoked.join(', ')}
                  </li>
                )}
              </ul>
            ) : (
              <ul className="space-y-1.5">
                {(entry.data?.changes || []).map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    <span className="shrink-0 font-semibold text-gray-700">{c.labelHe}:</span>
                    <ChangeValue fieldKey={c.fieldKey} value={c.oldValue} display={c.oldDisplay} muted />
                    <span className="text-gray-400" aria-hidden>
                      ←
                    </span>
                    <ChangeValue fieldKey={c.fieldKey} value={c.newValue} display={c.newDisplay} />
                    <button
                      type="button"
                      onClick={() => restore(entry.id, c.fieldKey)}
                      disabled={!!busyKey}
                      title="שחזור הערך הקודם"
                      className="ms-auto shrink-0 rounded px-2 py-0.5 text-[11.5px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                    >
                      {busyKey === `${entry.id}:${c.fieldKey}` ? 'משחזר…' : '↩ שחזור'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

// Old/new value rendering — photos preview as small thumbnails (old assets
// are never deleted, so the URLs keep working).
function ChangeValue({ fieldKey, value, display, muted = false }) {
  if (fieldKey === 'imageUrl') {
    return value ? (
      <img
        src={value}
        alt={display || ''}
        className={`h-9 w-9 rounded-full border border-gray-200 object-cover ${muted ? 'opacity-60' : ''}`}
      />
    ) : (
      <span className={`text-[12px] ${muted ? 'text-gray-400' : 'text-gray-600'}`}>ללא תמונה</span>
    );
  }
  return (
    <span className={`truncate ${muted ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>
      {display || '—'}
    </span>
  );
}

// ── Procedures section ──────────────────────────────────────────────────────

function ProceduresSection({ procedures, onChanged }) {
  // Single dialog state at the section level so the confirm modal
  // never gets unmounted by a sibling re-render mid-confirmation.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);

  async function performReset() {
    if (!resetTarget?.attemptId) return;
    setResetting(true);
    setResetError(null);
    try {
      await api.attempts.remove(resetTarget.attemptId);
      setResetTarget(null);
      await onChanged?.();
    } catch (e) {
      setResetError(e?.message || 'איפוס נכשל');
    } finally {
      setResetting(false);
    }
  }

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
        onResetClick={(row) => setResetTarget(row)}
      />
      <ProcedureBucket
        label="נהלים זמינים"
        emptyLabel="אין נהלים זמינים נוספים."
        rows={procedures.available}
        onResetClick={(row) => setResetTarget(row)}
      />
      <ProcedureBucket
        label="נהלים שנלמדו"
        emptyLabel="עדיין לא השלים נהלים."
        rows={procedures.learned}
        onResetClick={(row) => setResetTarget(row)}
        renderExtra={(row) =>
          row.answers && row.answers.length > 0 ? (
            <ApprovedAnswers answers={row.answers} />
          ) : null
        }
      />

      <ConfirmDialog
        open={!!resetTarget}
        title="איפוס ניסיון"
        body={
          resetTarget ? (
            <ResetDialogBody row={resetTarget} error={resetError} busy={resetting} />
          ) : null
        }
        confirmLabel={resetting ? 'מאפס…' : 'אפס ניסיון'}
        cancelLabel="ביטול"
        danger
        onCancel={() => {
          if (resetting) return;
          setResetTarget(null);
          setResetError(null);
        }}
        onConfirm={performReset}
      />
    </Section>
  );
}

function ResetDialogBody({ row, error, busy }) {
  return (
    <div className="space-y-3 text-sm text-gray-800">
      <div>
        על ידי איפוס תימחק לצמיתות הניסיון של המדריך עבור הנוהל הזה,
        כולל כל התשובות וההיסטוריה. המדריך יוכל להתחיל את הנוהל מחדש.
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded p-2">
        <div className="text-[11px] text-gray-500 uppercase tracking-wide">
          נוהל
        </div>
        <div className="font-medium text-gray-900">{row.title || '(ללא שם)'}</div>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-[13px]">
          {error}
        </div>
      )}
      {busy && (
        <div className="text-[12px] text-gray-500">מבצע איפוס בשרת…</div>
      )}
    </div>
  );
}

function ProcedureBucket({ label, emptyLabel, rows, renderExtra, onResetClick }) {
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
            // The reset action is only meaningful when an attempt
            // exists. For a "not_started" / no-attempt row there's
            // nothing to reset; we hide the button rather than
            // disable it so the row stays clean.
            const canReset = !!row.attemptId;
            return (
              <li key={row.flowId}>
                <div className="flex items-stretch">
                  <button
                    onClick={() =>
                      extra ? setExpanded(open ? null : row.flowId) : null
                    }
                    className={`flex-1 flex items-center gap-2 px-3 py-2 text-right min-w-0 ${
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
                  {canReset && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onResetClick?.(row);
                      }}
                      className="shrink-0 px-2 my-1 mx-1 text-[12px] text-red-700 border border-red-200 hover:bg-red-50 rounded"
                      title="אפס ניסיון — ימחק את הניסיון והתשובות, המדריך יוכל להתחיל מחדש"
                    >
                      ⟲ אפס
                    </button>
                  )}
                </div>
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

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm, danger = true, busy = false }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
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
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 text-sm text-white rounded-md font-medium disabled:opacity-50 ${
              danger ? 'bg-red-600' : 'bg-emerald-600'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
