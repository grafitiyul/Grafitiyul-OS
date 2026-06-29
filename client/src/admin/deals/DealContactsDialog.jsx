import { useEffect, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import ContactEditDialog from './ContactEditDialog.jsx';
import QuickAddContactDialog from './QuickAddContactDialog.jsx';
import { api } from '../../lib/api.js';
import ContactPicker from '../crm/common/ContactPicker.jsx';
import { QUICK_CONTACT_ROLES, ROLE_LABELS, COMM_LANGS, contactNameHe } from './config.js';

// "אנשי קשר בדיל" — compact manager for a Deal's contacts. The DealContact link
// is the source of truth for role/primary ON THIS DEAL (works with or without an
// organization); the Contact is the source of truth for personal details
// (including communicationLanguage). Reuses ContactEditDialog (details),
// QuickAddContactDialog (create+link) and the existing APIs — no parallel logic.
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
              {contacts.map((dc) => (
                <ContactRow key={dc.id} dc={dc} act={act} onEditDetails={() => setEditContactId(dc.contactId)} />
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">אין אנשי קשר בדיל.</div>
          )}

          {/* Add existing + create new */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
            <div className="text-[12px] font-semibold text-gray-700">הוסף איש קשר לדיל</div>
            <div className="flex items-center gap-2">
              <ContactPicker contacts={available} value={addId} onChange={setAddId} />
              <button onClick={addExisting} disabled={!addId || adding} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
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

// One contact line. Roles collapse into a single compact control (dropdown);
// communication language (Contact-owned) is editable inline here too.
function ContactRow({ dc, act, onEditDetails }) {
  const c = dc.contact;
  const roles = dc.roles || [];
  const line = [c?.phones?.[0]?.value, c?.emails?.[0]?.value].filter(Boolean);
  const [roleMenu, setRoleMenu] = useState(false);
  const roleBtnRef = useRef(null);

  // Assignable roles = the operational quick set (which includes לקוח הקצה) plus any
  // legacy role already on this contact (so it stays removable). Deprecated roles are
  // not offered for new assignment. ONE toggle implementation — no duplicate logic.
  const assignable = [...QUICK_CONTACT_ROLES, ...roles.filter((r) => !QUICK_CONTACT_ROLES.includes(r))];

  function toggleRole(role) {
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
    act(() => api.deals.updateContact(dc.id, { roles: next }));
  }
  function setCommLang(lang) {
    // Contact-owned field — updated on the Contact, never copied to the Deal.
    act(() => api.contacts.update(dc.contactId, { communicationLanguage: lang || null }));
  }

  const roleSummary =
    roles.length === 0
      ? 'הוסף תפקיד'
      : `${ROLE_LABELS[roles[0]] || roles[0]}${roles.length > 1 ? ` +${roles.length - 1}` : ''}`;

  return (
    <li className="rounded-xl border border-gray-200 px-3.5 py-3">
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
        <button onClick={onEditDetails} className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2.5">
        {/* Compact role control — one badge summarising the roles; click to edit. */}
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400">תפקיד בדיל:</span>
          <button
            ref={roleBtnRef}
            type="button"
            onClick={() => setRoleMenu((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] border transition ${
              roles.length
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                : 'bg-white text-gray-500 border-dashed border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="truncate max-w-[12rem]">{roleSummary}</span>
            <span className="text-[9px] text-gray-400">▾</span>
          </button>
          <AnchoredMenu anchorRef={roleBtnRef} open={roleMenu} onClose={() => setRoleMenu(false)} width={208} align="start">
            <div className="px-3 py-1.5 text-[11px] text-gray-400">בחרו תפקיד אחד או יותר</div>
            {assignable.map((r) => {
              const on = roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRole(r)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-gray-50"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-transparent'}`}>✓</span>
                  <span className={on ? 'text-gray-900 font-medium' : 'text-gray-700'}>{ROLE_LABELS[r] || r}</span>
                </button>
              );
            })}
          </AnchoredMenu>
        </div>

        <span className="text-gray-200" aria-hidden>·</span>

        {/* Communication language — belongs to the Contact, edited inline here. */}
        <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
          <span>שפת תקשורת:</span>
          <select
            value={c?.communicationLanguage || ''}
            onChange={(e) => setCommLang(e.target.value)}
            className="h-7 rounded-md border border-gray-200 bg-white px-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">— ללא —</option>
            {COMM_LANGS.map((l) => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
