import { useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import PhoneInput from '../../common/PhoneInput.jsx';
import { OrgPicker, resolveOrganization } from '../common/OrgPicker.jsx';
import { api } from '../../../lib/api.js';
import { contactNamesFromFull } from '../../../lib/nameSplit.js';

// Create a contact fast, like the Create Deal dialog but simpler: a single full
// name (split via the shared helper) + phone are required; email, notes and an
// organization are optional. Required at the API too: at least one first name in
// EITHER language + (client-side) a phone. Reuses the shared OrgPicker so an
// existing org links and a new org is created — no duplicate organization logic.
const FIELD =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function ContactCreateDialog({ orgs, types, subtypes, open, onClose, onCreated }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [orgRes, setOrgRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const ready = fullName.trim() && phone.trim() && !orgRes?.invalid;

  function reset() {
    setFullName(''); setPhone(''); setEmail(''); setNotes(''); setOrgRes(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Contact — split the single full name (Hebrew → He fields; Latin → En too).
      const contact = await api.contacts.create({
        ...contactNamesFromFull(fullName),
        notes: notes.trim() || undefined,
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
      size="md"
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
        <Field label="שם מלא *">
          <input
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="עברית או אנגלית — לדוגמה: ישראל ישראלי / John Smith"
            className={FIELD}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="טלפון *">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="אימייל">
            <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={FIELD} />
          </Field>
        </div>
        <Field label="הערות / תפקיד (אופציונלי)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
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
