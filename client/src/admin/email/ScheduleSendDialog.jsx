import { useMemo, useState } from 'react';
import { DateField, TimeField } from '../common/pickers/DateTimeFields.jsx';

// "שליחה מתוזמנת" — pick the exact date+time an already-composed email should
// go out. Uses the canonical GOS pickers (never native date/time inputs).
//
// Timezone: the fields are wall-clock in the USER'S OWN timezone (the browser's
// zone, which for this team is Asia/Jerusalem). We convert to an absolute
// instant here with `new Date(y, m, d, hh, mm)` and send it as an ISO string,
// so the server stores one canonical UTC timestamp and the worker never has to
// re-interpret wall-clock text. DST is handled by the platform's own zone rules.

const MIN_LEAD_MS = 60_000; // mirrors the server guard

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 'YYYY-MM-DD' + 'HH:MM' (local wall clock) → absolute Date.
export function toInstant(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const [hh, mm] = String(timeStr || '').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const at = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

const FULL_FMT = { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

export default function ScheduleSendDialog({ open, busy, onCancel, onConfirm }) {
  const [date, setDate] = useState(todayLocalISO);
  const [time, setTime] = useState('09:00');
  const [error, setError] = useState(null);

  const instant = useMemo(() => toInstant(date, time), [date, time]);
  const preview = instant ? instant.toLocaleString('he-IL', FULL_FMT) : null;
  const tooSoon = instant ? instant.getTime() - Date.now() < MIN_LEAD_MS : false;

  if (!open) return null;

  function confirm() {
    if (!instant) return setError('בחרו תאריך ושעה תקינים');
    if (tooSoon) return setError('יש לבחור מועד לפחות דקה קדימה');
    setError(null);
    return onConfirm(instant);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-[16px] font-bold text-gray-900">תזמון שליחה</h2>
        <p className="mt-1 text-[13px] text-gray-500">
          המייל יישמר ויישלח אוטומטית במועד שתבחרו. אפשר לבטל או לשנות את המועד עד לשליחה.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <DateField label="תאריך" value={date} onChange={setDate} clearable={false} />
          <TimeField label="שעה" value={time} onChange={setTime} clearable={false} />
        </div>

        {/* The exact resolved moment, shown before confirmation. */}
        {preview && (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-[13px] ${
              tooSoon ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            {tooSoon ? 'המועד שנבחר כבר עבר או קרוב מדי — בחרו מועד מאוחר יותר.' : `יישלח ב־${preview}`}
          </div>
        )}
        {error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || tooSoon || !instant}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'מתזמן…' : 'תזמון שליחה'}
          </button>
        </div>
      </div>
    </div>
  );
}
