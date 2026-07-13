import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';
import BankDetailsFields from '../../profile/BankDetailsFields.jsx';
import AvatarCropDialog from '../../avatar/AvatarCropDialog.jsx';
import { StaffAvatar } from '../tours/TourTeamEditor.jsx';

// "+ איש צוות חדש" — create a staff member directly in GOS (someone who did NOT
// come from recruitment). Reuses the canonical PersonRef/PersonProfile model
// via POST /api/people; there is NO second identity model here.
//
//   * Compact RTL form; required fields marked with *.
//   * Duplicate guard (phone/email) is enforced server-side; a 409 surfaces an
//     inline "this person already exists → open their card" panel (never a
//     browser alert, never a silent duplicate).
//   * Photo reuses the SAME shared crop tool + upload endpoints as the profile
//     (uploaded right after the person is created, since the endpoints need an id).
//   * After save we open the new staff member's profile.

const STATUS_OPTIONS = [
  { key: 'active', label: 'פעיל' },
  { key: 'trainee', label: 'מתלמד' },
  { key: 'inactive', label: 'לא פעיל' },
];

const EMPTY = {
  displayName: '',
  status: 'active',
  portalEligible: true,
  teamRefId: '',
  phone: '',
  email: '',
  notes: '',
};

const EMPTY_BANK = {
  beneficiary: '',
  bankCode: '',
  bankName: '',
  branchCode: '',
  branchName: '',
  accountNumber: '',
};

