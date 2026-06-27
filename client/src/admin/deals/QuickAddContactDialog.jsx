import { useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { contactNamesFromParts } from '../../lib/nameSplit.js';
import { QUICK_CONTACT_ROLES, ROLE_LABELS } from './config.js';

// Fast "add contact" from the Deal header: create a new contact (name + phone),
// then link it to the deal with a single operational role — all via the EXISTING
// contacts + deals APIs (no new CRUD). Only first name + phone are required;
// everything else (English names, more phones/emails, multiple roles) can be
// completed later in the contact dialog / full contact page.
//
//   makePrimary  link as the deal's primary contact (true for the first contact)
const FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';

export default function QuickAddContactDialog({ dealId, open, onClose, onAdded, makePrimary }) {
  const [f, setF] = useState({ first: '', last: '', phone: '', email: '', role: '' });
  const [busy, setBusy] = useState(false);

  function set(k, v) {
    setF((s) => ({ ...s, [k]: v }));
  }

  function reset() {
    setF({ first: '', last: '', phone: '', email: '', role: '' });
  }

  const ready = f.first.trim() && f.phone.trim();

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      // 1) Create the contact. Names route by script (Hebrew → He fields, Latin
      //    → En fields) with no cross-language duplication; the API accepts a
      //    first name in either language. The rest is editable later.
      const contact = await api.contacts.create(contactNamesFromParts(f.first, f.last));
      // 2) Channels — primary phone (required) + optional email.
      await api.contacts.addPhone(contact.id, { value: f.phone.trim(), isPrimary: true });
      if (f.email.trim()) {
        await api.contacts.addEmail(contact.id, { value: f.email.trim(), isPrimary: true });
      }
      // 3) Link to the deal with the chosen operational role.
      await api.deals.addContact(dealId, {
        contactId: contact.id,
        roles: f.role ? [f.role] : [],
        isPrimary: !!makePrimary,
      });
      reset();
      await onAdded?.();
      onClose?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="הוסף איש קשר"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            type="submit"
            form="quick-add-contact"
            disabled={!ready || busy}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'מוסיף…' : 'הוסף לדיל'}
          </button>
        </>
      }
    >
      <form id="quick-add-contact" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="שם פרטי *">
            <input autoFocus value={f.first} onChange={(e) => set('first', e.target.value)} className={FIELD} />
          </Field>
          <Field label="שם משפחה">
            <input value={f.last} onChange={(e) => set('last', e.target.value)} className={FIELD} />
          </Field>
          <Field label="טלפון *">
            <input value={f.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" className={FIELD} />
          </Field>
          <Field label="אימייל">
            <input value={f.email} onChange={(e) => set('email', e.target.value)} dir="ltr" className={FIELD} />
          </Field>
        </div>
        <Field label="תפקיד">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CONTACT_ROLES.map((r) => {
              const on = f.role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => set('role', on ? '' : r)}
                  className={`rounded-full px-3 py-1 text-[13px] border transition ${
                    on
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
        </Field>
      </form>
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
