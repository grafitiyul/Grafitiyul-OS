import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { emitDealTasksChanged } from '../tasks/taskEvents.js';
import LinkExternalDocumentPanel from './LinkExternalDocumentPanel.jsx';
import { friendlyIcountError } from './icountErrors.js';
import { DateField } from '../../common/pickers/DateTimeFields.jsx';

// "הפק מסמך" — produce an iCount accounting document from a Deal.
//
// Everything is PREFILLED from the deal (server-side defaults endpoint — the
// UI never re-derives business data) and everything stays editable before
// issuing. The customer name defaults to the ORGANIZATION with a toggle to the
// contact's full name. Previous documents (GOS-issued + live iCount search)
// drive the base/close/credit selection per iCount's accounting workflow:
//   חשבון עסקה ← אין בסיס | חשבונית מס/חשבונית מס קבלה ← חשבון עסקה (סגירה)
//   קבלה ← חשבונית מס (סגירה) | חשבונית זיכוי ← חשבונית מקור (חובה)
// The ITA allocation-number precondition (סכום לפני מע״מ ≥ סף) blocks issuing
// until the customer's ח.פ/ע.מ is filled. Issue is idempotent (a key minted
// per attempt-scope protects against double-click).

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';
const LABEL = 'block text-[12px] text-gray-600';

const PAYMENT_METHODS = [
  { key: 'banktransfer', label: 'העברה בנקאית' },
  { key: 'cc', label: 'אשראי / סליקה' },
  { key: 'cash', label: 'מזומן' },
  { key: 'cheque', label: 'שיק' },
];

const fmtIls = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

function newPayment(amount) {
  return { method: 'banktransfer', amount: amount || 0, date: today(), reference: '', cardType: 'VISA', cardLast4: '', installments: 1, holderName: '' };
}

