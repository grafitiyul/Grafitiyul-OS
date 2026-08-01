import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import { DateField } from '../../common/pickers/DateTimeFields.jsx';
import { formatMinor } from '../../../lib/money.js';

// "רישום תשלום ידני" — the operator records money that reached the business
// without an iCount document GOS can see: a bank transfer, a historical payment
// whose paperwork is lost, or an explicit decision to close a remaining balance.
//
// THE PRODUCT RULE THIS SCREEN ENFORCES
// Manual money is real money for the balance, and it is never dressed up as an
// accounting document. The dialog says so on screen, the record lands in its own
// table, and the panel renders it with its own badge. "שולם במלואו" does not set
// a flag that hides the balance — it records the exact outstanding amount as an
// auditable adjustment, which is why the remaining sum is shown before you
// confirm it.

const FIELD =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

const KINDS = [
  {
    key: 'settlement',
    title: 'שולם במלואו',
    hint: 'סגירת היתרה שנותרה — נרשמת כסכום מדויק, לא כדגל',
  },
  {
    key: 'manual_payment',
    title: 'תשלום חלקי',
    hint: 'התקבל תשלום על חשבון העסקה',
  },
  {
    key: 'manual_credit',
    title: 'זיכוי / החזר',
    hint: 'כסף שהוחזר ללקוח או נמחק מהחוב',
  },
];

const ERRORS = {
  amount_invalid: 'סכום לא תקין',
  date_invalid: 'תאריך לא תקין',
  invalid_method: 'אמצעי תשלום לא נתמך',
  nothing_outstanding: 'אין יתרה פתוחה לסגירה בעסקה זו',
  file_not_found: 'הקובץ המצורף לא נמצא בעסקה',
  invalid_kind: 'סוג רישום לא תקין',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ManualPaymentModal({ dealId, open, currency = 'ILS', onClose, onSaved }) {
  const [kind, setKind] = useState('settlement');
  const [amountIls, setAmountIls] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso);
  const [method, setMethod] = useState('banktransfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [methods, setMethods] = useState([]);
  const [preview, setPreview] = useState(null); // settlement: the outstanding balance
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!open) return;
    setKind('settlement');
    setAmountIls('');
    setPaidAt(todayIso());
    setMethod('banktransfer');
    setReference('');
    setNote('');
    setFile(null);
    setError(null);
    (async () => {
      try {
        const [summary, prev] = await Promise.all([
          api.deals.collection(dealId),
          api.deals.collectionSettlementPreview(dealId),
        ]);
        setMethods(summary.paymentMethods || []);
        setPreview(prev);
      } catch {
        setPreview(null);
      }
    })();
  }, [open, dealId]);

  const isSettlement = kind === 'settlement';
  const outstanding = preview?.balanceMinor ?? null;
  const canSave =
    !busy &&
    !uploading &&
    (isSettlement ? outstanding != null && outstanding > 0 : Number(amountIls) > 0);

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // The supporting file is uploaded through the SAME unified Deal Files
      // infrastructure as every other document; the evidence row only points
      // at it. It is proof the operator holds — never an iCount document.
      let fileId = null;
      if (file) {
        setUploading(true);
        const uploaded = await api.dealFiles.upload(dealId, file);
        fileId = uploaded.id;
        setUploading(false);
      }
      const summary = await api.deals.recordCollectionEvidence(dealId, {
        kind,
        ...(isSettlement ? {} : { amountIls: Number(amountIls) }),
        paidAt,
        currency,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        fileId: fileId || undefined,
      });
      onSaved?.(summary);
      onClose();
    } catch (e) {
      setUploading(false);
      setError(ERRORS[e?.payload?.error] || e?.payload?.error || 'הרישום נכשל — נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      title="רישום תשלום ידני"
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            ביטול
          </button>
          <button type="button" onClick={save} disabled={!canSave}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {uploading ? 'מעלה קובץ…' : busy ? 'שומר…' : 'שמור רישום'}
          </button>
        </>
      }
    >
      <div className="space-y-5 py-1">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          רישום ידני מתעד כסף שהתקבל בפועל — הוא <b>אינו מפיק ואינו מייצג מסמך חשבונאי</b> באייקאונט.
          הרישום יופיע בגבייה עם סימון &quot;נרשם ידנית&quot;, לצד מי שרשם אותו ומתי.
        </p>

        {/* What is being recorded */}
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`rounded-xl border px-3 py-2.5 text-right transition-colors ${
                kind === k.key
                  ? 'border-blue-400 bg-blue-50/60 ring-2 ring-blue-100'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="block text-[13.5px] font-semibold text-gray-900">{k.title}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-gray-500">{k.hint}</span>
            </button>
          ))}
        </div>

        {/* Amount — a settlement shows the real number instead of asking for one */}
        {isSettlement ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <div className="text-[11px] text-gray-500">הסכום שייסגר עכשיו (היתרה שנותרה)</div>
            <div dir="ltr" className="text-[19px] font-bold tabular-nums text-gray-900">
              {outstanding == null ? '—' : formatMinor(outstanding, preview?.currency || currency)}
            </div>
            {outstanding != null && outstanding <= 0 && (
              <p className="mt-1 text-[12px] text-emerald-700">אין יתרה פתוחה — העסקה כבר מסומנת כשולמה.</p>
            )}
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">
              {kind === 'manual_credit' ? 'סכום הזיכוי' : 'סכום שהתקבל'} ({currency})
            </span>
            <input
              type="number" min="0" step="0.01" dir="ltr" autoFocus
              value={amountIls}
              onChange={(e) => setAmountIls(e.target.value)}
              className={FIELD}
            />
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-[11px] text-gray-500">
              {kind === 'manual_credit' ? 'תאריך הזיכוי' : 'תאריך התשלום'}
            </span>
            <DateField value={paidAt} onChange={setPaidAt} />
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">אמצעי תשלום</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
              {(methods.length ? methods : [{ key: 'banktransfer', label: 'העברה בנקאית' }]).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">אסמכתא (אופציונלי)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="מספר העברה / מספר מסמך חיצוני" className={FIELD} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">הערה (אופציונלי)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="למשל: שולם במזומן ביום הסיור" className={FIELD} />
          </label>
        </div>

        {/* Supporting document */}
        <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-gray-800">מסמך תומך (אופציונלי)</div>
              <div className="text-[11.5px] text-gray-500">
                {file ? file.name : 'אישור העברה בנקאית, קבלה סרוקה, חשבונית חיצונית…'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {file && (
                <button type="button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}
                  className="text-[12px] text-gray-500 hover:text-red-600">הסר</button>
              )}
              <button type="button" onClick={() => fileInput.current?.click()}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] text-gray-700 hover:bg-gray-50">
                בחירת קובץ
              </button>
            </div>
          </div>
          <input ref={fileInput} type="file" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>

        {error && <p className="text-[13px] text-red-600" dir="auto">{error}</p>}
      </div>
    </Dialog>
  );
}
