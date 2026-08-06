import TaskIcon from './TaskIcon.jsx';
import EventRowShell from '../../common/timeline/EventRowShell.jsx';

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

  return (
    <EventRowShell
      icon={<TaskIcon name={data.icon} channel={data.channel} size={16} />}
      chip={{ label: style.label, tone: style.cls }}
      when={entry.createdAt}
      actor={entry.createdByName || entry.actorLabel || 'מערכת'}
    >
      {data.title || entry.body}
    </EventRowShell>
  );
}
