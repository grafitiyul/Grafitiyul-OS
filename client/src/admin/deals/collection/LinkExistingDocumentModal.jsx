import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import { friendlyIcountError } from '../icount/icountErrors.js';

// "חבר מסמך קיים מ־iCount" — attach a document that was issued directly in
// iCount (typically before GOS, or by the bookkeeper) to this deal, so the
// collection balance reflects money that really came in.
//
// It reuses the SAME server integration as "הפק מסמך": one iCount client, one
// document mapping, one IcountDocument table, one idempotency key. Nothing here
// authenticates, maps or persists on its own.
//
// READ-ONLY toward iCount. Resolving calls doc/info; linking writes a row in
// GOS. No document is ever issued, emailed or modified by this flow — and the
// dialog says so, because an operator reaching for "connect a document" must be
// certain they are not about to send the customer anything.

const FIELD =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

const DOC_TYPES = [
  { key: '', label: 'זיהוי אוטומטי לפי המספר' },
  { key: 'invrec', label: 'חשבונית מס קבלה' },
  { key: 'receipt', label: 'קבלה' },
  { key: 'invoice', label: 'חשבונית מס' },
  { key: 'deal', label: 'חשבון עסקה' },
  { key: 'refund', label: 'חשבונית זיכוי' },
];

const RESOLVE_ERRORS = {
  document_not_found: 'לא נמצא מסמך עם המספר הזה באייקאונט',
  docnum_required: 'יש להזין מספר מסמך',
  docnum_invalid: 'מספר מסמך חייב להיות מספרי',
  url_not_recognised: 'הקישור אינו קישור מסמך של אייקאונט',
  url_not_resolvable:
    'לא ניתן לזהות מסמך מהקישור בלבד — אייקאונט אינו מאפשר חיפוש לפי קישור. הזינו את מספר המסמך.',
};

const fmtIls = (n, cur = 'ILS') =>
  n == null
    ? '—'
    : `${cur === 'ILS' ? '₪' : `${cur} `}${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, children, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11.5px] text-gray-500">{label}</span>
      <span className={`min-w-0 truncate text-[13px] ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>
        {children}
      </span>
    </div>
  );
}

