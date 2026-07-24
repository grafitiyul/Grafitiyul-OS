import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { OrgPicker, resolveOrganization } from '../common/OrgPicker.jsx';
import BackButton from '../../common/BackButton.jsx';
import ChannelSection from '../common/ChannelSection.jsx';
import PhoneDisplay from '../../common/PhoneDisplay.jsx';
import WorkspaceLayout from '../../../shell/WorkspaceLayout.jsx';
import TimelineFeed from '../../common/timeline/TimelineFeed.jsx';
import ReservationLinkSection from './ReservationLinkSection.jsx';
import LegacyInfoCard from '../../common/LegacyInfoCard.jsx';
import FileEntryList from '../../common/files/FileEntryList.jsx';
import { useDirtyWhen } from '../../../lib/dirtyForms.js';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

// Contact detail — edit bilingual names, manage phones / emails / organization
// memberships, and see future communication sections as placeholders.
export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The org picker searches server-side — no catalog preload needed here.
      const c = await api.contacts.get(id);
      setContact(c);
      const init = {
        firstNameHe: c.firstNameHe,
        lastNameHe: c.lastNameHe,
        firstNameEn: c.firstNameEn,
        lastNameEn: c.lastNameEn,
        notes: c.notes || '',
      };
      setForm(init);
      setOriginal(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Unsaved-work guard (auto-update): dirty when names/notes diverge from the
  // loaded values; clears on revert and after save (refresh resets the baseline).
  useDirtyWhen(form, original, { active: !!form && !!original });

  async function save() {
    setSaving(true);
    try {
      await api.contacts.update(id, form);
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeContact() {
    if (!confirm('למחוק את איש הקשר?')) return;
    try {
      await api.contacts.remove(id);
      navigate('/admin/crm/contacts');
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!contact || !form) return null;

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  const fullName =
    `${contact.firstNameHe || ''} ${contact.lastNameHe || ''}`.trim() ||
    `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim() ||
    'איש קשר';
  const fullNameEn = `${contact.firstNameEn || ''} ${contact.lastNameEn || ''}`.trim();

  // RIGHT panel — the contact's static identity & relationships.
  const detailsPanel = (
    <div className="space-y-4">
      <Section title="פרטי איש קשר">
        <div className="grid grid-cols-2 gap-3">
          <Input label="שם פרטי (עברית)" value={form.firstNameHe} onChange={(v) => set('firstNameHe', v)} />
          <Input label="שם משפחה (עברית)" value={form.lastNameHe} onChange={(v) => set('lastNameHe', v)} />
          <Input label="First name (EN)" value={form.firstNameEn} onChange={(v) => set('firstNameEn', v)} ltr />
          <Input label="Last name (EN)" value={form.lastNameEn} onChange={(v) => set('lastNameEn', v)} ltr />
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-gray-500">אודות</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="תיאור קבוע על איש הקשר (לא היסטוריה — היסטוריה נכתבת בציר הזמן)"
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving} className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button onClick={removeContact} className="text-sm text-red-700 border border-red-300 rounded-md px-4 py-1.5 hover:bg-red-50">
            מחק
          </button>
        </div>
      </Section>

      <ChannelSection
        title="טלפונים"
        items={contact.phones}
        placeholder="מספר טלפון (ישראלי או בינלאומי, לדוגמה +44…)"
        ltr
        formatValue={(v) => <PhoneDisplay value={v} />}
        onAdd={(value) => api.contacts.addPhone(id, { value })}
        onSetPrimary={(itemId) => api.contacts.updatePhone(itemId, { isPrimary: true })}
        onEditValue={(itemId, value) => api.contacts.updatePhone(itemId, { value })}
        onRemove={(itemId) => api.contacts.removePhone(itemId)}
        onReorder={(ids) => api.contacts.reorderPhones(id, ids)}
        onChange={refresh}
      />

      <ChannelSection
        title="כתובות אימייל"
        items={contact.emails}
        placeholder="אימייל"
        ltr
        onAdd={(value) => api.contacts.addEmail(id, { value })}
        onSetPrimary={(itemId) => api.contacts.updateEmail(itemId, { isPrimary: true })}
        onEditValue={(itemId, value) => api.contacts.updateEmail(itemId, { value })}
        onRemove={(itemId) => api.contacts.removeEmail(itemId)}
        onReorder={(ids) => api.contacts.reorderEmails(id, ids)}
        onChange={refresh}
      />

      <MembershipsSection contact={contact} onChange={refresh} />

      {/* Remounts when memberships change so eligibility re-evaluates live. */}
      <ReservationLinkSection
        key={(contact.orgLinks || []).map((l) => l.id).join(',')}
        contactId={id}
      />

      {/* קבצים — the contact's view into the ONE unified Files system
          (system-generated canonical files, e.g. agent reservation
          summaries). Renders nothing while there are none. */}
      <ContactFilesSection contactId={id} />

      {/* מידע ממערכת קודמת — curated legacy data for migrated contacts.
          Renders nothing when the contact has no legacy records. */}
      <LegacyInfoCard entityType="Contact" entityId={id} />

      <Section title="מטא-דאטה">
        <dl className="space-y-1 text-[13px]">
          <Row label="נוצר" value={fmtDate(contact.createdAt)} />
          <Row label="עודכן" value={fmtDate(contact.updatedAt)} />
        </dl>
      </Section>
    </div>
  );

  // CENTER = the reusable Timeline, aggregating this contact's items + items from
  // the deals they're on (read-only, source-badged). RIGHT = details panel.
  return (
    <WorkspaceLayout
      storageKey="gos.workspace.contact"
      right={{ title: 'פרטי איש קשר', content: detailsPanel, defaultWidth: 420, minWidth: 320, maxWidth: 640 }}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <BackButton to="/admin/crm/contacts" label="חזרה לאנשי קשר" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 lg:p-5">
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900">{fullName}</h1>
        {fullNameEn && fullNameEn !== fullName && (
          <div className="text-sm text-gray-500 mt-0.5" dir="ltr">{fullNameEn}</div>
        )}
      </div>
      {/* Timeline is keyed by the contact CUID — the aggregate endpoint matches
          events + deal links by id, NOT by the numeric contactNo in the URL. The
          route param `id` is the contactNo, so passing it here would return an
          empty history (and hide the filed reservation-summary file event). This
          mirrors the same fix DealDetail applies (deal.id, not the orderNo). */}
      {contact?.id && <TimelineFeed subjectType="contact" subjectId={contact.id} aggregate />}
    </WorkspaceLayout>
  );
}

// קבצים — the contact's canonical files through the SAME unified Files list
// the Deal Files tab renders (FileEntryList; entry.source picks the scoped
// download door). No parallel browsing logic, no separate "documents"
// concept: today the entries are derived system files (agent reservation
// summaries); a future contact upload store slots into the same list.
function ContactFilesSection({ contactId }) {
  const [files, setFiles] = useState(null);

  useEffect(() => {
    let live = true;
    api.contacts
      .files(contactId)
      .then((d) => { if (live) setFiles(d); })
      .catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [contactId]);

  if (!files?.length) return null;
  return (
    <Section title="קבצים">
      <FileEntryList
        files={files}
        downloadHref={(f) => api.contacts.reservationDocumentUrl(contactId, f.id)}
      />
    </Section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 tabular-nums" dir="ltr">{value}</dd>
    </div>
  );
}

// Contact ↔ Organization memberships. The relationship is the JOIN model
// ContactOrganization: a contact may belong to MANY organizations, each link
// optionally scoped to a unit. Assignment affects FUTURE context (new deals'
// defaults, travel-agency link eligibility) — it never rewrites the
// organization on existing Deals (Deal.organizationId is stamped at deal
// creation and owned by the deal).
function MembershipsSection({ contact, onChange }) {
  const [types, setTypes] = useState([]);
  const [resolution, setResolution] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [unitCleared, setUnitCleared] = useState(false);
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null);
  const [formError, setFormError] = useState(null);
  // The canonical picker is uncontrolled — bump the key to reset after a save.
  const [pickerKey, setPickerKey] = useState(0);
  const prevOrgRef = useRef('');

  useEffect(() => {
    api.organizationTypes.list().then(setTypes).catch(() => setTypes([]));
  }, []);

  // Units follow the SELECTED org (existing orgs only — a new org has none).
  // Changing the org drops an incompatible unit and says so.
  const orgId = resolution?.existingOrgId || '';
  useEffect(() => {
    const orgChanged = prevOrgRef.current && prevOrgRef.current !== orgId;
    prevOrgRef.current = orgId;
    if (orgChanged && unitId) setUnitCleared(true);
    setUnitId('');
    setUnits([]);
    if (!orgId) return undefined;
    let live = true;
    api.organizations
      .get(orgId)
      .then((full) => { if (live) setUnits(full.units || []); })
      .catch(() => { if (live) setUnits([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const canSubmit =
    resolution && !resolution.invalid && (resolution.isExisting || resolution.isNew);

  async function add(e) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      // resolveOrganization = the canonical persistence path (creates an
      // inline-typed NEW org via the same API the dialog uses).
      const { organizationId } = await resolveOrganization(resolution);
      if (!organizationId) return;
      await api.contacts.addOrganization(contact.id, {
        organizationId,
        organizationUnitId: unitId || null,
        role: role.trim() || null,
      });
      setSuccess('הארגון שויך לאיש הקשר ✓');
      setTimeout(() => setSuccess(null), 3000);
      setPickerKey((k) => k + 1);
      setResolution(null);
      setUnitId('');
      setRole('');
      setUnitCleared(false);
      prevOrgRef.current = '';
      await onChange();
    } catch (err) {
      const code = err?.payload?.error;
      setFormError(
        code === 'membership_exists'
          ? 'איש הקשר כבר משויך לארגון הזה.'
          : code === 'unit_not_in_organization'
            ? 'היחידה שנבחרה אינה שייכת לארגון.'
            : 'שגיאה: ' + err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId) {
    try {
      await api.contacts.removeOrganization(linkId);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Section title="שיוך לארגונים">
      <div className="text-[12px] text-gray-500 mb-2">
        איש קשר יכול להיות משויך למספר ארגונים, ואופציונלית ליחידה ספציפית.
        השיוך משפיע על הקשרים עתידיים (וזכאות לקישור הזמנות) — לא על דילים קיימים.
      </div>
      {contact.orgLinks?.length ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {contact.orgLinks.map((l) => (
            <li key={l.id} className="py-2 flex items-center gap-2 text-sm">
              <Link
                to={`/admin/crm/organizations/${l.organization.orgNo ?? l.organization.id}`}
                className="text-blue-700 hover:underline"
              >
                {l.organization.name}
              </Link>
              {l.organizationUnit && (
                <span className="text-[12px] text-gray-500">· {l.organizationUnit.name}</span>
              )}
              {l.role && <span className="text-[12px] text-gray-400">· {l.role}</span>}
              <div className="flex-1" />
              <button
                onClick={() => remove(l.id)}
                className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1"
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">לא משויך לארגון.</div>
      )}

      <form onSubmit={add} className="space-y-3">
        {/* THE canonical org combobox: server-side search + "+ צור ארגון חדש". */}
        <OrgPicker
          key={pickerKey}
          serverSearch
          allowCreateDialog
          types={types}
          onResolve={setResolution}
        />

        {orgId && units.length > 0 && (
          <UnitPicker units={units} value={unitId} onChange={setUnitId} />
        )}
        {unitCleared && (
          <div className="rounded-md bg-amber-50 px-3 py-1.5 text-[12px] text-amber-800">
            היחידה שנבחרה נוקתה — היא אינה שייכת לארגון החדש.
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">תפקיד (אופציונלי)</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-40"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="bg-gray-800 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'משייך…' : 'שייך'}
          </button>
          {success && <span className="text-[13px] font-medium text-emerald-700">{success}</span>}
          {formError && <span className="text-[13px] text-red-600">{formError}</span>}
        </div>
      </form>
    </Section>
  );
}

// Searchable unit single-select — shown only when the selected organization
// HAS units; a foreign unit is impossible by construction (options come from
// the selected org) and rejected server-side regardless.
function UnitPicker({ units, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = units.find((u) => u.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q ? units.filter((u) => (u.name || '').toLowerCase().includes(q)) : units;

  return (
    <div className="relative max-w-xs">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-gray-500">יחידה (אופציונלי)</span>
        <span className="relative block">
          <input
            value={open ? query : selected?.name || ''}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { setOpen(true); setQuery(''); }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder="חיפוש יחידה…"
            autoComplete="off"
            className={
              'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400' +
              (selected ? ' pe-8' : '')
            }
          />
          {selected && !open && (
            <button
              type="button"
              onClick={() => onChange('')}
              title="נקה יחידה"
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </span>
      </label>
      {open && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-44 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-gray-400">לא נמצאו יחידות תואמות.</li>
          ) : (
            filtered.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(u.id); setOpen(false); }}
                  className={`block w-full text-right px-3 py-2 text-sm hover:bg-blue-50 ${
                    u.id === value ? 'bg-blue-50 font-medium' : ''
                  }`}
                >
                  {u.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Input({ label, value, onChange, ltr }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? 'ltr' : 'rtl'}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
      />
    </div>
  );
}
