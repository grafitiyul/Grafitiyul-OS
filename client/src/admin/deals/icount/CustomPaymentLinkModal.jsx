import { useEffect, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { emitDealTasksChanged } from '../tasks/taskEvents.js';
import { friendlyIcountError } from './icountErrors.js';

// "קישור לתשלום מותאם אישית" — a payment link whose invoice line/amount
// intentionally differ from the deal's products (the customer asked for a
// different description on the document). The payment still flows through the
// SAME deal + iCount pipeline (GOS /pay/c/<token> redirect, ipn carries the
// dealId); the override is recorded as a visible timeline event so it is never
// hidden. The deal's regular payment link is untouched.
//
// The DEPOSIT flow ("תשלום מקדמה") is this exact same flow, configured by
// props: `title`/`intro` rebrand the dialog, `defaultDescription` prefills the
// deal's product as the invoice line, `defaultNotes` tags the link internally,
// and `maxAmountIls` caps the amount at the remaining balance. No separate
// payment logic exists for deposits.

const FIELD = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

export default function CustomPaymentLinkModal({
  dealId,
  open,
  onClose,
  title = 'קישור לתשלום מותאם אישית',
  intro = 'הקישור יציג ללקוח תיאור מוצר וסכום מותאמים (למשל כשהלקוח מבקש ניסוח אחר בחשבונית) — מאחורי הקלעים התשלום נשאר משויך לדיל ולתהליך הרגיל.',
  defaultDescription = '',
  defaultNotes = '',
  maxAmountIls = null,
  maxLabel = 'הסכום המרבי',
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // { url, ready, generateError }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription(defaultDescription || '');
    setAmount('');
    setNotes(defaultNotes || '');
    setError(null);
    setCreated(null);
    setCopied(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = Number(amount);
  const overMax = maxAmountIls != null && Number.isFinite(amountNum) && amountNum > maxAmountIls;
  const canCreate =
    !busy && description.trim() && Number.isFinite(amountNum) && amountNum > 0 && !overMax;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.deals.createCustomPaymentLink(dealId, {
        description: description.trim(),
        amountIls: amountNum,
        notes: notes.trim() || null,
      });
      setCreated({ url: res.link.url, ready: res.ready, generateError: res.generateError });
      emitDealTasksChanged(dealId); // surfaces the new timeline event
    } catch (e) {
      setError(friendlyIcountError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
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
      title={title}
      size="md-wide"
      footer={
        created ? (
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            סגירה
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
              ביטול
            </button>
            <button type="button" onClick={create} disabled={!canCreate}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'יוצר…' : 'יצירת קישור'}
            </button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3 py-2">
          <p className="text-sm font-semibold text-emerald-700">✓ הקישור נוצר ונשמר על הדיל</p>
          <div className="flex items-center gap-2">
            <input readOnly value={created.url} dir="ltr" className={`${FIELD} bg-gray-50 text-[12.5px]`} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copy}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
              {copied ? '✓ הועתק' : 'העתקה'}
            </button>
            <button type="button" onClick={() => window.open(created.url, '_blank', 'noopener')}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
              פתיחה
            </button>
          </div>
          {!created.ready && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              ⚠ עמוד התשלום ב־iCount עדיין לא נוצר ({created.generateError}). הקישור ינסה ליצור אותו שוב כשהלקוח יפתח אותו —
              מומלץ לוודא את הגדרות iCount לפני שליחה ללקוח.
            </p>
          )}
          <p className="text-[12px] text-gray-500">
            נרשם אירוע בציר הזמן של הדיל. התשלום יקושר לדיל הזה כרגיל — רק התיאור והסכום בעמוד התשלום מותאמים.
          </p>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          <p className="text-[13px] text-gray-600">{intro}</p>
          <label className="block text-[12px] text-gray-600">
            תיאור המוצר / השירות בחשבונית *
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={`mt-1 ${FIELD}`}
              placeholder="לדוגמה: סדנת גרפיטי לצוות" />
          </label>
          <label className="block text-[12px] text-gray-600">
            סכום לתשלום (₪, כולל מע״מ) *
            <input type="number" min="0" step="0.01" value={amount} dir="ltr" onChange={(e) => setAmount(e.target.value)} className={`mt-1 ${FIELD}`} />
            {maxAmountIls != null && (
              <span className={`mt-1 block text-[11.5px] ${overMax ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                {overMax
                  ? `הסכום גבוה מ${maxLabel} — ₪${maxAmountIls.toLocaleString('he-IL')}`
                  : `${maxLabel}: ₪${maxAmountIls.toLocaleString('he-IL')}`}
              </span>
            )}
          </label>
          <label className="block text-[12px] text-gray-600">
            הערה פנימית (רשות)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${FIELD}`} />
          </label>
          {error && (
            <p className="text-[13px] text-red-600">שגיאה: <span dir="ltr" className="font-mono">{error}</span></p>
          )}
        </div>
      )}
    </Dialog>
  );
}
