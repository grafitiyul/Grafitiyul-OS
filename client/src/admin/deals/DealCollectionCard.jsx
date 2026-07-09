import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import Dialog from '../common/Dialog.jsx';
import CardKebabMenu from '../common/CardKebabMenu.jsx';
import ProduceDocumentModal from './icount/ProduceDocumentModal.jsx';
import CustomPaymentLinkModal from './icount/CustomPaymentLinkModal.jsx';
import CardcomPaymentModal from './cardcom/CardcomPaymentModal.jsx';
import SendDocumentModal from './icount/SendDocumentModal.jsx';
import { formatMinor } from '../../lib/money.js';
import { contactNameHe } from './config.js';
import { contactNamesFromParts } from '../../lib/nameSplit.js';

// גבייה — the Deal's financial summary card and the single home of all
// payment actions (header ⋮ menu). The payment-link / accounting flows moved
// here VERBATIM from the Tour Details action row (DealDetail's DealActionRow);
// this card only relocated their entry point.
//
// Money model (no duplicate financial logic):
//   - Deal total  = Deal.valueMinor — the Price Builder headline. Read live,
//     never stored or recomputed here.
//   - Rows        = the existing payment records, from the existing endpoints:
//     iCount documents (GET /icount/documents — GOS rows + live iCount),
//     the active pending Cardcom tourist request, active custom payment links.
//   - Paid        = derived ONCE here (paidMinorFromDocs below) from the
//     document list — nothing else in the system computes paid/balance yet;
//     when payment milestones arrive this is the calculation to lift.

// Money actually received = documents that RECORD payment (קבלה / חשבונית מס
// קבלה), minus credit notes. 'deal'/'invoice' bill but do not collect. A paid
// Cardcom request auto-issues such a document, so summing documents does not
// double-count it.
const PAID_SIGN = { receipt: 1, invrec: 1, refund: -1 };

function paidMinorFromDocs(documents) {
  let sum = 0;
  for (const d of documents || []) {
    const sign = PAID_SIGN[d.doctype];
    if (!sign || d.amountIls == null || !Number.isFinite(Number(d.amountIls))) continue;
    sum += sign * Math.round(Number(d.amountIls) * 100);
  }
  return sum;
}

// Prefill contact — mirror of the server's pick (dealPayment.js): first contact
// flagged to receive payment links, else the primary/first contact.
function pickPaymentContact(contacts) {
  const list = contacts || [];
  return list.find((dc) => dc.receivePaymentLinks) || list[0] || null;
}
function waHref(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
const DLG_FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';
const EMPTY_DLG_FORM = { first: '', last: '', phone: '', email: '' };
const MENU_ITEM = 'block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50';

function FieldBox({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}

// A customer detail that already exists — shown read-only (calm gray box with
// a check) so the dialog reads as "review & complete the customer's details".
// The subtle pencil turns JUST that field editable, so outdated info can be
// fixed inline without leaving the payment flow or opening the full editor.
function DlgKnownValue({ children, dir, onEdit }) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-1.5">
      <span dir={dir} className="text-sm text-gray-800 truncate">{children}</span>
      <span className="shrink-0 inline-flex items-center gap-1">
        <span className="text-[12px] text-emerald-600">✓</span>
        <button
          type="button"
          onClick={onEdit}
          title="ערוך"
          aria-label="ערוך"
          className="rounded p-0.5 text-gray-300 group-hover:text-gray-400 hover:!text-gray-600 hover:bg-gray-200/60 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      </span>
    </div>
  );
}

function fmtDay(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL');
}

