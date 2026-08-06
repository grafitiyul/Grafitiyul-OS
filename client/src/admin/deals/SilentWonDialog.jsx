import { useEffect, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { DateField } from '../common/pickers/DateTimeFields.jsx';
import { api } from '../../lib/api.js';

// "הפוך ל-WON שקט" — the historical correction for a deal that really happened
// and was really paid years ago but was never closed in the CRM.
//
// This is NOT the WON button, and the dialog's whole job is to make that
// obvious BEFORE the operator commits: every default is the safe one (no
// email, no tour), and the summary at the bottom states in plain words exactly
// what will and will not happen — including that no payment, document or
// collection state is touched.

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ERRORS = {
  invalid_won_date: 'תאריך WON לא תקין.',
  won_date_in_future: 'לא ניתן לבחור תאריך עתידי — תיקון היסטורי מתעד מה שכבר קרה.',
  deal_already_won: 'הדיל כבר במצב WON.',
  tour_slot_required: 'לדיל קבוצתי צריך לבחור מועד סיור קיים.',
  tour_slot_invalid: 'מועד הסיור שנבחר אינו תקין.',
  tour_slot_not_scheduled: 'מועד הסיור שנבחר אינו פעיל.',
  tour_full: 'הסיור מלא.',
};

export default function SilentWonDialog({ open, deal, onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [dateMode, setDateMode] = useState('custom');
  const [wonDate, setWonDate] = useState('');
  const [createTour, setCreateTour] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Defaults are re-armed on every open — a previous session's choices must
  // never leak into the next correction.
  useEffect(() => {
    if (!open) return;
    setSendEmail(false);
    setCreateTour(false);
    setError(null);
    // The date default is DELIBERATE and visible rather than silent: a
    // historical deal defaults to its own tour date when it has one (that is
    // the day the business actually closed), and only otherwise to today.
    if (deal?.tourDate) {
      setDateMode('custom');
      setWonDate(deal.tourDate);
    } else {
      setDateMode('today');
      setWonDate(todayIso());
    }
    setLoading(true);
    api.deals
      .silentWonPlan(deal.id)
      .then(setPlan)
      .catch((e) => setError(e.payload?.error || e.message))
      .finally(() => setLoading(false));
  }, [open, deal?.id, deal?.tourDate]);

  const canCreateTour = !!plan?.canCreateTour && !plan?.hasActiveBooking;
  const effectiveDate = dateMode === 'custom' ? wonDate : todayIso();

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.deals.silentWon(deal.id, {
        wonDateMode: dateMode,
        wonDate: dateMode === 'custom' ? wonDate : null,
        sendConfirmationEmail: sendEmail,
        createTour: createTour && canCreateTour,
      });
      onDone?.();
    } catch (e) {
      const code = e.payload?.error;
      setError(ERRORS[code] || e.payload?.message || e.message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      title="הפוך ל-WON שקט (תיקון היסטורי)"
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading || !effectiveDate || plan?.alreadyWon}
            className="text-sm bg-emerald-600 text-white rounded px-4 py-1.5 font-medium hover:bg-emerald-700 disabled:opacity-40"
          >
            {saving ? 'מבצע…' : 'בצע תיקון'}
          </button>
        </>
      }
    >
      <div className="space-y-4" dir="rtl">
        <p className="rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2.5 text-[13px] text-amber-900 leading-relaxed">
          פעולה זו סוגרת דיל שכבר קרה בעבר, בלי להפעיל את המנגנון התפעולי של היום.
          בניגוד לכפתור WON הרגיל — לא יישלחו התראות למנהלים, לא ייווצר סיור אלא אם
          תבקשו במפורש, ולא ייווצר או ישתנה שום תשלום, מסמך חשבונאי או מצב גבייה.
        </p>

        {plan?.alreadyWon && (
          <div className="rounded-lg bg-gray-50 ring-1 ring-inset ring-gray-200 px-3 py-2 text-[13px] text-gray-700">
            הדיל כבר במצב WON — אין מה לתקן.
          </div>
        )}

        {/* 1 — Confirmation email. OFF by default: a years-old deal must never
            surprise a customer with an email. */}
        <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">שלח מייל אישור</span>
            <span className="block text-[12px] text-gray-500">
              כבוי כברירת מחדל. דיל היסטורי לא אמור לשלוח מייל ללקוח אלא אם ביקשתם.
            </span>
          </span>
        </label>

        {/* 2 — WON date. The default is stated in words, never applied silently. */}
        <div className="rounded-lg border border-gray-200 px-3 py-2.5 space-y-2">
          <div className="text-sm font-medium text-gray-800">תאריך WON</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="silent-won-date"
                checked={dateMode === 'today'}
                onChange={() => setDateMode('today')}
                className="h-4 w-4"
              />
              היום
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="silent-won-date"
                checked={dateMode === 'custom'}
                onChange={() => setDateMode('custom')}
                className="h-4 w-4"
              />
              תאריך אחר
            </label>
            {dateMode === 'custom' && (
              <div className="min-w-[10rem]">
                <DateField value={wonDate} onChange={setWonDate} clearable={false} />
              </div>
            )}
          </div>
          {deal?.tourDate && dateMode === 'custom' && wonDate === deal.tourDate && (
            <div className="text-[12px] text-gray-500">
              ברירת המחדל היא תאריך הסיור של הדיל — היום שבו העסקה נסגרה בפועל.
            </div>
          )}
        </div>

        {/* 3 — Tour. Never guessed: the dialog states what exists today and what
            exactly would be created. */}
        <div className="rounded-lg border border-gray-200 px-3 py-2.5 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={createTour && canCreateTour}
              disabled={!canCreateTour}
              onChange={(e) => setCreateTour(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800">הקם סיור אמיתי</span>
              <span className="block text-[12px] text-gray-500">
                כבוי כברירת מחדל. סיור שכבר התרחש בעבר בדרך כלל לא צריך להיווצר עכשיו.
              </span>
            </span>
          </label>

          {loading ? (
            <div className="text-[12px] text-gray-400">בודק מצב תפעולי…</div>
          ) : plan?.hasActiveBooking ? (
            <div className="rounded-md bg-blue-50 px-2.5 py-2 text-[12px] text-blue-800">
              לדיל כבר קיים סיור פעיל — יצירת סיור נוסף תשכפל את המציאות, ולכן חסומה.
            </div>
          ) : plan?.missingForTour?.length ? (
            <div className="rounded-md bg-gray-50 px-2.5 py-2 text-[12px] text-gray-600">
              לא ניתן להקים סיור — חסרים פרטי תכנון:{' '}
              <span className="font-medium">{plan.missingForTour.map((m) => m.labelHe).join(', ')}</span>
            </div>
          ) : plan?.needsSlot ? (
            <div className="rounded-md bg-gray-50 px-2.5 py-2 text-[12px] text-gray-600">
              דיל קבוצתי — צריך לשבץ למועד סיור קיים דרך מסך הסיורים, ולכן לא ניתן להקים כאן.
            </div>
          ) : createTour ? (
            <div className="rounded-md bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-900">
              ייווצר סיור: {plan?.tourDate || '—'} {plan?.tourTime || ''} · {deal?.participants || 0} משתתפים
            </div>
          ) : null}
        </div>

        {/* 4 — What is about to happen, in one place. */}
        <div className="rounded-lg bg-gray-50 ring-1 ring-inset ring-gray-200 px-3 py-2.5 text-[12.5px] text-gray-700 space-y-1">
          <div className="font-semibold text-gray-800">מה יקרה בפועל</div>
          <div>• הסטטוס ישתנה מ-{plan?.previousStatus || deal?.status} ל-WON.</div>
          <div>• תאריך WON: {effectiveDate || '—'}.</div>
          <div>• מייל אישור: {sendEmail ? 'יישלח' : 'לא יישלח'}.</div>
          <div>• סיור: {createTour && canCreateTour ? 'ייווצר דרך המסלול הרגיל' : 'לא ייווצר (יירשם כתיקון היסטורי מכוון)'}.</div>
          <div>• תשלומים, מסמכים וגבייה: ללא שינוי.</div>
          <div>• יירשם תיעוד מלא בציר הזמן של הדיל — מי ביצע ומה נבחר.</div>
        </div>

        {error && <div className="text-[13px] text-red-600">שגיאה: {error}</div>}
      </div>
    </Dialog>
  );
}
