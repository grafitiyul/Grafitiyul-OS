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
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_STYLES,
} from '../collection/collectionConfig.js';

// גבייה — the Deal's financial DASHBOARD (not a pricing editor) and the single
// home of all payment actions (header ⋮ menu).
//
// All numbers come from the server Collection service (GET /:id/collection —
// server/src/collection.js), the single source of truth for paid/balance:
// "paid" counts ONLY actual money received (קבלה / חשבונית מס קבלה, minus
// זיכויים). Open payment links / pending requests are reachable through the
// actions menu but are NOT rows here — a link becomes a row only once a real
// receipt-type document exists. The client performs NO financial math.

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

// One actual-payment row (server `payments`): receipt-type in green, credit
// notes in red. Clicking opens the document when a docUrl exists.
function PaymentRow({ row }) {
  const out = row.direction === 'out';
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-gray-800">
          {row.doctypeLabel}
          {row.docnum ? ` ${row.docnum}` : ''}
        </span>
        <span className="block truncate text-[11px] text-gray-400">
          {[row.clientName, fmtDay(row.createdAt)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span
        dir="ltr"
        className={`shrink-0 text-[13px] font-medium tabular-nums ${out ? 'text-red-600' : 'text-emerald-700'}`}
      >
        {out ? '−' : ''}{formatMinor(row.amountMinor, row.currency)}
      </span>
    </>
  );
  const cls = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1.5';
  return row.docUrl ? (
    <a href={row.docUrl} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-gray-50`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default function DealCollectionCard({ deal, productName, onOpenPriceBuilder, onRefresh }) {
  // ── Server collection summary — the ONLY source of the numbers below ─────
  const [summary, setSummary] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSummary(await api.deals.collection(deal.id));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [deal.id]);

  // Refetch on mount and whenever the Price Builder headline changes — the
  // server total mirrors Deal.valueMinor and must never show stale.
  useEffect(() => {
    reload();
  }, [reload, deal.valueMinor]);

  // ── Payment actions (entry points only — flows live in their modals) ─────
  const [payBusy, setPayBusy] = useState(false);
  const [payFeedback, setPayFeedback] = useState(null);
  const [missingDialog, setMissingDialog] = useState(null); // { action, kind: 'amount'|'details', needName, needPhone, needEmail }
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [customLinkOpen, setCustomLinkOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
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

  const paidPct = summary?.paidPct;
  const barPct = paidPct == null ? null : Math.min(100, Math.max(0, paidPct));

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
          {summary && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                COLLECTION_STATUS_STYLES[summary.status] || 'bg-gray-100 text-gray-500'
              }`}
            >
              {COLLECTION_STATUS_LABELS[summary.status] || summary.status}
            </span>
          )}
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
                  onClick={() => { close(); setDepositOpen(true); }}>
                  תשלום מקדמה
                </button>
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
        {/* Total — read-only. Pricing is edited in the Quote / Price Builder
            area; this card is a financial dashboard. */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[12px] text-gray-500">סך העסקה</span>
          <span dir="ltr" className="text-[17px] font-bold text-gray-900 tabular-nums">
            {totalMinor ? formatMinor(totalMinor, deal.currency) : '—'}
          </span>
        </div>

        {/* Actual payments only — links/requests never appear here. */}
        {!summary && !loadError && (
          <p className="px-2 text-[12px] text-gray-400">טוען נתוני גבייה…</p>
        )}
        {loadError && (
          <p className="px-2 text-[12px] text-red-600">טעינת נתוני הגבייה נכשלה — רעננו את העמוד.</p>
        )}
        {summary && (
          <>
            <div>
              <div className="px-2 pb-1 text-[11px] font-medium text-gray-400">תשלומים שהתקבלו</div>
              {summary.payments.length === 0 ? (
                <p className="px-2 text-[12px] text-gray-400">עדיין לא התקבלו תשלומים לעסקה זו.</p>
              ) : (
                summary.payments.map((row) => <PaymentRow key={row.id} row={row} />)
              )}
            </div>

            {/* Summary — server numbers, rendered as-is. */}
            <div className="space-y-1.5 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between px-2 text-[13px]">
                <span className="text-gray-500">שולם</span>
                <span dir="ltr" className="font-semibold text-emerald-700 tabular-nums">
                  {formatMinor(summary.paidMinor, summary.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between px-2 text-[13px]">
                <span className="text-gray-500">יתרה לגבייה</span>
                <span dir="ltr" className={`font-semibold tabular-nums ${summary.balanceMinor > 0 ? 'text-gray-900' : 'text-emerald-700'}`}>
                  {formatMinor(summary.balanceMinor, summary.currency)}
                </span>
              </div>
              {paidPct != null && (
                <div className="flex items-center gap-2 px-2 pt-1">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">שולם {paidPct}%</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals — closing any of them may have created a payment record
          (e.g. a receipt was issued) → reload the server summary. */}
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
      <CustomPaymentLinkModal dealId={deal.id} open={customLinkOpen} onClose={() => setCustomLinkOpen(false)} />
      {/* תשלום מקדמה — the SAME custom-payment-link flow, configured as a
          deposit: product prefilled as the line description, amount capped by
          the remaining balance. The link itself never counts as paid. */}
      <CustomPaymentLinkModal
        dealId={deal.id}
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title="תשלום מקדמה"
        intro="קישור לתשלום מקדמה על חשבון העסקה. הקישור עצמו אינו נספר כתשלום — הסכום ייכלל בגבייה רק כאשר תופק קבלה / חשבונית מס קבלה בפועל."
        defaultDescription={productName || ''}
        defaultNotes="מקדמה"
        maxAmountIls={summary && summary.balanceMinor > 0 ? summary.balanceMinor / 100 : null}
        maxLabel="היתרה לגבייה"
      />
      <CardcomPaymentModal dealId={deal.id} open={cardcomOpen} onClose={() => setCardcomOpen(false)} />

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