function Warning({ tone = 'amber', children }) {
  const cls =
    tone === 'red'
      ? 'bg-red-50 text-red-800 ring-red-200'
      : 'bg-amber-50 text-amber-900 ring-amber-200';
  return <p className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ring-1 ${cls}`}>{children}</p>;
}

export default function LinkExistingDocumentModal({ dealId, open, onClose, onLinked }) {
  const [doctype, setDoctype] = useState('');
  const [docnum, setDocnum] = useState('');
  const [url, setUrl] = useState('');
  const [resolved, setResolved] = useState(null); // { document, warnings }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDoctype('');
    setDocnum('');
    setUrl('');
    setResolved(null);
    setReason('');
    setError(null);
  }, [open]);

  async function resolve() {
    if (busy || (!docnum.trim() && !url.trim())) return;
    setBusy(true);
    setError(null);
    setResolved(null);
    try {
      const out = await api.deals.icountResolveDocument(dealId, {
        doctype: doctype || undefined,
        docnum: docnum.trim() || undefined,
        url: url.trim() || undefined,
      });
      setResolved(out);
    } catch (e) {
      setError(RESOLVE_ERRORS[e?.payload?.error] || friendlyIcountError(e));
    } finally {
      setBusy(false);
    }
  }

  const w = resolved?.warnings;
  // A document already linked to ANOTHER deal, or issued to a different
  // customer, is exactly the case that quietly corrupts a balance. The operator
  // may still proceed — but only after saying why, and the reason is stored on
  // the link and rendered in the Collection panel.
  const needsReason = !!(w && (w.linkedElsewhere?.length || w.customerMismatch || w.amountMismatch));
  const canLink =
    !busy && !!resolved && !w?.alreadyOnThisDeal && (!needsReason || reason.trim().length >= 3);

  async function link() {
    if (!canLink) return;
    setBusy(true);
    setError(null);
    try {
      const { document } = await api.deals.icountLinkDocument(dealId, {
        doctype: resolved.document.doctype,
        docnum: resolved.document.docnum,
        reason: needsReason ? reason.trim() : undefined,
      });
      onLinked?.(document);
      onClose();
    } catch (e) {
      setError(friendlyIcountError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      title="חבר מסמך קיים מאייקאונט"
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            ביטול
          </button>
          {resolved ? (
            <button type="button" onClick={link} disabled={!canLink}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'מחבר…' : 'חבר את המסמך לעסקה'}
            </button>
          ) : (
            <button type="button" onClick={resolve} disabled={busy || (!docnum.trim() && !url.trim())}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'מחפש…' : 'חפש מסמך'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4 py-1">
        <p className="text-[12.5px] leading-relaxed text-gray-600">
          חיבור מסמך שכבר הופק באייקאונט אל העסקה הזו. הפעולה <b>אינה מפיקה מסמך חדש, אינה שולחת דבר ללקוח
          ואינה משנה את המסמך</b> — היא רק משייכת אותו כאן, כדי שהגבייה תשקף את הכסף שהתקבל בפועל.
        </p>

        {/* Search step */}
        <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">מספר מסמך</span>
            <input
              value={docnum} dir="ltr" inputMode="numeric" autoFocus
              onChange={(e) => { setDocnum(e.target.value); setResolved(null); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), resolve())}
              placeholder="38474" className={FIELD}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-gray-500">סוג מסמך</span>
            <select value={doctype} onChange={(e) => { setDoctype(e.target.value); setResolved(null); }} className={FIELD}>
              {DOC_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] text-gray-500">או הדביקו קישור למסמך באייקאונט (אופציונלי)</span>
          <input value={url} dir="ltr" onChange={(e) => { setUrl(e.target.value); setResolved(null); }}
            placeholder="https://app.icount.co.il/hash/p_print.php?code=…" className={FIELD} />
        </label>

        {/* Preview + safety */}
        {resolved && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
            <div className="text-[13.5px] font-semibold text-gray-900">
              {resolved.document.doctypeLabel} מס׳ {resolved.document.docnum}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-gray-200">
              <Row label="לקוח" strong>{resolved.document.clientName || '—'}</Row>
              {resolved.document.clientVatId && <Row label="ח.פ / ת.ז">{resolved.document.clientVatId}</Row>}
              <Row label="תאריך">{resolved.document.issuedAt || '—'}</Row>
              <Row label="סכום" strong>{fmtIls(resolved.document.amountIls, resolved.document.currency)}</Row>
              {resolved.document.paidIls != null && (
                <Row label="שולם בפועל">{fmtIls(resolved.document.paidIls, resolved.document.currency)}</Row>
              )}
              <Row label="מטבע">{resolved.document.currency}</Row>
              <Row label="סטטוס">{resolved.document.cancelled ? 'מבוטל' : 'תקין'}</Row>
            </div>

            {/* The line that matters most: what attaching this actually does */}
            <p className={`rounded-lg px-3 py-2 text-[12.5px] font-medium ring-1 ${
              resolved.document.cancelled
                ? 'bg-gray-100 text-gray-600 ring-gray-200'
                : resolved.document.countsAsPayment
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : resolved.document.doctype === 'refund'
                    ? 'bg-red-50 text-red-800 ring-red-200'
                    : 'bg-gray-100 text-gray-700 ring-gray-200'
            }`}>
              {resolved.document.paymentMeaning}
            </p>

            {w.alreadyOnThisDeal && (
              <Warning>המסמך כבר משויך לעסקה הזו — אין צורך לחבר אותו שוב.</Warning>
            )}
            {!!w.linkedElsewhere?.length && (
              <Warning tone="red">
                המסמך כבר משויך {w.linkedElsewhere.length > 1 ? `ל־${w.linkedElsewhere.length} עסקאות אחרות` : 'לעסקה אחרת'}
                {' '}({w.linkedElsewhere.map((d) => `#${d.orderNo}`).join(', ')}).
                שיוך נוסף עלול לספור את אותו כסף פעמיים.
              </Warning>
            )}
            {w.customerMismatch && (
              <Warning>
                שם הלקוח במסמך (<b>{resolved.document.clientName}</b>) שונה מהלקוח בעסקה. ודאו שזה אכן המסמך הנכון.
              </Warning>
            )}
            {w.amountMismatch && (
              <Warning>
                סכום המסמך שונה מסכום העסקה ({fmtIls((w.dealTotalIls || 0), resolved.document.currency)}).
                זה תקין כשמדובר במקדמה או בתשלום חלקי.
              </Warning>
            )}

            {needsReason && !w.alreadyOnThisDeal && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-700">
                  סיבת השיוך למרות האזהרה (חובה — תישמר ותוצג בכרטיס הגבייה)
                </span>
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="למשל: החשבונית הוצאה על שם העירייה עבור העסקה הזו" className={FIELD} />
              </label>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-red-600" dir="auto">שגיאה: {error}</p>}
      </div>
    </Dialog>
  );
}
