import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatMinor } from '../../lib/money.js';
import {
  DURATION_UNITS,
  DEFAULT_HOLD,
  durationLabelHe,
  defaultPaymentLinkMessage,
} from '../../../../shared/reservationDuration.mjs';
import AccountBubbles from '../whatsapp/AccountBubbles.jsx';
import { useConnectedAccounts, resolveAccountId } from '../whatsapp/senderAccount.js';

// Registration-completion modes as a SELF-CONTAINED body (no Dialog wrapper),
// embedded in the progressive registration modal. All actions hit the tested,
// idempotent server endpoints. `context` carries the sellable offering
// (productVariantId / priceRuleId / cardGroupId / quantity) so the hold keeps
// the deal's chosen product.
//
// TWO STRUCTURALLY SEPARATE business meanings (never one flag):
//   • freeMode (the Builder's "הרשמה ללא תשלום" checkbox) — a genuinely free
//     registration: ONE green WON action, no payment actions at all. The
//     server records the canonical waiver (payable ₪0, commercial prices kept).
//   • paid flow — real prices always: pay-now / send-link / MANUAL payment
//     (paid outside GOS). Manual payment never zeroes anything: either a
//     structured payment record (+ document via the existing הפק מסמך modal)
//     or an attested "approved without payment details" — explicitly NOT free.

const INPUT =
  'h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const UNIT_LABELS = { minutes: 'דקות', hours: 'שעות', days: 'ימים' };
const errText = (e) => 'שגיאה: ' + (e.payload?.error || e.message);

// Static fallback only — the live list comes from the canonical server catalog
// (collection summary's paymentMethods, which now includes ביט + פייבוקס).
const FALLBACK_METHODS = [
  { key: 'bit', label: 'ביט' },
  { key: 'paybox', label: 'פייבוקס' },
  { key: 'cc', label: 'כרטיס אשראי' },
  { key: 'cash', label: 'מזומן' },
  { key: 'banktransfer', label: 'העברה בנקאית' },
  { key: 'cheque', label: 'המחאה' },
  { key: 'other', label: 'אחר' },
];

