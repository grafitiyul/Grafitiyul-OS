import { taskIcon } from './taskConfig.js';

// Compact history row for a terminal task event (TimelineEntry kind='task').
// These are emitted by the backend when a task is completed/cancelled/sent/
// not_sent, so completed work surfaces in the existing Deal history — no
// separate History tab.

const EVENT_STYLE = {
  task_completed: { label: 'הושלמה', cls: 'bg-green-50 text-green-700 ring-green-200' },
  task_cancelled: { label: 'בוטלה', cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
  task_sent: { label: 'נשלחה בוואטסאפ', cls: 'bg-green-50 text-green-700 ring-green-200' },
  task_not_sent: { label: 'בסוף לא נשלחה', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

export default function TaskEventRow({ entry }) {
  const data = entry.data || {};
  const style = EVENT_STYLE[data.event] || { label: 'משימה', cls: 'bg-gray-100 text-gray-600 ring-gray-200' };
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';

  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <span aria-hidden className="text-[15px] leading-none">{taskIcon(data.icon)}</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${style.cls}`}>
        {style.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">{data.title || entry.body}</span>
      <span className="shrink-0 text-[11px] text-gray-400">
        {when ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
        {' · '}
        {actor}
      </span>
    </div>
  );
}
