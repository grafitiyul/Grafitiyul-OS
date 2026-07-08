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
// One active (pending) request per deal: opening the action REOPENS the existing
// pending request in edit mode instead of creating a second. Editing keeps the
// same GOS link.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

const CARDCOM_ERROR = {
  cardcom_not_configured: 'סליקת קארדקום אינה מוגדרת עדיין (חסרים פרטי טרמינל/מפתח). פנו למנהל המערכת.',
  cardcom_request_failed: 'יצירת עמוד התשלום בקארדקום נכשלה.',
  cardcom_timeout: 'קארדקום לא הגיב בזמן. נסו שוב.',
  currency_unsupported: 'מטבע לא נתמך.',
  amount_invalid: 'סכום לא תקין.',
  product_description_required: 'נדרש תיאור מוצר באנגלית.',
};
function friendly(e) {
  const code = e?.payload?.error || e?.code || '';
  return CARDCOM_ERROR[code] || e?.payload?.reason || code || 'אירעה שגיאה. נסו שוב.';
}

export default function CardcomPaymentModal({ dealId, open, onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [reqId, setReqId] = useState(null); // set → edit mode (existing pending)
  const [currencies, setCurrencies] = useState(['ILS', 'USD', 'EUR']);
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    productDescriptionEn: '',
    amount: '',
    currency: 'ILS',
    quantity: '1',
  });
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
        const { defaults, activeRequest, publicUrl } = await api.deals.touristPayment(dealId);
        if (cancelled) return;
        setCurrencies(defaults.supportedCurrencies || ['ILS', 'USD', 'EUR']);
        if (activeRequest) {
          setReqId(activeRequest.id);
          setLink(publicUrl);
          setForm({
            customerName: activeRequest.customerName || '',
            customerEmail: activeRequest.customerEmail || '',
            customerPhone: activeRequest.customerPhone || '',
            productDescriptionEn: activeRequest.productDescriptionEn || '',
            amount: String(activeRequest.amountIls ?? ''),
            currency: activeRequest.currency || 'ILS',
            quantity: String(activeRequest.quantity || 1),
          });
        } else {
          setReqId(null);
          setForm({
            customerName: defaults.customerName || '',
            customerEmail: defaults.customerEmail || '',
            customerPhone: defaults.customerPhone || '',
            productDescriptionEn: defaults.productDescriptionEn || '',
            amount: defaults.amountIls ? String(defaults.amountIls) : '',
            currency: defaults.currency || 'ILS',
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
  const amountNum = Number(form.amount);
  const canSubmit =
    !busy && form.productDescriptionEn.trim() && Number.isFinite(amountNum) && amountNum > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const payload = {
      customerName: form.customerName.trim() || null,
      customerEmail: form.customerEmail.trim() || null,
      customerPhone: form.customerPhone.trim() || null,
      productDescriptionEn: form.productDescriptionEn.trim(),
      amountIls: amountNum,
      currency: form.currency,
      quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
    };
    try {
      const res = reqId
        ? await api.deals.editTouristPayment(dealId, reqId, payload)
        : await api.deals.createTouristPayment(dealId, payload);
      setReqId(res.request.id);
      setLink(res.publicUrl);
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
          {reqId && (
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
            <button type="button" onClick={submit} disabled={!canSubmit}
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

          <label className="block text-[12px] text-gray-600">
            תיאור המוצר / השירות (אנגלית) *
            <input value={form.productDescriptionEn} onChange={set('productDescriptionEn')} dir="ltr" className={`mt-1 ${FIELD}`}
              placeholder="e.g. Graffiti workshop" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-gray-600">
              סכום לתשלום (כולל מע״מ) *
              <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} dir="ltr" className={`mt-1 ${FIELD}`} />
            </label>
            <label className="block text-[12px] text-gray-600">
              מטבע
              <select value={form.currency} onChange={set('currency')} className={`mt-1 ${FIELD}`}>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="text-[13px] text-red-600">שגיאה: <span dir="ltr" className="font-mono">{error}</span></p>
          )}
        </div>
      )}
    </Dialog>
  );
}
