import { useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import PhoneInput from '../../common/PhoneInput.jsx';
import { OrgPicker, resolveOrganization } from '../common/OrgPicker.jsx';
import { api } from '../../../lib/api.js';
import { contactNamesFromParts } from '../../../lib/nameSplit.js';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

// Empty baseline — the dialog is "dirty" only once a field diverges from this.
const EMPTY = { firstName: '', lastName: '', phone: '', email: '', role: '', notes: '', org: false };

// Create a contact fast, like the Create Deal dialog but simpler: a first name +
// phone are required; last name, email, notes and an organization are optional.
// The name fields auto-route by script — Hebrew goes to the Hebrew columns,
// Latin to the English ones, with no duplication across languages. The API only
// needs a first name in EITHER language. Reuses the shared OrgPicker so an
// existing org links and a new org is created — no duplicate organization logic.
const FIELD =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function ContactCreateDialog({ orgs, types, subtypes, open, onClose, onCreated }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [orgRes, setOrgRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const ready = firstName.trim() && phone.trim() && !orgRes?.invalid;

  // Unsaved-work guard (auto-update): dirty once any field is touched; clears when
  // reverted to empty, on successful create (reset), or when the dialog closes.
  useDirtyWhen(
    { firstName, lastName, phone, email, role, notes, org: !!orgRes },
    EMPTY,
    { active: open },
  );

  function reset() {
    setFirstName(''); setLastName(''); setPhone(''); setEmail(''); setRole(''); setNotes(''); setOrgRes(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Contact — route names by script (Hebrew → He fields; Latin → En fields),
      // never duplicating into the other language. Role + internal note both live
      // on the contact card (the only free-text store): a standalone contact has
      // no deal to carry an operational role, so the role is captured as text.
      const composedNotes = [
        role.trim() && `תפקיד: ${role.trim()}`,
        notes.trim(),
      ].filter(Boolean).join('\n');
      const contact = await api.contacts.create({
        ...contactNamesFromParts(firstName, lastName),
        notes: composedNotes || undefined,
      });
      await api.contacts.addPhone(contact.id, { value: phone.trim(), isPrimary: true });
      if (email.trim()) {
        await api.contacts.addEmail(contact.id, { value: email.trim(), isPrimary: true });
      }

      // Optional organization — same resolver as Create Deal (existing | new).
      const { organizationId } = await resolveOrganization(orgRes);
      if (organizationId) {
        await api.contacts.addOrganization(contact.id, { organizationId, isPrimary: true });
      }

      reset();
      await onCreated?.(contact);
      onClose?.();
    } catch (e) {
      alert('שגיאה ביצירת איש קשר: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="איש קשר חדש"
      size="md-wide"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            ביטול
          </button>
          <button type="submit" form="contact-create" disabled={!ready || busy} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
            {busy ? 'יוצר…' : 'צור איש קשר'}
          </button>
        </>
      }
    >
      <form id="contact-create" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="שם פרטי *">
            <input
              autoFocus
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="עברית או אנגלית"
              className={FIELD}
            />
          </Field>
          <Field label="שם משפחה">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="אופציונלי"
              className={FIELD}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="טלפון *">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="אימייל">
            <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={FIELD} />
          </Field>
        </div>
        <Field label="תפקיד (אופציונלי)">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="לדוגמה: מנהל רכש"
            className={FIELD}
          />
        </Field>
        <Field label="הערה פנימית (אופציונלי)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <span className="text-[11px] text-gray-400">הערה זו נשמרת בכרטיס איש הקשר.</span>
        </Field>

        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <div className="text-[13px] font-semibold text-gray-700 mb-2">ארגון (אופציונלי)</div>
          <OrgPicker orgs={orgs} types={types} subtypes={subtypes} onResolve={setOrgRes} />
        </div>
      </form>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      {children}
    </label>
  );
}
