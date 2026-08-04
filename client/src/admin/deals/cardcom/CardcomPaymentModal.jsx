import { useEffect, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { emitDealTasksChanged } from '../tasks/taskEvents.js';

// "קישור לתשלום כרטיס תייר" — a Cardcom tourist-card (3D-Secure) payment link.
//
// Separate provider from the iCount links: Cardcom ONLY clears; iCount stays the
// accounting provider. The customer receives a stable GOS URL
// (/payment/cardcom/<token>); the Cardcom page (English, no Israeli ID) is minted
// lazily when they open it. Accounting policy is FIXED (auto-issue חשבונית מס קבלה
// in English after payment, never auto-sent, VAT from the Deal) — not shown here.
//
// The DEAL is the Single Source of Truth while pending: amount / currency / VAT
// are shown READ-ONLY here and stay synchronized with the Deal automatically
// (edit them through the normal Deal workflow). Operator-owned fields: customer
// details, the English description wording, quantity.
//
// One active (pending) request per deal: opening the action REOPENS the existing
// pending request in edit mode instead of creating a second. Editing keeps the
// same GOS link.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

const CARDCOM_ERROR = {
  cardcom_not_configured: 'סליקת קארדקום אינה מוגדרת עדיין (חסרים פרטי טרמינל/מפתח). פנו למנהל המערכת.',
  cardcom_webhook_not_configured: 'חסר סוד Webhook לקארדקום (CARDCOM_WEBHOOK_SECRET) — בלעדיו אישורי תשלום לא יגיעו. פנו למנהל המערכת.',
  cardcom_request_failed: 'יצירת עמוד התשלום בקארדקום נכשלה.',
  cardcom_timeout: 'קארדקום לא הגיב בזמן. נסו שוב.',
  currency_unsupported: 'מטבע לא נתמך.',
  amount_missing: 'לעסקה אין סכום — קבעו שווי עסקה קודם.',
  product_description_required: 'נדרש תיאור מוצר באנגלית.',
  invoice_email_requires_customer_email: 'סומן ״שלח את החשבונית ללקוח״ אך לא הוזן אימייל ללקוח — הזינו אימייל או בטלו את הסימון.',
};
function friendly(e) {
  const code = e?.payload?.error || e?.code || '';
  return CARDCOM_ERROR[code] || e?.payload?.reason || code || 'אירעה שגיאה. נסו שוב.';
}

// Payment-attempt lifecycle, in business language (no provider jargon).
const STATE_LABEL = {
  pending: { text: 'הקישור פעיל — הלקוח טרם פתח את עמוד התשלום', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  awaiting_payment: { text: 'עמוד תשלום פתוח — ממתין לתשלום הלקוח', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  payment_returned: { text: 'הלקוח סיים בדף התשלום — ממתין לאימות התשלום', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  failed: { text: 'ניסיון התשלום נכשל — הלקוח יכול לנסות שוב מאותו קישור', cls: 'bg-red-50 text-red-700 border-red-200' },
};

const fmtTs = (v) => (v ? new Date(v).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : null);

function LifecycleRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between text-[11.5px] text-gray-600">
      <span>{label}</span>
      <span className="font-medium text-gray-800" dir="ltr">{value}</span>
    </div>
  );
}

export default function CardcomPaymentModal({ dealId, open, onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [reqId, setReqId] = useState(null); // set → edit mode (existing active)
  const [reqInfo, setReqInfo] = useState(null); // full active request — lifecycle visibility
  const [enSource, setEnSource] = useState(null); // 'variant' | 'product' | 'request' | null
  const [canonicalEn, setCanonicalEn] = useState(''); // the Deal's current canonical label
  // Deal-owned (read-only, kept in sync with the Deal by the server).
  const [dealAmount, setDealAmount] = useState({ amount: 0, currency: 'ILS' });
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    productDescriptionEn: '',
    quantity: '1',
  });
  // "שלח את החשבונית ללקוח לאחר התשלום" — default OFF; frozen onto the
  // request at create/update (never read from UI state after payment).
  const [emailInvoice, setEmailInvoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState(null); // stable GOS URL (create or edit result)
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLink(null);
    setCopied(false);
    (async () => {
      try {
        const { defaults, activeRequest, publicUrl, canonicalProductDescriptionEn } =
          await api.deals.touristPayment(dealId);
        if (cancelled) return;
        // The Deal's CURRENT canonical label — what "reset to default" restores,
        // and the yardstick for deciding whether an edit is a real override.
        setCanonicalEn(canonicalProductDescriptionEn || '');
        // Amount + currency always come from the Deal (server keeps a pending
        // request in sync with it) — displayed, never edited here.
        setDealAmount({
          amount: activeRequest ? activeRequest.amountIls : defaults.amountIls,
          currency: activeRequest ? activeRequest.currency : defaults.currency || 'ILS',
        });
        setReqInfo(activeRequest || null);
        // Where the English description came from — drives the prefill note and
        // the "no English name on this deal" warning. Read ONCE per open, so a
        // later render can never overwrite what the operator typed.
        setEnSource(activeRequest ? 'request' : defaults.productDescriptionEnSource || null);
        if (activeRequest) {
          setReqId(activeRequest.id);
          setLink(publicUrl);
          setEmailInvoice(!!activeRequest.emailInvoiceToCustomer);
          setForm({
            customerName: activeRequest.customerName || '',
            customerEmail: activeRequest.customerEmail || '',
            customerPhone: activeRequest.customerPhone || '',
            productDescriptionEn: activeRequest.productDescriptionEn || '',
            quantity: String(activeRequest.quantity || 1),
          });
        } else {
          setEmailInvoice(false);
          setReqId(null);
          setForm({
            customerName: defaults.customerName || '',
            customerEmail: defaults.customerEmail || '',
            customerPhone: defaults.customerPhone || '',
            productDescriptionEn: defaults.productDescriptionEn || '',
            quantity: '1',
          });
        }
      } catch (e) {
        if (!cancelled) setError(friendly(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const dealHasAmount = Number(dealAmount.amount) > 0;
  // While the customer is back from Cardcom and the payment is being verified,
  // the request is FROZEN: no edits, no cancel — the money may already be real.
  const verifying = reqInfo?.status === 'payment_returned';
  const canSubmit =
    !busy && !verifying && form.productDescriptionEn.trim() && dealHasAmount
    // Requesting an invoice email without an address is refused (the server
    // enforces the same rule) — never a silent "will be sent".
    && !(emailInvoice && !form.customerEmail.trim());
  // The deal carries no English product identity at all — the operator must
  // write one. Shown only while the field is genuinely empty: the moment they
  // type, the warning is answered and gets out of the way.
  const missingEnglishName = !form.productDescriptionEn.trim() && !enSource && !canonicalEn;
  // The default is ALWAYS the product's plain English name (Product.nameEn) —
  // never variant wording, duration or location (Slice G owner decision).
  const englishPrefillNote =
    enSource === 'product' ? 'מולא אוטומטית משם המוצר באנגלית. ניתן לערוך.' : null;
  // A REAL override = the text differs from the Deal's current canonical label.
  // Computed from what is on screen, so it reflects the operator's live edit —
  // and is exactly the flag sent to the server, which decides ownership the
  // same way. Re-saving the canonical text is never an override.
  const isOverride = !!canonicalEn && form.productDescriptionEn.trim() !== canonicalEn;

  async function submit({ resetDescription = false } = {}) {
    if (resetDescription ? busy || verifying : !canSubmit) return;
    setBusy(true);
    setError(null);
    // Operator-owned fields only — amount/currency/VAT derive from the Deal.
    // `productDescriptionOverride` is the EXPLICIT ownership claim: only a real
    // operator edit sets it, so nothing else can freeze wording as manual.
    const description = resetDescription ? canonicalEn : form.productDescriptionEn.trim();
    const payload = {
      customerName: form.customerName.trim() || null,
      customerEmail: form.customerEmail.trim() || null,
      customerPhone: form.customerPhone.trim() || null,
      productDescriptionEn: description,
      productDescriptionOverride: resetDescription ? false : isOverride,
      quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
      emailInvoiceToCustomer: emailInvoice,
    };
    try {
      const res = reqId
        ? await api.deals.editTouristPayment(dealId, reqId, payload)
        : await api.deals.createTouristPayment(dealId, payload);
      setReqId(res.request.id);
      setLink(res.publicUrl);
      // Show exactly what the server stored — the field and the Cardcom payload
      // must never disagree.
      setForm((s) => ({ ...s, productDescriptionEn: res.request.productDescriptionEn || '' }));
      setReqInfo(res.request);
      emitDealTasksChanged(dealId);
      onChanged?.();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!reqId || busy) return;
    if (!window.confirm('לבטל את קישור התשלום? הקישור שנשלח ללקוח יפסיק לעבוד.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deals.cancelTouristPayment(dealId, reqId);
      emitDealTasksChanged(dealId);
      onChanged?.();
      onClose();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible for manual copy */
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? null : onClose}
      title="קישור לתשלום כרטיס תייר"
      size="md-wide"
      footer={
        <div className="flex w-full items-center gap-2">
          {reqId && !verifying && (
            <button type="button" onClick={cancelRequest} disabled={busy}
              className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
              ביטול הקישור
            </button>
          )}
          <div className="mr-auto flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
              סגירה
            </button>
            <button type="button" onClick={() => submit()} disabled={!canSubmit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'שומר…' : reqId ? 'עדכון ויצירת קישור' : 'יצירת קישור'}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-500">טוען…</div>
      ) : (
        <div className="space-y-3 py-1">
          <p className="text-[13px] text-gray-600">
            עמוד תשלום באנגלית לכרטיס תייר (3D Secure) דרך קארדקום — ללא צורך בת.ז ישראלית.
            הלקוח מקבל קישור GOS קבוע; לאחר התשלום תופק אוטומטית חשבונית מס קבלה באנגלית.
          </p>

          {reqInfo && (
            <div className={`space-y-1.5 rounded-lg border px-3 py-2.5 ${(STATE_LABEL[reqInfo.status] || STATE_LABEL.pending).cls}`}>
              <p className="text-[12.5px] font-semibold">
                {(STATE_LABEL[reqInfo.status] || STATE_LABEL.pending).text}
                {reqInfo.attemptNo > 1 ? ` · ניסיון ${reqInfo.attemptNo}` : ''}
              </p>
              {verifying && (
                <p className="text-[12px]">
                  אין לשלוח קישור תשלום נוסף ואין לגבות ידנית לפני שהאימות מסתיים — ייתכן שהתשלום כבר בוצע.
                </p>
              )}
              {reqInfo.verifyHold && (
                <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[12px] font-semibold text-red-700">
                  האימות מצא אי-התאמה ונדרשת בדיקה ידנית: <span dir="ltr">{reqInfo.verifyHold}</span>
                </p>
              )}
              {reqInfo.status === 'failed' && reqInfo.failReason && (
                <p className="text-[11.5px]" dir="ltr">{reqInfo.failReason}</p>
              )}
              <div className="space-y-0.5 border-t border-black/5 pt-1.5">
                <LifecycleRow label="הקישור נוצר" value={fmtTs(reqInfo.createdAt)} />
                <LifecycleRow label="הלקוח חזר מדף התשלום" value={fmtTs(reqInfo.returnedAt)} />
                <LifecycleRow label="התקבל אישור מקארדקום" value={fmtTs(reqInfo.webhookAt)} />
                <LifecycleRow label="בדיקת אימות אחרונה" value={fmtTs(reqInfo.lastVerifyAt)} />
                <LifecycleRow label="מזהה עמוד תשלום" value={reqInfo.cardcomLowProfileId ? `…${String(reqInfo.cardcomLowProfileId).slice(-8)}` : null} />
              </div>
            </div>
          )}

          {link && (
            <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
              <p className="text-[12.5px] font-semibold text-emerald-700">
                ✓ הקישור {reqId ? 'פעיל' : 'נוצר'} — זהו הקישור הקבוע ללקוח (נשאר זהה גם לאחר עריכה)
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={link} dir="ltr" className={`${FIELD} bg-white text-[12.5px]`} onFocus={(e) => e.target.select()} />
                <button type="button" onClick={copy}
                  className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
                  {copied ? '✓ הועתק' : 'העתקה'}
                </button>
              </div>
            </div>
          )}

          <fieldset disabled={verifying} className={verifying ? 'opacity-60' : ''}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-[12px] text-gray-600">
              שם הלקוח
              <input value={form.customerName} onChange={set('customerName')} className={`mt-1 ${FIELD}`} />
            </label>
            <label className="block text-[12px] text-gray-600">
              אימייל
              <input value={form.customerEmail} onChange={set('customerEmail')} dir="ltr" className={`mt-1 ${FIELD}`} />
            </label>
            <label className="block text-[12px] text-gray-600">
              טלפון
              <input value={form.customerPhone} onChange={set('customerPhone')} dir="ltr" className={`mt-1 ${FIELD}`} />
            </label>
            <label className="block text-[12px] text-gray-600">
              כמות
              <input type="number" min="1" step="1" value={form.quantity} onChange={set('quantity')} dir="ltr" className={`mt-1 ${FIELD}`} />
            </label>
          </div>

          <label className="mt-3 block text-[12px] text-gray-600">
            תיאור המוצר / השירות (אנגלית) *
            {/* maxLength matches the provider's own limit, so the text the
                operator sees IS exactly the text Cardcom receives. */}
            <input value={form.productDescriptionEn} onChange={set('productDescriptionEn')} dir="ltr" maxLength={250}
              className={`mt-1 ${FIELD}`} placeholder="e.g. Graffiti workshop" />
          </label>
          {missingEnglishName ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              לעסקה אין שם מוצר באנגלית, ולכן לא היה במה למלא את השדה אוטומטית.
              הלקוח רואה את הטקסט הזה בדף התשלום ובחשבונית — הזינו תיאור באנגלית ידנית,
              או הוסיפו שם אנגלי למוצר בקטלוג כדי שימולא אוטומטית בפעם הבאה.
            </p>
          ) : isOverride ? (
            /* The wording no longer matches the deal's product/variant — say so
               plainly and offer the one-click way back. */
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2">
              <span className="text-[12px] text-blue-800">
                טקסט מותאם ידנית. ברירת המחדל — שם המוצר באנגלית:
                <span dir="ltr" className="mx-1 font-semibold">{canonicalEn}</span>
              </span>
              <button type="button" onClick={() => submit({ resetDescription: true })} disabled={busy || verifying}
                className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                איפוס לברירת המחדל
              </button>
            </div>
          ) : (
            englishPrefillNote && <p className="text-[11.5px] text-gray-500">{englishPrefillNote}</p>
          )}
          </fieldset>

          {/* Invoice email — the document is ALWAYS issued after verified
              payment; this controls only whether it is emailed to the customer
              (frozen onto the request now, never re-read after payment). */}
          <div className="mt-3">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-gray-700">
              <input
                type="checkbox"
                checked={emailInvoice}
                onChange={(e) => setEmailInvoice(e.target.checked)}
                disabled={verifying}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-300"
              />
              שלח את החשבונית ללקוח לאחר התשלום
            </label>
            {emailInvoice && !form.customerEmail.trim() && (
              <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-800">
                לא הוזן אימייל ללקוח — לא ניתן לשלוח את החשבונית בלי כתובת. הזינו אימייל למעלה או בטלו את הסימון.
              </p>
            )}
            {reqInfo?.invoiceEmailOutcome && (
              <p className="mt-1 text-[11.5px] text-gray-500">
                {reqInfo.invoiceEmailOutcome === 'sent'
                  ? 'החשבונית נשלחה ללקוח במייל בעת ההפקה.'
                  : reqInfo.invoiceEmailOutcome === 'doc_failed'
                    ? 'הפקת המסמך נכשלה — החשבונית לא נשלחה.'
                    : 'שליחת החשבונית דולגה — לא הייתה כתובת מייל.'}
              </p>
            )}
          </div>

          {/* Deal-owned: read-only here, synchronized with the Deal automatically
              (also while the link is already out with the customer). */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[12px] text-gray-600">
              סכום לתשלום (מהעסקה, כולל מע״מ)
              <span className="mr-2 text-[14px] font-semibold text-gray-900" dir="ltr">
                {Number(dealAmount.amount || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })} {dealAmount.currency}
              </span>
            </p>
            <p className="mt-0.5 text-[11.5px] text-gray-500">
              הסכום, המטבע והמע״מ נלקחים מהעסקה ונשארים מסונכרנים אליה אוטומטית — לעדכון, ערכו את העסקה.
              הקישור ללקוח נשאר זהה.
            </p>
          </div>
          {!dealHasAmount && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              לעסקה אין עדיין סכום — קבעו שווי עסקה לפני יצירת קישור תשלום.
            </p>
          )}

          {error && (
            <p className="text-[13px] text-red-600">שגיאה: <span dir="ltr" className="font-mono">{error}</span></p>
          )}
        </div>
      )}
    </Dialog>
  );
}
