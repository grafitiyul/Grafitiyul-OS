import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import ChannelSection from '../crm/common/ChannelSection.jsx';
import { api } from '../../lib/api.js';

// Edit an existing contact from the Deal header — reuses the SAME building blocks
// as the full Contact page (shared ChannelSection for phones/emails; the same
// contacts API). The names + notes block has an explicit Save button and does
// NOT autosave. Phones/emails are explicit per-item add/remove actions.
//
// onSaved() is called after any change so the parent (Deal) can refresh and
// reflect the new primary name/phone/email in the header.
const FIELD =
  'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';

export default function ContactEditDialog({ contactId, open, onClose, onSaved }) {
  const [contact, setContact] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const c = await api.contacts.get(contactId);
      setContact(c);
      setForm({
        firstNameHe: c.firstNameHe || '',
        lastNameHe: c.lastNameHe || '',
        firstNameEn: c.firstNameEn || '',
        lastNameEn: c.lastNameEn || '',
        notes: c.notes || '',
      });
    } catch (e) {
      alert('שגיאה בטעינת איש הקשר: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  // Refresh both the dialog's own contact AND the parent deal after a channel
  // mutation, so the header stays in sync.
  async function refreshAll() {
    await load();
    await onSaved?.();
  }

  async function saveNames() {
    if (!form.firstNameHe.trim()) {
      alert('שם פרטי (עברית) הוא שדה חובה.');
      return;
    }
    setSaving(true);
    try {
      await api.contacts.update(contactId, form);
      await refreshAll();
    } catch (e) {
      alert('שגיאה בשמירה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="עריכת איש קשר" size="lg">
      {loading || !form ? (
        <div className="text-sm text-gray-400 py-6 text-center">טוען…</div>
      ) : (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-3">פרטי איש קשר</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="שם פרטי (עברית) *">
                <input value={form.firstNameHe} onChange={(e) => set('firstNameHe', e.target.value)} className={FIELD} />
              </Field>
              <Field label="שם משפחה (עברית)">
                <input value={form.lastNameHe} onChange={(e) => set('lastNameHe', e.target.value)} className={FIELD} />
              </Field>
              <Field label="First name (EN)">
                <input value={form.firstNameEn} onChange={(e) => set('firstNameEn', e.target.value)} dir="ltr" className={FIELD} />
              </Field>
              <Field label="Last name (EN)">
                <input value={form.lastNameEn} onChange={(e) => set('lastNameEn', e.target.value)} dir="ltr" className={FIELD} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="הערות">
                <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={FIELD} />
              </Field>
            </div>
            <div className="mt-3">
              <button
                onClick={saveNames}
                disabled={saving}
                className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
              >
                {saving ? 'שומר…' : 'שמור פרטים'}
              </button>
            </div>
          </section>

          <ChannelSection
            title="טלפונים"
            items={contact.phones}
            placeholder="מספר טלפון"
            ltr
            onAdd={(value) => api.contacts.addPhone(contactId, { value })}
            onSetPrimary={(itemId) => api.contacts.updatePhone(itemId, { isPrimary: true })}
            onRemove={(itemId) => api.contacts.removePhone(itemId)}
            onChange={refreshAll}
          />

          <ChannelSection
            title="כתובות אימייל"
            items={contact.emails}
            placeholder="אימייל"
            ltr
            onAdd={(value) => api.contacts.addEmail(contactId, { value })}
            onSetPrimary={(itemId) => api.contacts.updateEmail(itemId, { isPrimary: true })}
            onRemove={(itemId) => api.contacts.removeEmail(itemId)}
            onChange={refreshAll}
          />

          <div className="pt-1">
            <Link
              to={`/admin/crm/contacts/${contactId}`}
              className="text-[13px] text-blue-700 hover:underline"
            >
              פתח כרטיס איש קשר מלא (שיוך לארגונים ועוד) ←
            </Link>
          </div>
        </div>
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
