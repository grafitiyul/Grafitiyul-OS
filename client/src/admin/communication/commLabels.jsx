// Shared Hebrew labels + chips for the Communication Center screens.

export const STATUS_LABELS = {
  draft: 'טיוטה', active: 'פעיל', disabled: 'מושבת', archived: 'בארכיון',
  // deal statuses (context pickers)
  open: 'פתוח', won: 'נסגר', lost: 'אבוד',
};

export const STATUS_TONES = {
  draft: 'bg-gray-100 text-gray-600 ring-gray-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  disabled: 'bg-amber-50 text-amber-700 ring-amber-200',
  archived: 'bg-gray-100 text-gray-400 ring-gray-200',
};

export const CHANNEL_LABELS = { whatsapp: 'WhatsApp', email: 'מייל' };

export const AUDIENCE_LABELS = {
  primary_contact: 'הלקוח הראשי',
  field_contact: 'נציג בשטח',
  assigned_guides: 'המדריכים המשובצים',
  explicit_contact: 'איש קשר קבוע',
  explicit_staff: 'איש צוות קבוע',
  wa_group: 'קבוצת WhatsApp',
};

export const ACTIVITY_LABELS = { group: 'קבוצתי', private: 'פרטי', business: 'עסקי' };

const UNIT_LABELS = {
  minutes: 'דקות', hours: 'שעות', days: 'ימים', weeks: 'שבועות', months: 'חודשים',
};

export function timingLabel(event) {
  if (!event) return '';
  if (event.timingMode === 'immediate') return 'מיידי';
  const amount = event.timingAmount || 0;
  const unit = UNIT_LABELS[event.timingUnit] || event.timingUnit || '';
  const rel = event.timingMode === 'before' ? 'לפני' : 'אחרי';
  const anchor = event.anchorType === 'tour_datetime' ? 'הסיור' : 'האירוע';
  return `${amount} ${unit} ${rel} ${anchor}`;
}

export function StatusChip({ status, small }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 font-semibold ring-1 ${STATUS_TONES[status] || STATUS_TONES.draft} ${small ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function ChannelBadge({ channel, large }) {
  const wa = channel === 'whatsapp';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ${
      wa ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200'
    } ${large ? 'px-3 py-1 text-[12px]' : 'px-2 py-0.5 text-[10.5px]'}`}>
      {wa ? '💬 WhatsApp' : '✉️ מייל'}
    </span>
  );
}

export const DELIVERY_STATUS_LABELS = {
  scheduled: 'מתוזמן',
  waiting_window: 'ממתין לחלון שליחה',
  waiting_dependency: 'ממתין לנתונים',
  sending: 'נשלח כעת',
  sent: 'נשלח',
  failed: 'נכשל — ינוסה שוב',
  failed_final: 'נכשל סופית',
  skipped: 'דולג',
  cancelled: 'בוטל',
};

export const DELIVERY_STATUS_TONES = {
  scheduled: 'bg-blue-50 text-blue-700 ring-blue-200',
  waiting_window: 'bg-amber-50 text-amber-700 ring-amber-200',
  waiting_dependency: 'bg-amber-50 text-amber-700 ring-amber-200',
  sending: 'bg-blue-50 text-blue-700 ring-blue-200',
  sent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  failed_final: 'bg-red-50 text-red-700 ring-red-200',
  skipped: 'bg-gray-100 text-gray-500 ring-gray-200',
  cancelled: 'bg-gray-100 text-gray-500 ring-gray-200',
};
