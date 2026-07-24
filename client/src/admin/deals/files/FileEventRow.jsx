// Compact history row for a Deal file event (TimelineEntry kind='file'). Emitted
// by the backend on upload/delete so files show in the existing Deal history in
// chronological order — no separate file history.

const EVENT_STYLE = {
  file_uploaded: { label: 'קובץ הועלה', cls: 'bg-blue-50 text-blue-700 ring-blue-200', emoji: '📎' },
  file_deleted: { label: 'קובץ נמחק', cls: 'bg-gray-100 text-gray-500 ring-gray-200', emoji: '🗑️' },
  agent_reservation_summary_generated: {
    label: 'הופק סיכום הזמנת סוכן',
    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    emoji: '📕',
  },
};

export default function FileEventRow({ entry }) {
  const data = entry.data || {};
  const style = EVENT_STYLE[data.event] || { label: 'קובץ', cls: 'bg-gray-100 text-gray-600 ring-gray-200', emoji: '📎' };
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';

  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <span aria-hidden className="text-[15px] leading-none">{style.emoji}</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${style.cls}`}>
        {style.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">{data.filename || entry.body}</span>
      <span className="shrink-0 text-[11px] text-gray-400">
        {when ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
        {' · '}
        {actor}
      </span>
    </div>
  );
}