export default function CompletionModes({
  deal,
  tourEventId,
  phone = '',
  context = {},
  freeMode = false,
  totalMinor = null,
  onDone,
  // Starts the ATOMIC document-first manual-payment flow (the parent opens the
  // הפק מסמך builder; payment + WON are recorded only after a successful
  // issue). Nothing is written when this fires.
  onStartManualDocFlow,
}) {
  // Which WhatsApp number sends the link — the canonical model: this browser's
  // remembered number, overridable per send. Always resolved to something
  // explicit before the request, so the server never has to guess.
  const { accounts, remembered, select } = useConnectedAccounts();
  const [senderOverride, setSenderOverride] = useState(null);
  const senderAccountId = resolveAccountId(accounts, { explicit: senderOverride, remembered });
  const setSenderAccountId = (id) => {
    setSenderOverride(id);
    select(id); // choosing here IS choosing this browser's number
  };
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);

  const [value, setValue] = useState(DEFAULT_HOLD.value);
  const [unit, setUnit] = useState(DEFAULT_HOLD.unit);
  const [message, setMessage] = useState('');
  const [messageEdited, setMessageEdited] = useState(false);
  // The REAL stable payment URL, fetched once a payment mode opens. The message
  // preview always carries it (never a placeholder), and pay-now opens it.
  const [paymentUrl, setPaymentUrl] = useState('');
  const [urlErr, setUrlErr] = useState('');
  const liveMessage = useMemo(
    () => (messageEdited ? message : defaultPaymentLinkMessage(value, unit, paymentUrl)),
    [messageEdited, message, value, unit, paymentUrl],
  );
  const [reason, setReason] = useState('');

  // Manual-payment state (paid outside GOS).
  const [methods, setMethods] = useState(null);
  const [method, setMethod] = useState('bit');

  const ctx = { tourEventId, ...context };

  // Ensure the deal's stable payment URL as soon as a payment mode is chosen.
  useEffect(() => {
    if (mode !== 'pay' && mode !== 'link') return;
    if (paymentUrl) return;
    let alive = true;
    api.deals
      .registerPaymentUrl(deal.id)
      .then((r) => alive && setPaymentUrl(r?.paymentUrl || ''))
      .catch((e) => alive && setUrlErr(e.payload?.error || e.message || 'payment_url_failed'));
    return () => {
      alive = false;
    };
  }, [mode, deal.id, paymentUrl]);

  // Canonical payment-method catalog (same source the גבייה panel uses).
  useEffect(() => {
    if (mode !== 'manual' || methods) return;
    let alive = true;
    api.deals
      .collection(deal.id)
      .then((r) => alive && setMethods(r?.paymentMethods?.length ? r.paymentMethods : FALLBACK_METHODS))
      .catch(() => alive && setMethods(FALLBACK_METHODS));
    return () => {
      alive = false;
    };
  }, [mode, deal.id, methods]);

  async function run(fn, validate) {
    if (validate && !validate()) return;
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e.payload?.error === 'no_payment_reason_required') alert('יש להזין סיבת רישום ללא תשלום');
      else if (e.payload?.error === 'tour_full') alert('הסיור מלא — ניתן לאשר חריגה מקיבולת מהמסך הראשי');
      else if (e.payload?.error === 'amount_invalid') alert('סכום התשלום אינו תקין');
      else alert(errText(e));
      return;
    } finally {
      setBusy(false);
    }
  }

  // Pay now: create/extend the hold, then OPEN the real payment page. The Deal
  // stays OPEN — it becomes WON only when the provider confirms the payment
  // (iCount IPN → settleDealWonFromPayment). We NEVER settle on this click.
  const payNow = () =>
    run(async () => {
      const res = await api.deals.registerHold(deal.id, { ...ctx, value: DEFAULT_HOLD.value, unit: DEFAULT_HOLD.unit });
      const url = res?.paymentUrl || paymentUrl;
      if (url) window.open(url, '_blank', 'noopener');
      else alert('השריון נוצר, אך לא ניתן היה להפיק קישור תשלום. בדקו הגדרות תשלום.');
      onDone?.();
    });
  // Send link: the server holds the seat, guarantees the URL is in the text,
  // sends via the real WhatsApp bridge, and reports the true outcome. A failed
  // send throws (502) — we surface it and still refresh (the hold was created).
  const sendLink = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deals.registerSendLink(deal.id, { ...ctx, value: Number(value), unit, message: liveMessage, phone, accountId: senderAccountId });
      onDone?.();
    } catch (e) {
      const code = e.payload?.error || e.payload?.failureReason;
      if (code === 'phone_required') alert('אין מספר טלפון לשליחה — הוסיפו איש קשר עם טלפון לדיל');
      else if (e.payload?.sent === false || e.status === 502)
        alert('השריון נוצר אך שליחת הוואטסאפ נכשלה. הקישור מוכן — נסו לשלוח שוב.');
      else alert(errText(e));
      onDone?.(); // refresh either way — the hold + the outcome are recorded
    } finally {
      setBusy(false);
    }
  };
  // Genuinely-free registration (only reachable through the Builder checkbox).
  const registerFree = () => {
    if (!reason.trim()) return;
    if (!window.confirm('הרשמה לסיור ללא תשלום: סך העסקה לרישום זה יהיה ₪0. להמשיך?')) return;
    return run(async () => {
      await api.deals.registerNoPayment(deal.id, { ...ctx, reason: reason.trim() });
      onDone?.();
    });
  };
  // Manual payment A — the ATOMIC flow: hand off to the document builder
  // FIRST. Payment + WON are recorded by the parent only after a successful
  // issue; this click itself writes nothing.
  const recordManual = () => {
    onStartManualDocFlow?.({ method });
  };
  // Manual payment B — attested "paid/approved outside the system, no details".
  const approveExternal = () => {
    if (
      !window.confirm(
        'אישור סגירה ללא פרטי תשלום:\nהעסקה תיסגר (WON) במחיר המסחרי המלא, בלי רישום תשלום מובנה ובלי הפקת מסמך. ההחלטה תתועד על שמך. להמשיך?',
      )
    )
      return;
    return run(async () => {
      await api.deals.registerManualPayment(deal.id, { ...ctx, mode: 'external_approved', method });
      onDone?.();
    });
  };

  const modeBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      className={
        'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition ' +
        (mode === key ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200' : 'border-gray-200 text-gray-700 hover:bg-gray-50')
      }
    >
      {label}
    </button>
  );

  // ── FREE MODE — one green WON action, no payment actions at all ────────────
  if (freeMode) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
        <p className="text-[13px] text-emerald-900">
          הרשמה ללא תשלום: הלקוח יירשם לסיור והדיל ייסגר עם סכום ₪0 לרישום זה. המחירים המסחריים בבילדר נשמרים.
        </p>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-gray-600">סיבת ההרשמה ללא תשלום *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="למשל: אישור מנהל, שובר, לקוח VIP…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={registerFree}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'רושם…' : 'הרשמה לסיור ללא תשלום'}
          </button>
        </div>
      </div>
    );
  }

  // ── PAID FLOW — real prices, three ways the money can arrive ───────────────
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {modeBtn('pay', 'תשלום כעת')}
        {modeBtn('link', 'שלח קישור לתשלום')}
        {modeBtn('manual', 'תשלום ידני')}
      </div>

      {mode === 'pay' && (
        <div className="rounded-lg border border-gray-200 p-3 text-[13px] text-gray-600">
          נוצר שריון וייפתח דף התשלום. הדיל <span className="font-semibold">נשאר פתוח</span> ונסגר אוטומטית רק לאחר אישור התשלום מחברת הסליקה.
          {urlErr && <p className="mt-1 text-[12px] text-red-600">לא ניתן להפיק קישור תשלום: {urlErr}</p>}
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={busy} onClick={payNow} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'מעבד…' : 'צור שריון ופתח דף תשלום'}
            </button>
          </div>
        </div>
      )}

      {mode === 'link' && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3">
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-gray-600">משך השריון</span>
              <input type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT + ' w-24'} dir="ltr" />
            </label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT + ' bg-white'}>
              {DURATION_UNITS.map((u) => (
                <option key={u} value={u}>{UNIT_LABELS[u]}</option>
              ))}
            </select>
            <span className="pb-2.5 text-[13px] text-gray-500">≈ {durationLabelHe(value, unit)}</span>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] font-medium text-gray-600">
              <span className="flex items-center gap-1.5">
                <span>💬 הודעת וואטסאפ</span>
                {phone && <span className="text-gray-400" dir="ltr">→ {phone}</span>}
              </span>
              {/* Which number sends — the canonical picker, same control and
                  same remembered number as every other WhatsApp surface. */}
              <AccountBubbles
                accounts={accounts}
                activeId={senderAccountId}
                onSelect={busy ? undefined : setSenderAccountId}
              />
            </div>
            <textarea
              value={liveMessage}
              onChange={(e) => { setMessage(e.target.value); setMessageEdited(true); }}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-[11.5px] text-gray-400">
              {paymentUrl
                ? 'הטקסט כולל את קישור התשלום ומתעדכן אוטומטית עד לעריכה ידנית.'
                : urlErr
                  ? `לא ניתן להפיק קישור תשלום: ${urlErr}`
                  : 'מפיק קישור תשלום…'}
            </p>
          </div>
          <div className="flex justify-end">
            <button type="button" disabled={busy || !paymentUrl || !phone} onClick={sendLink} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? 'שולח…' : 'שריין ושלח קישור'}
            </button>
          </div>
          {!phone && <p className="text-left text-[11.5px] text-amber-600">אין מספר טלפון לשליחה בדיל.</p>}
        </div>
      )}

      {mode === 'manual' && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3">
          <p className="text-[12.5px] text-gray-600">
            הלקוח שילם מחוץ למערכת (ביט, פייבוקס, אשראי חיצוני, מזומן, העברה בנקאית…). המחיר המסחרי של העסקה נשמר במלואו.
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">אמצעי תשלום</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT + ' w-full bg-white'}>
              {(methods || FALLBACK_METHODS).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          <p className="text-[12px] leading-relaxed text-gray-500">
            רישום תשלום ידני הוא תהליך אחד: קודם מפיקים את המסמך (ברירת מחדל — חשבונית מס קבלה),
            ורק לאחר הפקה מוצלחת נרשם התשלום והדיל נסגר. ביטול או סגירה של חלון המסמך לא משנים דבר בדיל.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={recordManual}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              הפקת מסמך ורישום התשלום
            </button>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="mb-2 text-[12px] leading-relaxed text-gray-500">
              לחלופין: העסקה שולמה/אושרה מחוץ למערכת <span className="font-medium text-gray-700">ללא פרטי תשלום</span> —
              לא יירשם תשלום מובנה ולא יופק מסמך חשבונאי. הסכום המסחרי נשמר והסגירה מתועדת כהחלטה על שם המאשר. זו אינה הרשמה חינם.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={approveExternal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {busy ? 'מאשר…' : 'אישור סגירה ללא פרטי תשלום'}
              </button>
            </div>
          </div>
          {totalMinor != null && Number(totalMinor) > 0 && (
            <p className="text-[11.5px] text-gray-400">סך העסקה: <span dir="ltr" className="tabular-nums">{formatMinor(totalMinor)}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
