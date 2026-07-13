import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  DURATION_UNITS,
  DEFAULT_HOLD,
  durationLabelHe,
  defaultPaymentLinkMessage,
} from '../../../../shared/reservationDuration.mjs';

// The three registration-completion modes (pay-now / send-link / no-payment) as a
// SELF-CONTAINED body (no Dialog wrapper) so it embeds in both the standalone
// modal and the progressive registration section. All actions hit the tested,
// idempotent server endpoints. `context` carries the sellable offering
// (productVariantId / priceRuleId / cardGroupId / quantity) so the hold keeps the
// deal's chosen product.

const INPUT =
  'h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const UNIT_LABELS = { minutes: 'דקות', hours: 'שעות', days: 'ימים' };
const errText = (e) => 'שגיאה: ' + (e.payload?.error || e.message);

export default function CompletionModes({ deal, tourEventId, phone = '', context = {}, onDone }) {
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

  async function run(fn, validate) {
    if (validate && !validate()) return;
    setBusy(true);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      if (e.payload?.error === 'no_payment_reason_required') alert('יש להזין סיבת רישום ללא תשלום');
      else if (e.payload?.error === 'tour_full') alert('הסיור מלא — ניתן לאשר חריגה מקיבולת מהמסך הראשי');
      else alert(errText(e));
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
    });
  // Send link: the server holds the seat, guarantees the URL is in the text,
  // sends via the real WhatsApp bridge, and reports the true outcome. A failed
  // send throws (502) — we surface it and still refresh (the hold was created).
  const sendLink = async () => {
    setBusy(true);
    try {
      await api.deals.registerSendLink(deal.id, { ...ctx, value: Number(value), unit, message: liveMessage, phone });
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
  const noPayment = () =>
    run(() => api.deals.registerNoPayment(deal.id, { ...ctx, reason: reason.trim() }), () => !!reason.trim());

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

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {modeBtn('pay', 'תשלום כעת')}
        {modeBtn('link', 'שלח קישור לתשלום')}
        {modeBtn('none', 'רשום ללא תשלום')}
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
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-gray-600">
              <span>💬 הודעת וואטסאפ</span>
              {phone && <span className="text-gray-400" dir="ltr">→ {phone}</span>}
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

      {mode === 'none' && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-gray-600">סיבת רישום ללא תשלום *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="למשל: אישור מנהל, שובר, לקוח VIP…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>
          <div className="flex justify-end">
            <button type="button" disabled={busy || !reason.trim()} onClick={noPayment} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'רושם…' : 'רשום וסגור דיל'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
