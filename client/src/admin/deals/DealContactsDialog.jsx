import { useEffect, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import ContactEditDialog from './ContactEditDialog.jsx';
import QuickAddContactDialog from './QuickAddContactDialog.jsx';
import { api } from '../../lib/api.js';
import { QUICK_CONTACT_ROLES, ROLE_LABELS, contactNameHe } from './config.js';

// "אנשי קשר בדיל" — compact manager for a Deal's contacts. The DealContact link
// is the source of truth for role/primary ON THIS DEAL (works with or without an
// organization); the Contact is the source of truth for personal details. Reuses
// ContactEditDialog (details), QuickAddContactDialog (create+link) and the
// existing deal-contact APIs — no parallel logic.
function fullName(c) {
  return (
    contactNameHe(c) ||
    `${c?.firstNameEn || ''} ${c?.lastNameEn || ''}`.trim() ||
    '—'
  );
}

export default function DealContactsDialog({ deal, open, onClose, onChanged }) {
  const [allContacts, setAllContacts] = useState([]);
  const [addId, setAddId] = useState('');
  const [adding, setAdding] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editContactId, setEditContactId] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.contacts.list().then(setAllContacts).catch(() => {});
  }, [open, deal]);

  const contacts = deal.contacts || [];
  const linkedIds = new Set(contacts.map((dc) => dc.contactId));
  const available = allContacts.filter((c) => !linkedIds.has(c.id));

  async function act(fn) {
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function toggleRole(dc, role) {
    const roles = dc.roles?.includes(role)
      ? dc.roles.filter((r) => r !== role)
      : [...(dc.roles || []), role];
    await act(() => api.deals.updateContact(dc.id, { roles }));
  }

  async function addExisting() {
    if (!addId || adding) return;
    setAdding(true);
    try {
      await api.deals.addContact(deal.id, { contactId: addId, isPrimary: contacts.length === 0 });
      setAddId('');
      await onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setAdding(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="אנשי קשר בדיל"
        size="lg"
        footer={
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50">
            סגור
          </button>
        }
      >
        <div className="space-y-3">
          {contacts.length ? (
            <ul className="space-y-2">
              {contacts.map((dc) => {
                const c = dc.contact;
                const line = [c?.phones?.[0]?.value, c?.emails?.[0]?.value].filter(Boolean);
                return (
                  <li key={dc.id} className="rounded-xl border border-gray-200 px-3.5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {dc.isPrimary ? (
                        <span className="text-amber-500" title="איש קשר ראשי">★</span>
                      ) : (
                        <button
                          onClick={() => act(() => api.deals.updateContact(dc.id, { isPrimary: true }))}
                          title="הפוך לראשי"
                          className="text-gray-300 hover:text-amber-500"
                        >
                          ☆
                        </button>
                      )}
                      <span className="font-semibold text-gray-900">{fullName(c)}</span>
                      {line.length > 0 && (
                        <span className="text-[12px] text-gray-400" dir="ltr">{line.join(' · ')}</span>
                      )}
                      <div className="flex-1" />
                      <button onClick={() => setEditContactId(dc.contactId)} className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">
                        פרטים
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('להסיר את איש הקשר מהדיל?')) act(() => api.deals.removeContact(dc.id));
                        }}
                        className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
                      >
                        הסר מהדיל
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-[11px] text-gray-400">תפקיד בדיל:</span>
                      {QUICK_CONTACT_ROLES.map((r) => {
                        const on = dc.roles?.includes(r);
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => toggleRole(dc, r)}
                            className={`rounded-full px-2.5 py-0.5 text-[12px] border transition ${
                              on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {ROLE_LABELS[r]}
                          </button>
                        );
                      })}
                      {/* Any non-quick roles already on the link, shown read-only. */}
                      {(dc.roles || [])
                        .filter((r) => !QUICK_CONTACT_ROLES.includes(r))
                        .map((r) => (
                          <span key={r} className="rounded-full px-2 py-0.5 text-[11px] bg-gray-100 text-gray-600">
                            {ROLE_LABELS[r] || r}
                          </span>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">אין אנשי קשר בדיל.</div>
          )}

          {/* Add existing + create new */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
            <div className="text-[12px] font-semibold text-gray-700">הוסף איש קשר לדיל</div>
            <div className="flex items-center gap-2">
              <select value={addId} onChange={(e) => setAddId(e.target.value)} className="flex-1 h-9 rounded-md border border-gray-300 bg-white px-2 text-sm">
                <option value="">בחר איש קשר קיים…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullNameHe || c.fullNameEn || c.id}</option>
                ))}
              </select>
              <button onClick={addExisting} disabled={!addId || adding} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {adding ? 'מוסיף…' : 'הוסף'}
              </button>
            </div>
            <button onClick={() => setCreateOpen(true)} className="text-[13px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">
              + צור איש קשר חדש
            </button>
          </div>
        </div>
      </Dialog>

      {/* Per-contact personal details — reuses the shared editor. */}
      <ContactEditDialog
        contactId={editContactId}
        open={!!editContactId}
        onClose={() => setEditContactId(null)}
        onSaved={onChanged}
      />
      {/* Create + link a brand-new contact — reuses the shared quick-add. */}
      <QuickAddContactDialog
        dealId={deal.id}
        open={createOpen}
        makePrimary={contacts.length === 0}
        onClose={() => setCreateOpen(false)}
        onAdded={onChanged}
      />
    </>
  );
}