const FIELD =
  'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function NewStaffDialog({ open, onClose, onCreated }) {
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [bank, setBank] = useState(EMPTY_BANK);
  const [banks, setBanks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [photo, setPhoto] = useState(null); // { blob, crop, originalFile, previewUrl }
  const [cropState, setCropState] = useState(null); // { src, originalFile }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // inline string
  const [conflict, setConflict] = useState(null); // { person, matchedOn }
  const fileRef = useRef(null);

  function set(k, v) {
    setF((s) => ({ ...s, [k]: v }));
  }

  // Load the accelerators once the dialog opens (never block the form).
  useEffect(() => {
    if (!open) return;
    api.teams.list().then((t) => setTeams(t || [])).catch(() => setTeams([]));
    api.bankCatalog.get().then((r) => setBanks(r.banks || [])).catch(() => setBanks([]));
  }, [open]);

  // Reset everything each time the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setF(EMPTY);
    setBank(EMPTY_BANK);
    setPhoto(null);
    setCropState(null);
    setError(null);
    setConflict(null);
    setBusy(false);
  }, [open]);

  // Unsaved-work guard — dirty while any field is filled.
  useDirtyWhen(f, EMPTY, { active: open });

  const ready = f.displayName.trim().length > 0 && !busy;
  const inactive = f.status === 'inactive';

  function onPickFile(files) {
    const file = files?.[0];
    if (!file) return;
    setCropState({ src: URL.createObjectURL(file), originalFile: file });
  }

  function onCropSave(blob, crop) {
    setPhoto({
      blob,
      crop,
      originalFile: cropState?.originalFile || null,
      previewUrl: URL.createObjectURL(blob),
    });
    setCropState(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setConflict(null);
    try {
      const person = await api.people.create({
        displayName: f.displayName.trim(),
        status: f.status,
        portalEligible: inactive ? false : f.portalEligible,
        teamRefId: f.teamRefId || null,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        notes: f.notes.trim() || null,
        bankDetails: bank,
      });

      // Photo (optional) — uploaded after creation via the SAME endpoints the
      // profile uses; a failure here never loses the created person.
      if (photo) {
        try {
          let originalUrl = null;
          if (photo.originalFile) {
            originalUrl = (await api.people.uploadImageOriginal(person.id, photo.originalFile)).url;
          }
          await api.people.uploadImage(person.id, photo.blob, {
            filename: 'avatar.webp',
            originalUrl,
            crop: photo.crop,
          });
        } catch {
          /* photo failed — the staff member still exists; they can add it on the card */
        }
      }

      await onCreated?.();
      onClose?.();
      navigate(`/admin/people/${person.id}`);
    } catch (err) {
      if (err.status === 409 && err.payload?.error === 'duplicate_person') {
        setConflict({ person: err.payload.person, matchedOn: err.payload.matchedOn || [] });
      } else {
        setError(err.payload?.error || err.message || 'שמירה נכשלה');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="איש צוות חדש"
      size="md-wide"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            type="submit"
            form="new-staff-form"
            disabled={!ready}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'יצירה'}
          </button>
        </>
      }
    >
      <form id="new-staff-form" onSubmit={submit} className="space-y-4">
        {/* Photo + name/status lead the form. */}
        <div className="flex items-start gap-4">
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full ring-1 ring-gray-200 transition hover:ring-2 hover:ring-blue-200"
              title="הוספת תמונה"
            >
              <StaffAvatar src={photo?.previewUrl} name={f.displayName || '·'} className="h-16 w-16" />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[11px] text-blue-600 hover:underline"
            >
              {photo ? 'החלפת תמונה' : 'תמונה'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                onPickFile(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <Field label="שם מלא *">
              <input
                autoFocus
                value={f.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="סטטוס *">
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((o) => {
                  const on = f.status === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => set('status', o.key)}
                      className={`rounded-full border px-3 py-1 text-[13px] transition ${
                        on
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>

        {/* Contact. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="טלפון">
            <input value={f.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" className={FIELD} />
          </Field>
          <Field label="אימייל">
            <input value={f.email} onChange={(e) => set('email', e.target.value)} dir="ltr" className={FIELD} />
          </Field>
        </div>

        {/* Role/type: team grouping + portal eligibility. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="צוות">
            <select value={f.teamRefId} onChange={(e) => set('teamRefId', e.target.value)} className={FIELD}>
              <option value="">— ללא —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="פורטל מדריך">
            <label
              className={`flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-[13px] ${
                inactive ? 'bg-gray-50 text-gray-400' : 'text-gray-700'
              }`}
            >
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={!inactive && f.portalEligible}
                disabled={inactive}
                onChange={(e) => set('portalEligible', e.target.checked)}
              />
              גישה לפורטל מדריך
            </label>
          </Field>
        </div>
        {inactive && (
          <p className="-mt-2 text-[11.5px] text-gray-400">איש צוות לא פעיל אינו מקבל גישה לפורטל.</p>
        )}

        {/* Bank details (optional) — same shared form as the profile card. */}
        <details className="rounded-lg border border-gray-200 px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-gray-600">פרטי בנק</summary>
          <div className="pt-3">
            <BankDetailsFields
              value={bank}
              banks={banks}
              onChange={(patch) => setBank((s) => ({ ...s, ...patch }))}
            />
          </div>
        </details>

        <Field label="הערה פנימית">
          <textarea
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className={`${FIELD} resize-none`}
          />
        </Field>

        {/* Inline conflict / error — no browser alerts. */}
        {conflict && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
            <div className="font-semibold">כבר קיים איש צוות עם פרטים אלה</div>
            <div className="mt-0.5 text-amber-800">
              התאמה לפי {conflict.matchedOn.includes('phone') ? 'טלפון' : ''}
              {conflict.matchedOn.length === 2 ? ' ו' : ''}
              {conflict.matchedOn.includes('email') ? 'אימייל' : ''} — {conflict.person?.displayName}.
            </div>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                navigate(`/admin/people/${conflict.person.id}`);
              }}
              className="mt-2 rounded-md bg-amber-600 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-amber-700"
            >
              פתיחת הכרטיס הקיים
            </button>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-700">{error}</div>
        )}
      </form>

      {cropState && (
        <AvatarCropDialog
          key={cropState.src}
          open
          src={cropState.src}
          saving={false}
          onCancel={() => setCropState(null)}
          onSave={onCropSave}
          onPickNew={(file) => setCropState({ src: URL.createObjectURL(file), originalFile: file })}
        />
      )}
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
