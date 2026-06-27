import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import LostDealDialog from './LostDealDialog.jsx';
import { minorToInput, toMinor } from '../../lib/money.js';
import {
  DEAL_STATUS_LABELS,
  ROLE_ORDER,
  ROLE_LABELS,
  PREF_FIELDS,
  contactNameHe,
} from './config.js';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Per-status visual theme. OPEN is intentionally a muted/soft blue (not strong),
// WON green, LOST red. Used for the status buttons and the header pipeline.
const STATUS_THEME = {
  open: {
    solid: 'bg-blue-500 hover:bg-blue-600 text-white',
    soft: 'bg-blue-50 text-blue-600 ring-blue-100',
  },
  won: {
    solid: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  lost: {
    solid: 'bg-red-600 hover:bg-red-700 text-white',
    soft: 'bg-red-50 text-red-700 ring-red-200',
  },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

// Deal detail — a full-width CRM workspace, not a centered form. A hero header
// (live business object: title, status, stage, value, primary actions) over a
// two-column layout: main column (overview / organization / contacts / future
// activity) and a secondary column (commercial / dates / notes / metadata).
// The title is inline-editable in the hero; every other section saves itself
// with its own local שמור button (no confusing global header save).
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
  const [savingSection, setSavingSection] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

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
        currency: d.currency || 'ILS',
        paymentTerms: d.paymentTerms || '',
        source: d.source || '',
        dealStageId: d.dealStageId || '',
        expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
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

  // No global header save anymore — each section saves itself with a local
  // button. saveSection sends ONLY that section's fields, then refreshes.
  async function saveSection(key, payload) {
    setSavingSection(key);
    try {
      await api.deals.update(id, payload);
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSavingSection(null);
    }
  }

  async function setStatus(status) {
    // LOST goes through the in-system modal (required reason + optional notes).
    if (status === 'lost') {
      setLostOpen(true);
      return;
    }
    try {
      await api.deals.update(id, { status });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  async function confirmLost({ lostReasonId, lostNotes }) {
    try {
      await api.deals.update(id, { status: 'lost', lostReasonId, lostNotes });
      setLostOpen(false);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  // Inline title editing — saves the title field only, preserving all other
  // saved values. The card field + hero stay in sync via refresh().
  function startTitleEdit() {
    setTitleDraft(deal.title || '');
    setEditingTitle(true);
  }

  async function saveTitle() {
    const t = titleDraft.trim();
    if (!t || t === deal.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      await api.deals.update(id, { title: t });
      await refresh();
      setEditingTitle(false);
    } catch (e) {
      alert('שגיאה בשמירת הכותרת: ' + (e.payload?.error || e.message));
    } finally {
      setSavingTitle(false);
    }
  }

  async function removeDeal() {
    try {
      await api.deals.remove(id);
      navigate('/admin/crm/deals');
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  async function duplicateDeal() {
    try {
      const copy = await api.deals.create({
        title: `${deal.title} (עותק)`,
        dealStageId: deal.dealStageId || undefined,
        organizationId: deal.organizationId || null,
        organizationUnitId: deal.organizationUnitId || null,
        organizationSubtypeId: deal.organizationSubtypeId || null,
        valueMinor: minorToInput(deal.valueMinor),
        discountMinor: minorToInput(deal.discountMinor),
        currency: deal.currency || 'ILS',
        paymentTerms: deal.paymentTerms || null,
        source: deal.source || null,
        expectedCloseDate: deal.expectedCloseDate || null,
        notes: deal.notes || null,
      });
      navigate(`/admin/crm/deals/${copy.id}`);
    } catch (e) {
      alert('שגיאה בשכפול: ' + (e.payload?.error || e.message));
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

  const theme = STATUS_THEME[deal.status] || STATUS_THEME.open;

  return (
    <div className="mx-auto max-w-[1500px] px-5 lg:px-8 py-6">
      {/* Hero header — the live business object */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveTitle();
                    } else if (e.key === 'Escape') {
                      setEditingTitle(false);
                    }
                  }}
                  disabled={savingTitle}
                  className="text-2xl lg:text-3xl font-bold tracking-tight text-gray-900 border-b-2 border-blue-400 focus:outline-none px-0.5 min-w-[12rem] disabled:opacity-60"
                />
              ) : (
                <h1
                  onClick={startTitleEdit}
                  title="לחצו לעריכת הכותרת"
                  className="text-2xl lg:text-3xl font-bold tracking-tight text-gray-900 cursor-text rounded px-1 -mx-1 hover:bg-gray-50"
                >
                  {deal.title}
                </h1>
              )}
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset ${theme.soft}`}>
                {DEAL_STATUS_LABELS[deal.status]}
              </span>
            </div>

            {/* Pipeline bar — RTL connected segments, colored by deal status */}
            <div className="mt-3">
              <StagePipeline stages={stages} currentStageId={deal.dealStageId} status={deal.status} />
              {deal.organization && (
                <div className="mt-2 text-sm text-gray-500">{deal.organization.name}</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* OPEN → offer WON / LOST. WON or LOST → a single white REOPEN.
                All three route through the one setStatus() flow. */}
            {deal.status === 'open' ? (
              <>
                <button onClick={() => setStatus('won')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${STATUS_THEME.won.solid}`}>
                  WON
                </button>
                <button onClick={() => setStatus('lost')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${STATUS_THEME.lost.solid}`}>
                  LOST
                </button>
              </>
            ) : (
              <button onClick={() => setStatus('open')}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                REOPEN
              </button>
            )}
            <button
              ref={menuBtnRef}
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="פעולות נוספות"
              className="h-10 w-10 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-800 hover:bg-gray-50 text-lg leading-none"
            >
              ⋮
            </button>
            <AnchoredMenu anchorRef={menuBtnRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={184}>
              <button
                onClick={() => { setMenuOpen(false); duplicateDeal(); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                שכפל דיל
              </button>
              <button
                disabled
                title="בקרוב"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
              >
                <span>איחוד דילים</span>
                <span className="text-[10px] rounded bg-gray-100 px-1.5 py-0.5">בקרוב</span>
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                className="block w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                מחק דיל
              </button>
            </AnchoredMenu>
          </div>
        </div>
      </div>

      <LostDealDialog
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        onSubmit={confirmLost}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת דיל"
        body="למחוק את הדיל? אנשי הקשר המקושרים יוסרו מהדיל."
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); removeDeal(); }}
      />

      {/* Two-column workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          <Card
            title="סקירת הדיל"
            action={
              <SaveBtn
                busy={savingSection === 'overview'}
                onClick={() =>
                  saveSection('overview', {
                    dealStageId: form.dealStageId,
                    source: form.source,
                    expectedCloseDate: form.expectedCloseDate || null,
                  })
                }
              />
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FieldBox label="שלב">
                <select value={form.dealStageId} onChange={(e) => set('dealStageId', e.target.value)} className={`${INPUT} bg-white`}>
                  {stages.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
                </select>
              </FieldBox>
              <FieldBox label="מקור">
                <input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="לדוגמה: הפניה, אתר, תערוכה" className={INPUT} />
              </FieldBox>
              <FieldBox label="צפי סגירה">
                <input type="date" value={form.expectedCloseDate} onChange={(e) => set('expectedCloseDate', e.target.value)} dir="ltr" className={INPUT} />
              </FieldBox>
            </div>
          </Card>

          <Card
            title="שיוך ארגוני"
            action={
              <SaveBtn
                busy={savingSection === 'org'}
                onClick={() =>
                  saveSection('org', {
                    organizationId: form.organizationId || null,
                    organizationUnitId: form.organizationUnitId || null,
                    organizationSubtypeId: form.organizationSubtypeId || null,
                  })
                }
              />
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FieldBox label="ארגון">
                <select value={form.organizationId} onChange={(e) => chooseOrg(e.target.value)} className={`${INPUT} bg-white`}>
                  <option value="">— ללא —</option>
                  {orgs.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </FieldBox>
              <FieldBox label="יחידה">
                <select value={form.organizationUnitId} onChange={(e) => set('organizationUnitId', e.target.value)} disabled={!units.length} className={`${INPUT} bg-white disabled:bg-gray-100`}>
                  <option value="">— ללא —</option>
                  {units.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select>
              </FieldBox>
              <FieldBox label="תת-סוג (של הדיל)">
                <select value={form.organizationSubtypeId} onChange={(e) => set('organizationSubtypeId', e.target.value)} className={`${INPUT} bg-white`}>
                  <option value="">— ללא —</option>
                  {subtypes.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
                </select>
              </FieldBox>
            </div>
            {form.organizationId && (
              <div className="mt-3">
                <Link to={`/admin/crm/organizations/${form.organizationId}`} className="text-[13px] text-blue-700 hover:underline">
                  פתח את כרטיס הארגון ←
                </Link>
              </div>
            )}
          </Card>

          <DealContactsSection deal={deal} allContacts={allContacts} onChange={refresh} />

          <Card title="פעילות (בקרוב)">
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
              ציר זמן של פעילויות, שיחות, וואטסאפ ואימייל — ייפתח עם מודול הפעילויות.
            </div>
          </Card>
        </div>

        {/* Secondary column */}
        <div className="space-y-5">
          <Card
            title="מסחרי"
            action={
              <SaveBtn
                busy={savingSection === 'commercial'}
                onClick={() =>
                  saveSection('commercial', {
                    valueMinor: toMinor(form.value) ?? 0,
                    discountMinor: toMinor(form.discount),
                    paymentTerms: form.paymentTerms,
                    currency: form.currency,
                  })
                }
              />
            }
          >
            <div className="space-y-3">
              <FieldBox label="שווי (₪)">
                <input value={form.value} onChange={(e) => set('value', e.target.value)} inputMode="decimal" dir="ltr"
                  className={`${INPUT} text-[15px] font-semibold`} />
              </FieldBox>
              <FieldBox label="הנחה (₪)">
                <input value={form.discount} onChange={(e) => set('discount', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} />
              </FieldBox>
              <FieldBox label="תנאי תשלום">
                <input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="שוטף + 30 וכו'" className={INPUT} />
              </FieldBox>
              <FieldBox label="מטבע">
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={`${INPUT} bg-white`}>
                  <option value="ILS">₪ ILS</option>
                  <option value="USD">$ USD</option>
                  <option value="EUR">€ EUR</option>
                </select>
              </FieldBox>
            </div>
          </Card>

          <Card title="תאריכים">
            <dl className="space-y-2 text-sm">
              <Row label="צפי סגירה" value={fmtDate(deal.expectedCloseDate)} />
              {deal.wonAt && <Row label="נסגר בהצלחה" value={fmtDate(deal.wonAt)} />}
              {deal.lostAt && <Row label="תאריך LOST" value={fmtDate(deal.lostAt)} />}
            </dl>
          </Card>

          {deal.status === 'lost' && (
            <Card title="פרטי LOST">
              <dl className="space-y-2 text-sm">
                <Row
                  label="סיבת LOST"
                  value={deal.lostReasonRef?.nameHe || deal.lostReason || '—'}
                />
              </dl>
              {deal.lostNotes && (
                <div className="mt-3">
                  <div className="text-[11px] text-gray-500 mb-1">הערות LOST</div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{deal.lostNotes}</p>
                </div>
              )}
              {!deal.lostReasonRef && deal.lostReason && (
                <div className="mt-2 text-[11px] text-gray-400">
                  טקסט LOST קודם (legacy) — נשמר לתצוגה עד עדכון הסטטוס מחדש.
                </div>
              )}
            </Card>
          )}

          <Card
            title="הערות פנימיות"
            action={
              <SaveBtn
                busy={savingSection === 'notes'}
                onClick={() => saveSection('notes', { notes: form.notes })}
              />
            }
          >
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={4}
              placeholder="הערות פנימיות לדיל…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          </Card>

          <Card title="מטא-דאטה">
            <dl className="space-y-2 text-sm">
              <Row label="נוצר" value={fmtDate(deal.createdAt)} />
              <Row label="עודכן" value={fmtDate(deal.updatedAt)} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Deal contacts (prominent card) ──────────────────────────────────

function DealContactsSection({ deal, allContacts, onChange }) {
  const [adding, setAdding] = useState(false);
  const linkedIds = new Set(deal.contacts.map((dc) => dc.contactId));
  const available = allContacts.filter((c) => !linkedIds.has(c.id));

  return (
    <Card
      title={`אנשי קשר בדיל (${deal.contacts.length})`}
      action={
        !adding && (
          <button
            onClick={() => setAdding(true)}
            disabled={available.length === 0}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={available.length === 0 ? 'כל אנשי הקשר כבר מקושרים' : ''}
          >
            + הוסף איש קשר לדיל
          </button>
        )
      }
    >
      {adding && (
        <div className="mb-3">
          <AddContactForm
            available={available}
            dealId={deal.id}
            onDone={() => { setAdding(false); onChange(); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {deal.contacts.length ? (
        <ul className="space-y-2">
          {deal.contacts.map((dc) => (
            <DealContactRow key={dc.id} dc={dc} onChange={onChange} />
          ))}
        </ul>
      ) : (
        !adding && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
            אין אנשי קשר מקושרים לדיל. הוסיפו את הראשון עם הכפתור למעלה.
          </div>
        )
      )}
    </Card>
  );
}

function DealContactRow({ dc, onChange }) {
  const [editing, setEditing] = useState(false);
  const c = dc.contact;
  const contactLine = [c?.phones?.[0]?.value, c?.emails?.[0]?.value].filter(Boolean).join(' · ');

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
    <li className="rounded-xl border border-gray-200 px-3.5 py-3 hover:bg-gray-50/60 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        {dc.isPrimary && <span className="text-amber-500" title="ראשי">★</span>}
        <span className="font-semibold text-gray-900">{contactNameHe(c)}</span>
        {contactLine && <span className="text-[12px] text-gray-400" dir="ltr">{contactLine}</span>}
        <div className="flex-1" />
        <button onClick={() => setEditing(true)} className="text-[12px] text-blue-700 hover:bg-blue-50 rounded px-2 py-1">עריכה</button>
        <button onClick={remove} className="text-[12px] text-red-600 hover:bg-red-50 rounded px-2 py-1">הסר</button>
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
        {PREF_FIELDS.some((p) => dc[p.key]) && <span className="text-gray-300">·</span>}
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
    <form onSubmit={submit} className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-3">
      <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={`${INPUT} bg-white`}>
        <option value="">בחר איש קשר…</option>
        {available.map((c) => (<option key={c.id} value={c.id}>{contactNameHe(c)}</option>))}
      </select>
      <RolesAndPrefs draft={draft} setDraft={setDraft} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !contactId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'מוסיף…' : 'הוסף לדיל'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-white">ביטול</button>
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
    <form onSubmit={submit} className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-3">
      <div className="font-medium text-gray-900">{name}</div>
      <RolesAndPrefs draft={draft} setDraft={setDraft} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-white">ביטול</button>
      </div>
    </form>
  );
}

function RolesAndPrefs({ draft, setDraft }) {
  function toggleRole(r) {
    setDraft((d) => ({
      ...d,
      roles: d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r],
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
              <button key={r} type="button" onClick={() => toggleRole(r)}
                className={`rounded-full px-2.5 py-1 text-[12px] border transition ${
                  on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
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
              <input type="checkbox" checked={!!draft[p.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.checked }))}
                className="rounded border-gray-300" />
              {p.label}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[13px] text-gray-700">
        <input type="checkbox" checked={!!draft.isPrimary}
          onChange={(e) => setDraft((d) => ({ ...d, isPrimary: e.target.checked }))}
          className="rounded border-gray-300" />
        איש קשר ראשי בדיל
      </label>
    </div>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────

// Horizontal pipeline bar (Pipedrive-style), RTL: stages read right→left as a
// row of connected chevron segments. Every stage up to and including the current
// one is filled in the deal's status color (OPEN muted blue / WON green / LOST
// red); future stages are gray. A closed deal still shows where it sat.
const PIPE_FILL = {
  open: { done: 'bg-blue-100 text-blue-700', current: 'bg-blue-500 text-white' },
  won: { done: 'bg-emerald-100 text-emerald-700', current: 'bg-emerald-500 text-white' },
  lost: { done: 'bg-red-100 text-red-700', current: 'bg-red-500 text-white' },
};
// Each segment is a left-pointing chevron (progress flows toward the left in
// RTL): outward point on the left edge, matching notch cut into the right edge.
const CHEVRON = 'polygon(100% 0, 12px 0, 0 50%, 12px 100%, 100% 100%, calc(100% - 12px) 50%)';
// The first (rightmost) segment keeps a flat right edge — no notch at the start.
const CHEVRON_FIRST = 'polygon(100% 0, 12px 0, 0 50%, 12px 100%, 100% 100%)';

function StagePipeline({ stages, currentStageId, status }) {
  if (!stages?.length) return null;
  const fill = PIPE_FILL[status] || PIPE_FILL.open;
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  return (
    <div className="flex items-stretch text-[12px] font-medium leading-none">
      {stages.map((s, i) => {
        const isCurrent = i === currentIndex;
        const isDone = currentIndex >= 0 && i < currentIndex;
        const cls = isCurrent ? fill.current : isDone ? fill.done : 'bg-gray-100 text-gray-400';
        return (
          <div
            key={s.id}
            title={s.label}
            className={`${cls} ${i === 0 ? '' : '-ms-3'} flex items-center whitespace-nowrap py-2 ps-5 pe-4`}
            style={{ clipPath: i === 0 ? CHEVRON_FIRST : CHEVRON }}
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

// Local section save button (replaces the old global header save).
function SaveBtn({ onClick, busy }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {busy ? 'שומר…' : 'שמור'}
    </button>
  );
}

function Card({ title, action, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
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
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 tabular-nums" dir="ltr">{value}</dd>
    </div>
  );
}