// One payment-record row: label + date on the reading side, amount on the far
// side. `tone` colors the amount: received = green, credit = red, other = gray.
function RecordRow({ label, sub, date, amountMinor, currency, tone = 'plain', href }) {
  const amountCls =
    tone === 'in' ? 'text-emerald-700' : tone === 'out' ? 'text-red-600' : 'text-gray-700';
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-gray-800">{label}</span>
        <span className="block truncate text-[11px] text-gray-400">
          {[sub, fmtDay(date)].filter(Boolean).join(' · ')}
        </span>
      </span>
      {amountMinor != null && (
        <span dir="ltr" className={`shrink-0 text-[13px] font-medium tabular-nums ${amountCls}`}>
          {tone === 'out' ? '−' : ''}{formatMinor(Math.abs(amountMinor), currency)}
        </span>
      )}
    </>
  );
  const rowCls = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1.5';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${rowCls} hover:bg-gray-50`}>
      {body}
    </a>
  ) : (
    <div className={rowCls}>{body}</div>
  );
}

export default function DealCollectionCard({ deal, productName, onOpenPriceBuilder, onRefresh }) {
  // ── Payment records (existing endpoints; see header comment) ─────────────
  const [records, setRecords] = useState(null); // null = loading
  const [recordsError, setRecordsError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [docsRes, touristRes, linksRes] = await Promise.all([
        api.deals.icountDocuments(deal.id).catch(() => null),
        api.deals.touristPayment(deal.id).catch(() => null),
        api.deals.customPaymentLinks(deal.id).catch(() => null),
      ]);
      setRecordsError(!docsRes && !touristRes && !linksRes);
      setRecords({
        documents: docsRes?.documents || [],
        docsFailed: !docsRes,
        liveError: docsRes?.liveError || null,
        pendingTourist: touristRes?.activeRequest || null,
        touristUrl: touristRes?.publicUrl || null,
        customLinks: (linksRes?.links || []).filter((l) => l.status === 'active'),
      });
    } catch {
      setRecordsError(true);
      setRecords((r) => r || { documents: [], docsFailed: true, liveError: null, pendingTourist: null, touristUrl: null, customLinks: [] });
    }
  }, [deal.id]);

  useEffect(() => {
    setRecords(null);
    reload();
  }, [reload]);

  // ── Payment actions — moved from the Tour Details action row ─────────────
  const [payBusy, setPayBusy] = useState(false);
  const [payFeedback, setPayFeedback] = useState(null);
  const [missingDialog, setMissingDialog] = useState(null); // { action, kind: 'amount'|'details', needName, needPhone, needEmail }
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [customLinkOpen, setCustomLinkOpen] = useState(false);
  const [cardcomOpen, setCardcomOpen] = useState(false);
  // "שלח חשבון עסקה חדש" — re-issue a חשבון עסקה from the CURRENT deal state,
  // then continue into the existing sharing flow: newInvoiceOpen →
  // ProduceDocumentModal(sendFlow) → onIssued hands the fresh document to
  // SendDocumentModal via shareEntry.
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [shareEntry, setShareEntry] = useState(null);
  const [dlgForm, setDlgForm] = useState(EMPTY_DLG_FORM);
  const [dlgEdit, setDlgEdit] = useState({ name: false, phone: false, email: false });
  const feedbackTimer = useRef(null);

  const contact = pickPaymentContact(deal.contacts)?.contact || null;
  const contactName =
    contactNameHe(contact) || `${contact?.firstNameEn || ''} ${contact?.lastNameEn || ''}`.trim();
  const contactPhone = contact?.phones?.[0]?.value || '';
  const contactEmail = contact?.emails?.[0]?.value || '';
  const totalMinor = Number(deal.valueMinor || 0);

  function flash(msg) {
    setPayFeedback(msg);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setPayFeedback(null), 2500);
  }

  async function runPayAction(action, over = {}) {
    setMissingDialog(null);
    setPayBusy(true);
    try {
      // Token is permanent — every call returns the SAME URL for this deal.
      const { paymentUrl } = await api.deals.ensurePaymentToken(deal.id);
      if (action === 'copy') {
        await navigator.clipboard.writeText(paymentUrl);
        flash('✓ קישור התשלום הועתק');
      } else if (action === 'open') {
        window.open(paymentUrl, '_blank', 'noopener');
      } else if (action === 'wa') {
        const name = over.name ?? contactName;
        const text = `שלום${name ? ` ${name}` : ''}, מצורף קישור לתשלום עבור ${productName}: ${paymentUrl}`;
        const wa = waHref(over.phone ?? contactPhone, text);
        if (wa) window.open(wa, '_blank', 'noopener');
      }
    } catch {
      flash('פעולת קישור התשלום נכשלה — נסו שוב');
    } finally {
      setPayBusy(false);
    }
  }

  function payAction(action) {
    if (totalMinor <= 0) return setMissingDialog({ action, kind: 'amount' });
    const needName = !contactName;
    const needPhone = !contactPhone;
    const needEmail = !contactEmail;
    if (needName || needPhone || needEmail) {
      setDlgForm(EMPTY_DLG_FORM);
      setDlgEdit({ name: false, phone: false, email: false });
      return setMissingDialog({ action, kind: 'details', needName, needPhone, needEmail });
    }
    runPayAction(action);
  }

  // Pencil click: seed the form with the current value and make ONLY that
  // field editable.
  function startDlgEdit(field) {
    if (field === 'name') {
      setDlgForm((s) => ({
        ...s,
        first: contact?.firstNameHe || contact?.firstNameEn || '',
        last: contact?.lastNameHe || contact?.lastNameEn || '',
      }));
    } else if (field === 'phone') {
      setDlgForm((s) => ({ ...s, phone: contactPhone }));
    } else if (field === 'email') {
      setDlgForm((s) => ({ ...s, email: contactEmail }));
    }
    setDlgEdit((s) => ({ ...s, [field]: true }));
  }

  // Save the filled fields to their real source of truth — the Contact record
  // (creating + linking a primary contact when the deal has none; pencil-edited
  // existing values update their existing phone/email rows) — then continue
  // the original action with the fresh values.
  async function saveDetailsAndContinue() {
    const { action, needName, needPhone, needEmail } = missingDialog;
    const first = dlgForm.first.trim();
    const last = dlgForm.last.trim();
    const phone = dlgForm.phone.trim();
    const email = dlgForm.email.trim();
    setPayBusy(true);
    try {
      if (!contact) {
        // No contact on the deal — a name is required to create one (enforced
        // by the disabled save button).
        const created = await api.contacts.create(contactNamesFromParts(first, last));
        if (phone) await api.contacts.addPhone(created.id, { value: phone, isPrimary: true });
        if (email) await api.contacts.addEmail(created.id, { value: email, isPrimary: true });
        await api.deals.addContact(deal.id, { contactId: created.id, isPrimary: true });
      } else {
        // A field is written only when it was editable (missing OR pencil-
        // edited), non-empty, and actually changed. Existing rows are UPDATED
        // in place — never duplicated.
        const fullName = [first, last].filter(Boolean).join(' ');
        if ((needName || dlgEdit.name) && first && fullName !== contactName) {
          await api.contacts.update(contact.id, contactNamesFromParts(first, last));
        }
        if ((needPhone || dlgEdit.phone) && phone && phone !== contactPhone) {
          const row = contact.phones?.[0];
          if (row) await api.contacts.updatePhone(row.id, { value: phone });
          else await api.contacts.addPhone(contact.id, { value: phone, isPrimary: true });
        }
        if ((needEmail || dlgEdit.email) && email && email !== contactEmail) {
          const row = contact.emails?.[0];
          if (row) await api.contacts.updateEmail(row.id, { value: email });
          else await api.contacts.addEmail(contact.id, { value: email, isPrimary: true });
        }
      }
    } catch (e) {
      setPayBusy(false);
      flash(`שמירת הפרטים נכשלה: ${e?.payload?.error || e?.message || ''}`);
      return;
    }
    onRefresh?.(); // background — the action itself doesn't depend on it
    await runPayAction(action, {
      phone: phone || contactPhone,
      name: [first, last].filter(Boolean).join(' ') || contactName,
    });
  }

  // ── Derived summary — the single paid/balance derivation (header comment) ─
  const paidMinor = records ? paidMinorFromDocs(records.documents) : null;
  const balanceMinor = paidMinor == null ? null : totalMinor - paidMinor;
  const paidPct =
    paidMinor == null || totalMinor <= 0
      ? null
      : Math.min(100, Math.max(0, Math.round((paidMinor / totalMinor) * 100)));

  const openRequests = records
    ? [
        ...(records.pendingTourist
          ? [{
              key: `tourist-${records.pendingTourist.id}`,
              label: 'קישור לתשלום כרטיס תייר',
              sub: 'ממתין לתשלום',
              date: records.pendingTourist.createdAt,
              amountMinor: Math.round(Number(records.pendingTourist.amountIls || 0) * 100),
              currency: records.pendingTourist.currency,
              href: records.touristUrl,
            }]
          : []),
        ...records.customLinks.map((l) => ({
          key: `custom-${l.id}`,
          label: `קישור מותאם אישית — ${l.description}`,
          sub: 'פעיל',
          date: l.createdAt,
          amountMinor: Math.round(Number(l.amountIls || 0) * 100),
          currency: l.currency,
          href: l.url,
        })),
      ]
    : [];

  const dlg = missingDialog;
  const effPhone = dlgForm.phone.trim() || contactPhone;
  // Creating a brand-new contact requires a name; WhatsApp requires a phone.
  const canSave =
    !payBusy &&
    (contact ? true : !!dlgForm.first.trim()) &&
    (dlg?.action !== 'wa' || !!effPhone);
  const canSkip = !payBusy && (dlg?.action !== 'wa' || !!contactPhone);
  const dlgBtn = (label, onClick, { primary = false, disabled = false } = {}) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'text-sm text-white rounded px-4 py-1.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
          : 'text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-50'
      }
    >
      {label}
    </button>
  );

  return (
    <section className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 pt-3 pb-2.5">
        <h2 className="text-[13px] font-semibold text-gray-900">גבייה</h2>
        <span className="inline-flex items-center gap-2">
          {payFeedback && <span className="text-[11px] text-gray-500">{payFeedback}</span>}
          <CardKebabMenu ariaLabel="פעולות גבייה" disabled={payBusy}>
            {(close) => (
              <>
                <button type="button" disabled={payBusy} className={MENU_ITEM}
                  onClick={() => { close(); payAction('open'); }}>
                  פתח קישור לתשלום
                </button>
                <button type="button" disabled={payBusy} className={MENU_ITEM}
                  onClick={() => { close(); payAction('copy'); }}>
                  העתק קישור לתשלום
                </button>
                <button type="button" disabled={payBusy} className={MENU_ITEM}
                  onClick={() => { close(); payAction('wa'); }}>
                  שלח קישור בוואטסאפ
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button type="button" className={MENU_ITEM}
                  onClick={() => { close(); setDocModalOpen(true); }}>
                  הפק מסמך
                </button>
                <button type="button" className={MENU_ITEM}
                  onClick={() => { close(); setCustomLinkOpen(true); }}>
                  קישור לתשלום מותאם אישית
                </button>
                <button type="button" className={MENU_ITEM}
                  onClick={() => { close(); setCardcomOpen(true); }}>
                  קישור לתשלום כרטיס תייר
                </button>
                <div className="my-1 border-t border-gray-100" />
                <button type="button" className={MENU_ITEM}
                  onClick={() => { close(); setNewInvoiceOpen(true); }}>
                  שלח חשבון עסקה חדש
                </button>
              </>
            )}
          </CardKebabMenu>
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Total — always the live Price Builder headline; click opens it. */}
        <button
          type="button"
          onClick={onOpenPriceBuilder}
          title="פתח בונה מחיר"
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
        >
          <span className="text-[12px] text-gray-500">סך העסקה</span>
          <span dir="ltr" className="text-[17px] font-bold text-gray-900 tabular-nums">
            {totalMinor ? formatMinor(totalMinor, deal.currency) : '—'}
          </span>
        </button>

        {/* Records */}
        {!records && !recordsError && (
          <p className="px-2 text-[12px] text-gray-400">טוען רשומות תשלום…</p>
        )}
        {recordsError && (
          <p className="px-2 text-[12px] text-red-600">טעינת רשומות התשלום נכשלה — רעננו את העמוד.</p>
        )}
        {records && (
          <>
            {openRequests.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[11px] font-medium text-gray-400">בקשות תשלום פתוחות</div>
                {openRequests.map((r) => (
                  <RecordRow key={r.key} {...r} />
                ))}
              </div>
            )}
            <div>
              <div className="px-2 pb-1 text-[11px] font-medium text-gray-400">תשלומים ומסמכים</div>
              {records.docsFailed ? (
                <p className="px-2 text-[12px] text-amber-600">טעינת המסמכים מאייקאונט נכשלה — הרשימה והסיכום עשויים להיות חלקיים.</p>
              ) : records.documents.length === 0 ? (
                <p className="px-2 text-[12px] text-gray-400">אין עדיין תשלומים או מסמכים לעסקה זו.</p>
              ) : (
                records.documents.map((d, i) => (
                  <RecordRow
                    key={d.docnum ? `${d.doctype}-${d.docnum}` : `row-${i}`}
                    label={`${d.doctypeLabel}${d.docnum ? ` ${d.docnum}` : ''}`}
                    sub={d.clientName || null}
                    date={d.createdAt}
                    amountMinor={d.amountIls == null ? null : Math.round(Number(d.amountIls) * 100)}
                    currency={d.currency}
                    tone={PAID_SIGN[d.doctype] === 1 ? 'in' : PAID_SIGN[d.doctype] === -1 ? 'out' : 'plain'}
                    href={d.docUrl || null}
                  />
                ))
              )}
              {records.liveError && !records.docsFailed && (
                <p className="px-2 pt-1 text-[11px] text-amber-600">
                  חיפוש המסמכים באייקאונט נכשל — ייתכן שמסמכים שהופקו ישירות באייקאונט חסרים.
                </p>
              )}
            </div>

            {/* Summary — paid / balance derived above (the single place). */}
            <div className="space-y-1.5 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between px-2 text-[13px]">
                <span className="text-gray-500">שולם</span>
                <span dir="ltr" className="font-semibold text-emerald-700 tabular-nums">
                  {formatMinor(paidMinor || 0, deal.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between px-2 text-[13px]">
                <span className="text-gray-500">יתרה לגבייה</span>
                <span dir="ltr" className={`font-semibold tabular-nums ${balanceMinor > 0 ? 'text-gray-900' : 'text-emerald-700'}`}>
                  {formatMinor(balanceMinor || 0, deal.currency)}
                </span>
              </div>
              {paidPct != null && (
                <div className="flex items-center gap-2 px-2 pt-1">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">שולם {paidPct}%</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals — closing any of them may have created a record → reload. */}
      <ProduceDocumentModal dealId={deal.id} open={docModalOpen} onClose={() => { setDocModalOpen(false); reload(); }} />
      <ProduceDocumentModal
        dealId={deal.id}
        open={newInvoiceOpen}
        onClose={() => { setNewInvoiceOpen(false); reload(); }}
        sendFlow
        onIssued={(doc) => {
          setNewInvoiceOpen(false);
          setShareEntry({ data: { doctype: doc.doctype, doctypeLabel: doc.doctypeLabel, docnum: doc.docnum, docUrl: doc.docUrl } });
          reload();
        }}
      />
      <SendDocumentModal open={!!shareEntry} entry={shareEntry} deal={deal} onClose={() => setShareEntry(null)} />
      <CustomPaymentLinkModal dealId={deal.id} open={customLinkOpen} onClose={() => { setCustomLinkOpen(false); reload(); }} />
      <CardcomPaymentModal dealId={deal.id} open={cardcomOpen} onClose={() => { setCardcomOpen(false); reload(); }} />

      {/* Missing-data dialog — the only popup in the payment flow. Details are
          completed INLINE and saved to the Contact, then the action continues. */}
      <Dialog
        open={dlg !== null}
        onClose={() => (payBusy ? null : setMissingDialog(null))}
        title={dlg?.kind === 'amount' ? 'חסר מחיר לעסקה' : 'השלמת פרטי לקוח'}
        size={dlg?.kind === 'details' ? 'lg' : 'md'}
        footer={
          dlg?.kind === 'amount' ? (
            <>
              {dlgBtn('ביטול', () => setMissingDialog(null))}
              {dlgBtn('פתח בונה מחיר', () => { setMissingDialog(null); onOpenPriceBuilder(); }, { primary: true })}
            </>
          ) : (
            <>
              {dlgBtn('ביטול', () => setMissingDialog(null), { disabled: payBusy })}
              {dlgBtn('המשך בלי הפרטים', () => runPayAction(dlg.action), { disabled: !canSkip })}
              {dlgBtn(payBusy ? 'שומר…' : 'שמור והמשך', saveDetailsAndContinue, { primary: true, disabled: !canSave })}
            </>
          )
        }
      >
        {dlg?.kind === 'amount' && (
          <p className="text-sm text-gray-800">
            לא ניתן ליצור קישור תשלום ללא סכום — אייקאונט דורש פריט עם מחיר.
            קבעו מחיר לעסקה בבונה המחיר ונסו שוב.
          </p>
        )}
        {dlg?.kind === 'details' && (
          <div className="space-y-5 py-1">
            <p className="text-sm text-gray-800">
              {contact
                ? 'אלה פרטי הלקוח שימולאו מראש בעמוד התשלום. השלימו את החסר — ואפשר גם לתקן פרט קיים בלחיצה על העיפרון. הכל נשמר על איש הקשר של הדיל.'
                : 'לדיל אין עדיין איש קשר. מלאו את הפרטים כאן — ייווצר איש קשר ראשי לדיל וישמש לעמוד התשלום.'}
            </p>
            <div className="space-y-4">
              {/* The full known picture: existing values read-only (pencil turns
                  just that field editable), missing ones editable from the start. */}
              <FieldBox label={dlg.needName && !contact ? 'שם *' : 'שם'}>
                {dlg.needName || dlgEdit.name ? (
                  <div className="grid grid-cols-2 gap-3">
                    <input autoFocus placeholder="שם פרטי" value={dlgForm.first} className={DLG_FIELD}
                      onChange={(e) => setDlgForm((s) => ({ ...s, first: e.target.value }))} />
                    <input placeholder="שם משפחה" value={dlgForm.last} className={DLG_FIELD}
                      onChange={(e) => setDlgForm((s) => ({ ...s, last: e.target.value }))} />
                  </div>
                ) : (
                  <DlgKnownValue onEdit={() => startDlgEdit('name')}>{contactName}</DlgKnownValue>
                )}
              </FieldBox>
              <FieldBox label={dlg.needPhone && dlg.action === 'wa' ? 'טלפון *' : 'טלפון'}>
                {dlg.needPhone || dlgEdit.phone ? (
                  <input autoFocus={dlgEdit.phone || !dlg.needName} placeholder="050-0000000"
                    value={dlgForm.phone} dir="ltr" className={DLG_FIELD}
                    onChange={(e) => setDlgForm((s) => ({ ...s, phone: e.target.value }))} />
                ) : (
                  <DlgKnownValue dir="ltr" onEdit={() => startDlgEdit('phone')}>{contactPhone}</DlgKnownValue>
                )}
              </FieldBox>
              <FieldBox label="אימייל">
                {dlg.needEmail || dlgEdit.email ? (
                  <input autoFocus={dlgEdit.email || (!dlg.needName && !dlg.needPhone)} placeholder="name@example.com"
                    value={dlgForm.email} dir="ltr" className={DLG_FIELD}
                    onChange={(e) => setDlgForm((s) => ({ ...s, email: e.target.value }))} />
                ) : (
                  <DlgKnownValue dir="ltr" onEdit={() => startDlgEdit('email')}>{contactEmail}</DlgKnownValue>
                )}
              </FieldBox>
            </div>
            <p className="text-[12px] text-gray-500">
              אפשר גם להמשיך בלי הפרטים — הלקוח ישלים אותם בעמוד התשלום של אייקאונט.
            </p>
          </div>
        )}
      </Dialog>
    </section>
  );
}
