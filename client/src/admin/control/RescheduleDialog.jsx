import { useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { DateField, TimeField } from '../common/pickers/DateTimeFields.jsx';

// Generic "pick a new date+time" input for issue actions that need one (e.g.
// rescheduling a skipped WhatsApp message). Returns the LOCAL wall-clock
// parts; the action handler converts to the instant it needs.
export default function RescheduleDialog({ open, title, onClose, onSubmit }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ date, time });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'הפעולה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title || 'קביעת מועד חדש'}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={submit}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '…' : 'קבע מועד'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DateField label="תאריך" value={date} onChange={setDate} clearable={false} />
        <TimeField label="שעה" value={time} onChange={setTime} clearable={false} />
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] text-red-700">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