export default function ProduceDocumentModal({ dealId, open, onClose }) {
  const [defaults, setDefaults] = useState(null);
  const [prevDocs, setPrevDocs] = useState([]);
  const [liveError, setLiveError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [doctype, setDoctype] = useState('deal');
  const [clientMode, setClientMode] = useState('organization');
  const [client, setClient] = useState({ name: '', vatId: '', email: '', phone: '', address: '' });
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState([]);
  const [baseDoc, setBaseDoc] = useState(null); // { doctype, docnum }
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState(null);
  const [baseNote, setBaseNote] = useState(null); // "rows inherited from …"
  const [linkOpen, setLinkOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [docDate, setDocDate] = useState(today());
  const [lang, setLang] = useState('he');

  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState(null);
  const [issued, setIssued] = useState(null); // successful document
  // One idempotency key per issue-scope: minted on open, renewed only after a
  // SUCCESSFUL issue — so a double-click / retry after a network hiccup can
  // never produce two documents.
  const idemKey = useRef(null);

  useEffect(() => {
    if (!open) return;
    idemKey.current = crypto.randomUUID();
    setIssued(null);
    setIssueError(null);
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [d, docs] = await Promise.all([
          api.deals.icountDefaults(dealId),
          api.deals.icountDocuments(dealId).catch(() => ({ documents: [], liveError: 'load_failed' })),
        ]);
        setDefaults(d);
        setPrevDocs(docs.documents || []);
        setLiveError(docs.liveError || null);
        setDoctype('deal');
        setClientMode(d.customer.defaultMode);
        setClient({
          name: (d.customer.defaultMode === 'organization' ? d.customer.organizationName : d.customer.contactName) || '',
          vatId: d.customer.vatId || '',
          email: d.customer.email || '',
          phone: d.customer.phone || '',
          address: d.customer.address || '',
        });
        setRows(d.rows.map((r) => ({ ...r })));
        setNotes(d.notes || '');
        setPayments([]);
        setBaseDoc(null);
        setBaseError(null);
        setBaseNote(null);
        setLinkOpen(false);
        setSendEmail(true);
        setDocDate(today());
        setLang(d.language === 'en' ? 'en' : 'he');
      } catch (e) {
        setLoadError(e.payload?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, dealId]);

  const typeDef = useMemo(
    () => (defaults?.docTypes || []).find((t) => t.key === doctype) || null,
    [defaults, doctype],
  );

  const vatRate = defaults?.vatRate ?? 18;
  const grossIls = useMemo(
    () => Math.round(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPriceIls) || 0), 0) * 100) / 100,
    [rows],
  );
  const beforeVatIls = useMemo(() => Math.round((grossIls / (1 + vatRate / 100)) * 100) / 100, [grossIls, vatRate]);

  // ITA allocation precondition — mirrors the server check exactly.
  const allocationDoc = ['invoice', 'invrec', 'refund'].includes(doctype);
  const allocationRequired = allocationDoc && beforeVatIls >= (defaults?.allocationThresholdIls ?? 5000);
  const vatIdValid = /^\d{8,9}$/.test(client.vatId.trim());
  const allocationBlocked = allocationRequired && !vatIdValid;

  const baseCandidates = useMemo(
    () => prevDocs.filter((d) => typeDef?.baseTypes?.includes(d.doctype) && d.docnum),
    [prevDocs, typeDef],
  );
  const baseMissing = !!typeDef?.baseRequired && !baseDoc;

  const paymentsTotal = useMemo(
    () => Math.round(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100,
    [payments],
  );
  const paymentsMismatch = typeDef?.paymentsAllowed && payments.length > 0 && paymentsTotal !== grossIls;
  // קבלה / חשבונית מס קבלה record money received — iCount rejects them without
  // a payment, so GOS blocks upfront with a clear message.
  const paymentsMissing =
    !!typeDef?.paymentsRequired && !payments.some((p) => p.method && Number(p.amount) > 0);

  function switchMode(mode) {
    setClientMode(mode);
    const c = defaults?.customer;
    setClient((prev) => ({
      ...prev,
      name: (mode === 'organization' ? c?.organizationName : c?.contactName) || '',
      // The tax id follows the entity: org's ח.פ vs the contact's ת.ז.
      vatId: (mode === 'organization' ? c?.vatIdOrganization : c?.vatIdContact) || '',
    }));
  }

  // A selected base document RESTRICTS the type: only its valid follow-ups
  // (e.g. base חשבונית מס → only קבלה / חשבונית זיכוי; never חשבונית מס קבלה).
  const allowedTypeKeys = useMemo(() => {
    if (!baseDoc || !defaults) return null; // null = all allowed
    return defaults.docTypes.filter((t) => t.baseTypes.includes(baseDoc.doctype)).map((t) => t.key);
  }, [baseDoc, defaults]);

  function pickType(key) {
    const def = (defaults?.docTypes || []).find((t) => t.key === key);
    setDoctype(key);
    if (baseDoc && def?.baseTypes?.includes(baseDoc.doctype)) {
      // Base stays; inherited rows stay; payments follow the inherited total.
      setPayments(def?.paymentsAllowed ? [newPayment(grossIls)] : []);
      return;
    }
    setBaseDoc(null);
    setBaseNote(null);
    setBaseError(null);
    // Docs that record money received start with one payment row over the total.
    setPayments(def?.paymentsAllowed ? [newPayment(grossIls)] : []);
  }

  // Selecting a base document inherits its REAL lines + total from iCount —
  // the deal's own pricing must never leak into a follow-up/closing document.
  async function selectBase(sel, { forDoctype = doctype } = {}) {
    setBaseError(null);
    if (!sel) {
      setBaseDoc(null);
      setBaseNote(null);
      const restored = (defaults?.rows || []).map((r) => ({ ...r }));
      setRows(restored);
      const def = (defaults?.docTypes || []).find((t) => t.key === forDoctype);
      const restoredGross = restored.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPriceIls) || 0), 0);
      setPayments(def?.paymentsAllowed ? [newPayment(Math.round(restoredGross * 100) / 100)] : []);
      return;
    }
    setBaseDoc({ doctype: sel.doctype, docnum: sel.docnum });
    setBaseLoading(true);
    try {
      const prefill = await api.deals.icountBaseDocument(dealId, sel.doctype, sel.docnum);
      if (prefill.rows.length === 0) {
        // A base with no readable items: the accounting link is kept but the
        // rows are the user's to provide — never a synthesized line.
        setBaseNote(null);
        setBaseError('לא נמצאו שורות במסמך המקורי — יש לוודא את השורות והסכום ידנית');
        return;
      }
      setRows(prefill.rows.map((r) => ({ ...r })));
      const def = (defaults?.docTypes || []).find((t) => t.key === forDoctype);
      setPayments(def?.paymentsAllowed ? [newPayment(prefill.amountIls)] : []);
      setBaseNote(`שורות המסמך המקורי נטענו מ${prefill.doctypeLabel} מס׳ ${prefill.docnum} (ניתן לערוך)`);
    } catch (e) {
      // Base stays selected (the accounting link matters) — rows stay editable.
      setBaseNote(null);
      setBaseError(friendlyIcountError(e));
    } finally {
      setBaseLoading(false);
    }
  }

  // An external document was linked ("שייך מסמך אחר מאייקאונט"): it becomes a
  // previous-docs row + the selected base; the type auto-switches to a valid
  // follow-up when the current one is incompatible.
  async function onExternalLinked(document) {
    setLinkOpen(false);
    try {
      const docs = await api.deals.icountDocuments(dealId);
      setPrevDocs(docs.documents || []);
      setLiveError(docs.liveError || null);
    } catch {
      /* list refresh is cosmetic — the base selection below still works */
    }
    const compatible = (defaults?.docTypes || []).filter((t) => t.baseTypes.includes(document.doctype));
    if (compatible.length === 0) {
      // Linked + recorded on the deal, but nothing can be issued "based on" it
      // (e.g. a receipt) — don't select it as base.
      setBaseNote('המסמך שויך לדיל, אך אין סוגי מסמכי המשך תקפים עבורו.');
      return;
    }
    let nextType = doctype;
    if (!compatible.some((t) => t.key === doctype)) {
      nextType = compatible[0].key;
      setDoctype(nextType);
    }
    await selectBase({ doctype: document.doctype, docnum: document.docnum }, { forDoctype: nextType });
  }

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setPayment = (i, patch) => setPayments((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const canIssue =
    !issuing && !loading && !loadError && !baseLoading && typeDef && client.name.trim() &&
    rows.some((r) => r.description && Number(r.quantity) > 0) &&
    !allocationBlocked && !baseMissing && !paymentsMissing && defaults?.icountConfigured;

  async function issue() {
    if (!canIssue) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const { document } = await api.deals.issueIcountDocument(dealId, {
        doctype,
        idempotencyKey: idemKey.current,
        docDate,
        lang,
        // Which GOS entity the typed ח.פ/ת.ז is written back onto.
        clientMode,
        client: {
          name: client.name.trim(),
          vatId: client.vatId.trim() || null,
          email: client.email.trim() || null,
          phone: client.phone.trim() || null,
          address: client.address.trim() || null,
        },
        rows: rows
          .filter((r) => r.description && Number(r.quantity) > 0)
          .map((r) => ({
            description: r.description,
            details: r.details || null,
            quantity: Number(r.quantity),
            unitPriceIls: Number(r.unitPriceIls) || 0,
          })),
        notes: notes.trim() || null,
        payments: typeDef.paymentsAllowed ? payments : [],
        basedOn: baseDoc,
        sendEmail,
      });
      setIssued(document);
      idemKey.current = crypto.randomUUID(); // next issue is a NEW document
      emitDealTasksChanged(dealId); // refreshes the Deal timeline (pinned note)
    } catch (e) {
      setIssueError(friendlyIcountError(e));
    } finally {
      setIssuing(false);
    }
  }

  const footer = issued ? (
    <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
      סגירה
    </button>
  ) : (
    <>
      <button type="button" onClick={onClose} disabled={issuing} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
        ביטול
      </button>
      <button type="button" onClick={issue} disabled={!canIssue}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {issuing ? 'מפיק…' : `הפקת ${typeDef?.label || 'מסמך'}`}
      </button>
    </>
  );

  return (
    <Dialog open={open} onClose={issuing ? null : onClose} title="הפקת מסמך" size="xl" footer={footer}>
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען נתוני מסמך…</div>
      ) : loadError ? (
        <div className="py-10 text-center text-sm text-red-600">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{loadError}</span>
        </div>
      ) : issued ? (
        <div className="space-y-4 py-4 text-center">
          <div className="text-4xl">✅</div>
          <p className="text-lg font-semibold text-gray-900">
            {issued.doctype && defaults ? (defaults.docTypes.find((t) => t.key === issued.doctype)?.label || issued.doctype) : ''}
            {issued.docnum ? ` מס׳ ${issued.docnum}` : ''} הופק בהצלחה
          </p>
          <p className="text-sm text-gray-600">
            {issued.clientName} · {fmtIls(Number(issued.amountMinor) / 100)}
          </p>
          {issued.docUrl && (
            <a href={issued.docUrl} target="_blank" rel="noopener noreferrer"
              className="inline-block rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
              פתיחת המסמך
            </a>
          )}
          <p className="text-[12px] text-gray-500">נוצר פתק מוצמד בציר הזמן של הדיל.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {!defaults?.icountConfigured && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              חיבור iCount אינו מוגדר בסביבה הזו (משתני ICOUNT_*). לא ניתן להפיק מסמכים עד להגדרתו.
            </div>
          )}

          {/* Document type — restricted to valid follow-ups once a base is selected */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-gray-500">סוג המסמך</p>
              <button type="button" onClick={() => setLinkOpen((o) => !o)}
                className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50">
                שייך מסמך אחר מאייקאונט
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(defaults?.docTypes || []).map((t) => {
                const blocked = allowedTypeKeys !== null && !allowedTypeKeys.includes(t.key);
                return (
                  <button key={t.key} type="button" onClick={() => pickType(t.key)} disabled={blocked}
                    title={blocked ? 'לא ניתן להפיק מסמך זה על בסיס המסמך שנבחר' : undefined}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
                      doctype === t.key
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : blocked
                          ? 'border-gray-200 bg-gray-50 text-gray-300'
                          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {linkOpen && (
            <LinkExternalDocumentPanel
              dealId={dealId}
              docTypes={defaults?.docTypes || []}
              onLinked={onExternalLinked}
              onClose={() => setLinkOpen(false)}
            />
          )}

          {/* Document date + language — like iCount's own issue form */}
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <DateField label="תאריך המסמך" value={docDate} onChange={setDocDate} clearable={false} />
            <label className={LABEL}>שפת המסמך
              <select value={lang} onChange={(e) => setLang(e.target.value)} className={`mt-1 ${FIELD}`}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>

          {/* Base / previous document */}
          {typeDef?.baseTypes?.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <p className="text-[12px] font-semibold text-gray-500">
                {doctype === 'refund' ? 'מסמך מקור לזיכוי (חובה)' : 'סגירת מסמך קודם (רשות)'}
              </p>
              {baseCandidates.length === 0 ? (
                <p className="mt-1 text-[13px] text-gray-500">
                  לא נמצאו מסמכים קודמים מתאימים ({typeDef.baseTypes.map((k) => defaults.docTypes.find((t) => t.key === k)?.label).join(' / ')}).
                  {doctype === 'refund' && ' לא ניתן להפיק חשבונית זיכוי ללא מסמך מקור.'}
                </p>
              ) : (
                <div className="mt-1.5 space-y-1">
                  {doctype !== 'refund' && (
                    <label className="flex items-center gap-2 text-[13px] text-gray-700">
                      <input type="radio" name="baseDoc" checked={!baseDoc} onChange={() => selectBase(null)} />
                      ללא קישור למסמך קודם
                    </label>
                  )}
                  {baseCandidates.map((d) => (
                    <label key={`${d.doctype}:${d.docnum}`} className="flex items-center gap-2 text-[13px] text-gray-700">
                      <input type="radio" name="baseDoc"
                        checked={baseDoc?.doctype === d.doctype && baseDoc?.docnum === d.docnum}
                        onChange={() => selectBase(d)} />
                      <span>
                        {d.doctypeLabel} מס׳ {d.docnum}
                        {d.amountIls != null && <span className="text-gray-500"> · {fmtIls(d.amountIls)}</span>}
                        {d.clientName && <span className="text-gray-500"> · {d.clientName}</span>}
                        <span className="text-[11px] text-gray-400">
                          {' '}({d.origin === 'gos' ? 'הופק מ־GOS' : d.origin === 'linked' ? 'שויך ידנית' : 'iCount'})
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {baseLoading && <p className="mt-1 text-[12px] text-blue-700">טוען את שורות המסמך המקורי…</p>}
              {baseNote && !baseLoading && <p className="mt-1 text-[12px] text-emerald-700">✓ {baseNote}</p>}
              {baseError && !baseLoading && (
                <p className="mt-1 text-[12px] text-amber-700">
                  ⚠ לא ניתן לטעון את שורות המסמך המקורי ({baseError}) — הקישור החשבונאי יישמר, אך יש לוודא את השורות והסכום ידנית.
                </p>
              )}
              {liveError && (
                <p className="mt-1 text-[11px] text-amber-700">חיפוש מסמכים חיים ב־iCount לא זמין כרגע — מוצגים מסמכים שהופקו מ־GOS בלבד.</p>
              )}
            </div>
          )}
          {/* A base note can also arrive from linking a doc with no follow-ups */}
          {!typeDef?.baseTypes?.length && baseNote && (
            <p className="text-[12px] text-emerald-700">✓ {baseNote}</p>
          )}

          {/* Customer */}
          <div className="rounded-xl border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-gray-500">פרטי הלקוח במסמך</p>
              <div className="flex rounded-lg border border-gray-300 p-0.5 text-[12px]">
                <button type="button" onClick={() => switchMode('organization')} disabled={!defaults?.customer?.organizationName}
                  className={`rounded-md px-2.5 py-1 transition ${clientMode === 'organization' ? 'bg-blue-600 text-white' : 'text-gray-600 disabled:opacity-40'}`}>
                  שם הארגון
                </button>
                <button type="button" onClick={() => switchMode('contact')} disabled={!defaults?.customer?.contactName}
                  className={`rounded-md px-2.5 py-1 transition ${clientMode === 'contact' ? 'bg-blue-600 text-white' : 'text-gray-600 disabled:opacity-40'}`}>
                  שם איש הקשר
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={LABEL}>שם הלקוח *
                <input value={client.name} onChange={(e) => setClient((c) => ({ ...c, name: e.target.value }))} className={`mt-1 ${FIELD}`} />
              </label>
              <label className={LABEL}>ח.פ / ע.מ / ת.ז {allocationRequired && <span className="font-semibold text-amber-700">*</span>}
                <input value={client.vatId} dir="ltr" inputMode="numeric" placeholder="514000000"
                  onChange={(e) => setClient((c) => ({ ...c, vatId: e.target.value }))}
                  className={`mt-1 ${FIELD} ${allocationBlocked ? 'border-amber-500 ring-1 ring-amber-300' : ''}`} />
              </label>
              <label className={LABEL}>אימייל
                <input value={client.email} dir="ltr" onChange={(e) => setClient((c) => ({ ...c, email: e.target.value }))} className={`mt-1 ${FIELD}`} />
              </label>
              <label className={LABEL}>טלפון
                <input value={client.phone} dir="ltr" onChange={(e) => setClient((c) => ({ ...c, phone: e.target.value }))} className={`mt-1 ${FIELD}`} />
              </label>
              <label className={`${LABEL} sm:col-span-2`}>כתובת
                <input value={client.address} onChange={(e) => setClient((c) => ({ ...c, address: e.target.value }))} className={`mt-1 ${FIELD}`} />
              </label>
            </div>
          </div>

          {/* Allocation warning */}
          {allocationRequired && (
            <div className={`rounded-lg border px-3 py-2 text-[13px] ${allocationBlocked ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
              {allocationBlocked ? (
                <>⚠ מסמך זה חייב <b>מספר הקצאה</b> מרשות המסים (סכום לפני מע״מ {fmtIls(beforeVatIls)} ≥ {fmtIls(defaults.allocationThresholdIls)}).
                  יש למלא ח.פ / עוסק מורשה תקין של הלקוח (8–9 ספרות) לפני ההפקה.</>
              ) : (
                <>✓ דרישת מספר ההקצאה מכוסה — ח.פ הלקוח מולא ({client.vatId.trim()}). iCount יבקש את מספר ההקצאה מרשות המסים בעת ההפקה.</>
              )}
            </div>
          )}

          {/* Rows */}
          <div className="rounded-xl border border-gray-200 p-3">
            <p className="text-[12px] font-semibold text-gray-500">שורות המסמך (מחירים כולל מע״מ)</p>
            <div className="mt-2 space-y-1.5">
              <div className="grid grid-cols-[1fr_4.5rem_6.5rem_6.5rem_2rem] items-center gap-2 text-[11px] text-gray-400">
                <span>תיאור</span><span>כמות</span><span>מחיר יח׳</span><span>סה״כ</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={i}>
                  <div className="grid grid-cols-[1fr_4.5rem_6.5rem_6.5rem_2rem] items-center gap-2">
                    <input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} className={FIELD} />
                    <input type="number" min="0" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className={`${FIELD} text-center`} dir="ltr" />
                    <input type="number" min="0" step="0.01" value={r.unitPriceIls} onChange={(e) => setRow(i, { unitPriceIls: e.target.value })} className={FIELD} dir="ltr" />
                    <span className="text-[13px] text-gray-700" dir="ltr">{fmtIls((Number(r.quantity) || 0) * (Number(r.unitPriceIls) || 0))}</span>
                    <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="הסרת שורה"
                      className="text-gray-400 hover:text-red-600">✕</button>
                  </div>
                  {/* Row details inherited from a base document (long_description) */}
                  {r.details && (
                    <p className="mt-0.5 pr-1 text-[11.5px] text-gray-500" dir="auto">{r.details}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={() => setRows((rs) => [...rs, { description: '', quantity: 1, unitPriceIls: 0 }])}
                className="text-[12.5px] font-medium text-blue-700 hover:underline">+ הוספת שורה</button>
              <div className="text-left text-[13px]">
                <div className="text-gray-500">לפני מע״מ: <span dir="ltr">{fmtIls(beforeVatIls)}</span></div>
                <div className="font-semibold text-gray-900">סה״כ כולל מע״מ ({vatRate}%): <span dir="ltr">{fmtIls(grossIls)}</span></div>
              </div>
            </div>
          </div>

          {/* Payments (docs that record money received) */}
          {typeDef?.paymentsAllowed && (
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="text-[12px] font-semibold text-gray-500">תשלומים שהתקבלו</p>
              <div className="mt-2 space-y-2">
                {payments.map((p, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className={LABEL}>אמצעי תשלום
                        <select value={p.method} onChange={(e) => setPayment(i, { method: e.target.value })} className={`mt-1 ${FIELD}`}>
                          {PAYMENT_METHODS.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
                        </select>
                      </label>
                      <label className={LABEL}>סכום
                        <input type="number" min="0" step="0.01" value={p.amount} dir="ltr"
                          onChange={(e) => setPayment(i, { amount: e.target.value })} className={`mt-1 ${FIELD}`} />
                      </label>
                      <DateField label="תאריך תשלום" value={p.date} onChange={(v) => setPayment(i, { date: v })} clearable={false} />
                      <label className={LABEL}>{p.method === 'cheque' ? 'מס׳ שיק' : p.method === 'banktransfer' ? 'חשבון / אסמכתא' : 'אסמכתא / קוד אישור'}
                        <input value={p.reference} dir="ltr" onChange={(e) => setPayment(i, { reference: e.target.value })} className={`mt-1 ${FIELD}`} />
                      </label>
                    </div>
                    {p.method === 'cc' && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className={LABEL}>סוג כרטיס
                          <select value={p.cardType} onChange={(e) => setPayment(i, { cardType: e.target.value })} className={`mt-1 ${FIELD}`}>
                            {['VISA', 'MasterCard', 'Amex', 'Diners'].map((t) => (<option key={t} value={t}>{t}</option>))}
                          </select>
                        </label>
                        <label className={LABEL}>4 ספרות אחרונות
                          <input value={p.cardLast4} dir="ltr" maxLength={4} onChange={(e) => setPayment(i, { cardLast4: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                        <label className={LABEL}>מס׳ תשלומים
                          <input type="number" min="1" value={p.installments} dir="ltr" onChange={(e) => setPayment(i, { installments: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                        <label className={LABEL}>שם בעל הכרטיס
                          <input value={p.holderName} onChange={(e) => setPayment(i, { holderName: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                      </div>
                    )}
                    {p.method === 'cheque' && (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <label className={LABEL}>בנק
                          <input type="number" value={p.bank || ''} dir="ltr" onChange={(e) => setPayment(i, { bank: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                        <label className={LABEL}>סניף
                          <input type="number" value={p.branch || ''} dir="ltr" onChange={(e) => setPayment(i, { branch: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                        <label className={LABEL}>חשבון
                          <input value={p.account || ''} dir="ltr" onChange={(e) => setPayment(i, { account: e.target.value })} className={`mt-1 ${FIELD}`} />
                        </label>
                      </div>
                    )}
                    <div className="mt-1 text-left">
                      <button type="button" onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}
                        className="text-[12px] text-red-600 hover:underline">הסרת תשלום</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button type="button" onClick={() => setPayments((ps) => [...ps, newPayment(Math.max(0, grossIls - paymentsTotal))])}
                  className="text-[12.5px] font-medium text-blue-700 hover:underline">+ הוספת תשלום</button>
                <span className={`text-[13px] ${paymentsMismatch ? 'font-semibold text-amber-700' : 'text-gray-500'}`} dir="ltr">
                  {fmtIls(paymentsTotal)} / {fmtIls(grossIls)}
                </span>
              </div>
              {paymentsMissing && (
                <p className="mt-1 text-[12.5px] font-medium text-amber-700">
                  ⚠ כדי להפיק {typeDef?.label} חובה להזין אמצעי תשלום ופרטי תשלום.
                </p>
              )}
              {paymentsMismatch && !paymentsMissing && (
                <p className="mt-1 text-[12px] text-amber-700">⚠ סך התשלומים שונה מסך המסמך — iCount עשוי לדחות את ההפקה.</p>
              )}
            </div>
          )}

          {/* Notes + send */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className={LABEL}>הערות (יופיעו במסמך)
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${FIELD} resize-y`} />
            </label>
            <label className="flex items-center gap-2 pb-1 text-[13px] text-gray-700">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} disabled={!client.email.trim()} />
              שליחה במייל ללקוח
            </label>
          </div>

          {issueError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" dir="auto">
              ההפקה נכשלה: {issueError}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
