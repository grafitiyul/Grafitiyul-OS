import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatMinor, minorToInput, toMinor } from '../../lib/money.js';
import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_STYLES,
  ROLE_ORDER,
  ROLE_LABELS,
  PREF_FIELDS,
  contactNameHe,
} from './config.js';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [stages, setStages] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [units, setUnits] = useState([]);
  const [allContacts, setAllContacts] = useState([]);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [d, s, o, st, c] = await Promise.all([
        api.deals.get(id),
        api.dealStages.list(),
        api.organizations.list(),
        api.organizationSubtypes.list(),
        api.contacts.list(),
      ]);
      setDeal(d);
      setStages(s);
      setOrgs(o);
      setSubtypes(st);
      setAllContacts(c);
      setForm({
        title: d.title || '',
        value: minorToInput(d.valueMinor),
        discount: minorToInput(d.discountMinor),
        paymentTerms: d.paymentTerms || '',
        source: d.source || '',
        dealStageId: d.dealStageId || '',
        expectedCloseDate: d.expectedCloseDate
          ? d.expectedCloseDate.slice(0, 10)
          : '',
        notes: d.notes || '',
        organizationId: d.organizationId || '',
        organizationUnitId: d.organizationUnitId || '',
        organizationSubtypeId: d.organizationSubtypeId || '',
      });
      if (d.organizationId) {
        const full = await api.organizations.get(d.organizationId);
        setUnits(full.units || []);
      } else {
        setUnits([]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  async function chooseOrg(orgId) {
    setForm((f) => ({ ...f, organizationId: orgId, organizationUnitId: '' }));
    if (orgId) {
      try {
        const full = await api.organizations.get(orgId);
        setUnits(full.units || []);
      } catch {
        setUnits([]);
      }
    } else {
      setUnits([]);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.deals.update(id, {
        title: form.title,
        valueMinor: toMinor(form.value) ?? 0,
        discountMinor: toMinor(form.discount),
        paymentTerms: form.paymentTerms,
        source: form.source,
        dealStageId: form.dealStageId,
        expectedCloseDate: form.expectedCloseDate || null,
        notes: form.notes,
        organizationId: form.organizationId || null,
        organizationUnitId: form.organizationUnitId || null,
        organizationSubtypeId: form.organizationSubtypeId || null,
      });
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status) {
    let lostReason;
    if (status === 'lost') {
      lostReason = prompt('סיבת אובדן הדיל (אופציונלי):') || null;
    }
    try {
      await api.deals.update(id, { status, lostReason });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  async function removeDeal() {
    if (!confirm('למחוק את הדיל? אנשי הקשר המקושרים יוסרו מהדיל.')) return;
    try {
      await api.deals.remove(id);
      navigate('/admin/crm/deals');
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">טוען…</div>;
  if (error)
    return (
      <div className="p-8 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!deal || !form) return null;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/crm/deals" className="text-blue-700 hover:underline text-[13px]">
          ← דילים
        </Link>
        <div className="flex-1" />
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
            DEAL_STATUS_STYLES[deal.status] || ''
          }`}
        >
          {DEAL_STATUS_LABELS[deal.status]}
        </span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {deal.title}
        </h1>
        <div className="text-[15px] text-gray-500 mt-1 tabular-nums" dir="ltr">
          {formatMinor(deal.valueMinor, deal.currency)}
        </div>
      </div>

      {/* Outcome actions */}
      <div className="flex flex-wrap gap-2">
        {deal.status !== 'won' && (
          <button
            onClick={() => setStatus('won')}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            סמן כ-WON
          </button>
        )}
        {deal.status !== 'lost' && (
          <button
            onClick={() => setStatus('lost')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            סמן כ-LOST
          </button>
        )}
        {deal.status !== 'open' && (
          <button
            onClick={() => setStatus('open')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            החזר ל-OPEN
          </button>
        )}
      </div>

      {/* Commercial details */}
      <Section title="פרטי הדיל">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldBox label="כותרת">
            <input value={form.title} onChange={(e) => set('title', e.target.value)} className={INPUT} />
          </FieldBox>
          <FieldBox label="שלב">
            <select value={form.dealStageId} onChange={(e) => set('dealStageId', e.target.value)} className={`${INPUT} bg-white`}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label="שווי (₪)">
            <input value={form.value} onChange={(e) => set('value', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} />
          </FieldBox>
          <FieldBox label="הנחה (₪)">
            <input value={form.discount} onChange={(e) => set('discount', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} />
          </FieldBox>
          <FieldBox label="תנאי תשלום">
            <input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="שוטף + 30 וכו'" className={INPUT} />
          </FieldBox>
          <FieldBox label="מקור">
            <input value={form.source} onChange={(e) => set('source', e.target.value)} className={INPUT} />
          </FieldBox>
          <FieldBox label="צפי סגירה">
            <input type="date" value={form.expectedCloseDate} onChange={(e) => set('expectedCloseDate', e.target.value)} dir="ltr" className={INPUT} />
          </FieldBox>
        </div>
        <div className="mt-3">
          <label className="text-[11px] text-gray-500">הערות</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </div>
      </Section>

      {/* Org / unit / subtype */}
      <Section title="שיוך ארגוני">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FieldBox label="ארגון">
            <select value={form.organizationId} onChange={(e) => chooseOrg(e.target.value)} className={`${INPUT} bg-white`}>
              <option value="">— ללא —</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label="יחידה">
            <select value={form.organizationUnitId} onChange={(e) => set('organizationUnitId', e.target.value)} disabled={!units.length} className={`${INPUT} bg-white disabled:bg-gray-100`}>
              <option value="">— ללא —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </FieldBox>
          <FieldBox label="תת-סוג (של הדיל)">
            <select value={form.organizationSubtypeId} onChange={(e) => set('organizationSubtypeId', e.target.value)} className={`${INPUT} bg-white`}>
              <option value="">— ללא —</option>
              {subtypes.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </FieldBox>
        </div>
      </Section>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר…' : 'שמור שינויים'}
        </button>
        <button onClick={removeDeal} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
          מחק דיל
        </button>
      </div>

      <DealContactsSection deal={deal} allContacts={allContacts} onChange={refresh} />

      {/* Future modules — placeholders */}
      <Section title="הצעות מחיר, תשלומים, סיורים ופעילות (בקרוב)">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Placeholder title="הצעות מחיר" />
          <Placeholder title="תשלומים וגבייה" />
          <Placeholder title="סיורים" />
          <Placeholder title="פעילויות" />
        </div>
      </Section>
    </div>
  );
}

// ── Deal contacts ───────────────────────────────────────────────────

function DealContactsSection({ deal, allContacts, onChange }) {
  const [adding, setAdding] = useState(false);
  const linkedIds = new Set(deal.contacts.map((dc) => dc.contactId));
  const available = allContacts.filter((c) => !linkedIds.has(c.id));

  return (
    <Section title={`אנשי קשר בדיל (${deal.contacts.length})`}>
      {deal.contacts.length ? (
        <ul className="space-y-2 mb-3">
          {deal.contacts.map((dc) => (
            <DealContactRow key={dc.id} dc={dc} onChange={onChange} />
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-400 mb-3">אין אנשי קשר מקושרים לדיל.</div>
      )}

      {adding ? (
        <AddContactForm
          available={available}
          dealId={deal.id}
          onDone={() => {
            setAdding(false);
            onChange();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={available.length === 0}
          className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          title={available.length === 0 ? 'כל אנשי הקשר כבר מקושרים' : ''}
        >
          + הוסף איש קשר
        </button>
      )}
    </Section>
  );
}

function DealContactRow({ dc, onChange }) {
  const [editing, setEditing] = useState(false);
  const c = dc.contact;

  async function remove() {
    if (!confirm('להסיר את איש הקשר מהדיל?')) return;
    try {
      await api.deals.removeContact(dc.id);
      await onChange();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  if (editing) {
    return (
      <li>
        <ContactPrefsEditor
          initial={dc}
          name={contactNameHe(c)}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            await api.deals.updateContact(dc.id, patch);
            setEditing(false);
            await onChange();
          }}
        />
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-gray-200 px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {dc.isPrimary && <span className="text-amber-500" title="ראשי">★</span>}
        <span className="font-medium text-gray-900">{contactNameHe(c)}</span>
        <span className="text-[12px] text-gray-400" dir="ltr">
          {c?.phones?.[0]?.value || c?.emails?.[0]?.value || ''}
        </span>
        <div className="flex-1" />
        <button onClick={() => setEditing(true)} className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">
          עריכה
        </button>
        <button onClick={remove} className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1">
          הסר
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {dc.roles?.length ? (
          dc.roles.map((r) => (
            <span key={r} className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-100">
              {ROLE_LABELS[r] || r}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-gray-400">ללא תפקיד</span>
        )}
        <span className="text-gray-300">·</span>
        {PREF_FIELDS.filter((p) => dc[p.key]).map((p) => (
          <span key={p.key} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
            {p.label}
          </span>
        ))}
      </div>
    </li>
  );
}

function AddContactForm({ available, dealId, onDone, onCancel }) {
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    roles: [],
    isPrimary: false,
    receiveConfirmations: false,
    receiveOperationalUpdates: false,
    receivePaymentLinks: false,
    receiveQuotes: false,
  });

  async function submit(e) {
    e.preventDefault();
    if (!contactId) return;
    setBusy(true);
    try {
      await api.deals.addContact(dealId, { contactId, ...draft });
      onDone();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
      <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={`${INPUT} bg-white`}>
        <option value="">בחר איש קשר…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>{contactNameHe(c)}</option>
        ))}
      </select>
      <RolesAndPrefs draft={draft} setDraft={setDraft} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !contactId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'מוסיף…' : 'הוסף לדיל'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-white">
          ביטול
        </button>
      </div>
    </form>
  );
}

function ContactPrefsEditor({ initial, name, onSave, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    roles: initial.roles || [],
    isPrimary: !!initial.isPrimary,
    receiveConfirmations: !!initial.receiveConfirmations,
    receiveOperationalUpdates: !!initial.receiveOperationalUpdates,
    receivePaymentLinks: !!initial.receivePaymentLinks,
    receiveQuotes: !!initial.receiveQuotes,
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(draft);
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
      <div className="font-medium text-gray-900">{name}</div>
      <RolesAndPrefs draft={draft} setDraft={setDraft} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-white">
          ביטול
        </button>
      </div>
    </form>
  );
}

function RolesAndPrefs({ draft, setDraft }) {
  function toggleRole(r) {
    setDraft((d) => ({
      ...d,
      roles: d.roles.includes(r)
        ? d.roles.filter((x) => x !== r)
        : [...d.roles, r],
    }));
  }
  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-[11px] text-gray-500 mb-1">תפקידים</div>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_ORDER.map((r) => {
            const on = draft.roles.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={`rounded-full px-2.5 py-1 text-[12px] border transition ${
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
      </div>
      <div>
        <div className="text-[11px] text-gray-500 mb-1">העדפות תקשורת</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {PREF_FIELDS.map((p) => (
            <label key={p.key} className="flex items-center gap-1.5 text-[13px] text-gray-700">
              <input
                type="checkbox"
                checked={!!draft[p.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.checked }))}
                className="rounded border-gray-300"
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[13px] text-gray-700">
        <input
          type="checkbox"
          checked={!!draft.isPrimary}
          onChange={(e) => setDraft((d) => ({ ...d, isPrimary: e.target.checked }))}
          className="rounded border-gray-300"
        />
        איש קשר ראשי בדיל
      </label>
    </div>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 className="text-[15px] font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}
function FieldBox({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
function Placeholder({ title }) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 text-center">
      <div className="text-[13px] font-semibold text-gray-500">{title}</div>
      <div className="text-[11px] text-gray-400 mt-1">בקרוב</div>
    </div>
  );
}
