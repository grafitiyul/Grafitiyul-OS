// Shared presentation for the Automation Registry. One tone map so the list and
// the detail screen can never disagree about what "broken" looks like.

export const STATUS_TONE = {
  active: { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', muted: 'text-emerald-700' },
  disabled: { chip: 'border-gray-300 bg-gray-100 text-gray-600', muted: 'text-gray-500' },
  waiting_dependency: { chip: 'border-amber-200 bg-amber-50 text-amber-700', muted: 'text-amber-700' },
  broken: { chip: 'border-red-300 bg-red-50 text-red-700', muted: 'text-red-700' },
  error: { chip: 'border-red-300 bg-red-50 text-red-700', muted: 'text-red-700' },
  retired: { chip: 'border-gray-300 bg-gray-50 text-gray-500', muted: 'text-gray-400' },
};

export function StatusBadge({ status, label, small = false }) {
  const tone = STATUS_TONE[status]?.chip || 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span className={`inline-block rounded-full border ${tone} ${small ? 'px-1.5 py-0 text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]'}`}>
      {label || status}
    </span>
  );
}

export function fmtWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Run-status wording — 'ran' is deliberately "בוצעה", not "הצליחה": the
 *  automation decided and acted; whether a message ultimately arrived is the
 *  Communication Center's delivery log to answer. */
export const RUN_STATUS_HE = {
  ran: 'בוצעה',
  skipped: 'לא הופעלה',
  failed: 'נכשלה',
};

export const RUN_TONE = {
  ran: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  skipped: 'border-gray-200 bg-gray-50 text-gray-600',
  failed: 'border-red-200 bg-red-50 text-red-700',
};
