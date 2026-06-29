import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import ChannelSection from '../crm/common/ChannelSection.jsx';
import { OrgPicker, resolveOrganization } from '../crm/common/OrgPicker.jsx';
import { api } from '../../lib/api.js';
import { COMM_LANGS } from './config.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';

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
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Linked-organizations section (collapsible). Reuses the shared OrgPicker.
  const [orgs, setOrgs] = useState([]);
  const [types, setTypes] = useState([]);
  const [showOrgs, setShowOrgs] = useState(false);
  const [orgRes, setOrgRes] = useState(null);
  const [orgPickerKey, setOrgPickerKey] = useState(0);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const c = await api.contacts.get(contactId);
      setContact(c);
      const init = {
        firstNameHe: c.firstNameHe || '',
        lastNameHe: c.lastNameHe || '',
        firstNameEn: c.firstNameEn || '',
        lastNameEn: c.lastNameEn || '',
        notes: c.notes || '',
        communicationLanguage: c.communicationLanguage || '',
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      alert('שגיאה בטעינת איש הקשר: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Orgs + types for the OrgPicker (link/create an organization). Loaded once per open.
  useEffect(() => {
    if (!open) return;
    Promise.all([api.organizations.list(), api.organizationTypes.list()])
      .then(([o, t]) => { setOrgs(o); setTypes(t); })
      .catch(() => {});
  }, [open]);

  async function linkOrg() {
    if (linking || !orgRes || orgRes.invalid || (!orgRes.isExisting && !orgRes.isNew)) return;
    setLinking(true);
    try {
      const { organizationId } = await resolveOrganization(orgRes);
      if (organizationId) {
        await api.contacts.addOrganization(contactId, { organizationId });
        setOrgPickerKey((k) => k + 1); // reset the picker
        setOrgRes(null);
        await refreshAll();
      }
    } catch (e) {
      if (e.status === 409) alert('איש הקשר כבר מקושר לארגון זה.');
      else alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setLinking(false);
    }
  }
  async function unlinkOrg(linkId) {
    try {
      await api.contacts.removeOrganization(linkId);
      await refreshAll();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  // Unsaved-work guard (auto-update): dirty when the names/notes diverge from the
  // loaded values; clears on revert, on save (reload resets the baseline), or
  // when the dialog closes.
  useDirtyWhen(form, original, { active: open && !!form });

  // Refresh both the dialog's own contact AND the parent deal after a channel
  // mutation, so the header stays in sync.
  async function refreshAll() {
    await load();
    await onSaved?.();
  }

  async function saveNames() {
    if (!form.firstNameHe.trim() && !form.firstNameEn.trim()) {
      alert('יש להזין שם פרטי באחת השפות (עברית או אנגלית).');
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
              <Field label="שם פרטי (עברית)">
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
              <Field label="שפת תקשורת">
                <select value={form.communicationLanguage} onChange={(e) => set('communicationLanguage', e.target.value)} className={`${FIELD} bg-white`}>
                  <option value="">— ללא —</option>
                  {COMM_LANGS.map((l) => (<option key={l.key} value={l.key}>{l.label}</option>))}
                </select>
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
            onEditValue={(itemId, value) => api.contacts.updatePhone(itemId, { value })}
            onRemove={(itemId) => api.contacts.removePhone(itemId)}
            onReorder={(ids) => api.contacts.reorderPhones(contactId, ids)}
            onChange={refreshAll}
          />

          <ChannelSection
            title="כתובות אימייל"
            items={contact.emails}
            placeholder="אימייל"
            ltr
            onAdd={(value) => api.contacts.addEmail(contactId, { value })}
            onSetPrimary={(itemId) => api.contacts.updateEmail(itemId, { isPrimary: true })}
            onEditValue={(itemId, value) => api.contacts.updateEmail(itemId, { value })}
            onRemove={(itemId) => api.contacts.removeEmail(itemId)}
            onReorder={(ids) => api.contacts.reorderEmails(contactId, ids)}
            onChange={refreshAll}
          />

          {/* Collapsible: link/create the contact's organizations inline
              (reuses the shared OrgPicker — existing or new org). */}
          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <button type="button" onClick={() => setShowOrgs((o) => !o)} className="w-full flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-gray-900">
                ארגונים מקושרים
                {contact.orgLinks?.length ? (
                  <span className="ms-1 text-[11px] text-gray-400">({contact.orgLinks.length})</span>
                ) : null}
              </h2>
              <span className="text-gray-400 text-xs">{showOrgs ? '▾' : '▸'}</span>
            </button>
            {showOrgs && (
              <div className="mt-3 space-y-3">
                {contact.orgLinks?.length ? (
                  <ul className="divide-y divide-gray-100">
                    {contact.orgLinks.map((l) => (
                      <li key={l.id} className="py-2 flex items-center gap-2 text-sm">
                        <Link to={`/admin/crm/organizations/${l.organization.id}`} className="text-blue-700 hover:underline font-medium">
                          {l.organization.name}
                        </Link>
                        {l.organizationUnit && <span className="text-[12px] text-gray-500">· {l.organizationUnit.name}</span>}
                        {l.role && <span className="text-[12px] text-gray-400">· {l.role}</span>}
                        <div className="flex-1" />
                        <button onClick={() => unlinkOrg(l.id)} className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1">הסר</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-400">לא משויך לארגון.</div>
                )}
                <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                  <div className="text-[12px] font-semibold text-gray-700">קשר או צור ארגון</div>
                  <OrgPicker key={orgPickerKey} orgs={orgs} types={types} onResolve={setOrgRes} />
                  <div className="flex justify-end">
                    <button
                      onClick={linkOrg}
                      disabled={linking || !orgRes || orgRes.invalid || (!orgRes.isExisting && !orgRes.isNew)}
                      className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {linking ? 'מקשר…' : 'קשר ארגון'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="pt-1">
            <Link
              to={`/admin/crm/contacts/${contactId}`}
              className="text-[13px] text-gray-500 hover:text-gray-700 hover:underline"
            >
              פתח כרטיס איש קשר מלא ←
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
