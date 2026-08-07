import { useState } from 'react';
import TaskIcon from './TaskIcon.jsx';
import TaskCheckbox from './TaskCheckbox.jsx';
import { TaskEditForm } from './OpenTasksStrip.jsx';
import EventRowShell from '../../common/timeline/EventRowShell.jsx';

// A task's row in HISTORY (TimelineEntry kind='task'), emitted by the backend
// when a task is completed / cancelled / sent / not sent / reopened.
//
// A task lives in exactly ONE place, and that place IS its status:
//     OPEN → the Focus strip · TERMINAL → here.
// Nothing is pinned in Focus to make undo possible; completing a task moves it
// here, and reopening it from here moves it straight back.
//
// So this row carries the live control when — and only when — it represents the
// task's CURRENT state. `task` is the real record (loaded by TimelineFeed, not
// a snapshot off the event) and `live` says this entry is the latest event for
// it. An older completion from a previous complete → reopen → complete cycle
// stays exactly what it is: an audit line, with no control on it. The audit
// trail is never rewritten — reopening adds its own entry rather than erasing
// the completion, which is what makes "completed → reopened → completed again"
// readable afterwards.
//
// Editing follows the existing product rule (tasks stay editable in ANY status
// for record corrections), through the SAME form the Focus strip uses.

const EVENT_STYLE = {
  task_completed: { label: 'הושלמה', cls: 'bg-green-50 text-green-700 ring-green-200' },
  task_cancelled: { label: 'בוטלה', cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
  task_sent: { label: 'נשלחה בוואטסאפ', cls: 'bg-green-50 text-green-700 ring-green-200' },
  task_not_sent: { label: 'בסוף לא נשלחה', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  task_reopened: { label: 'נפתחה מחדש', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
};

export default function TaskEventRow({
  entry,
  task = null,
  live = false,
  dealId = null,
  userMap = {},
  onChanged = null,
  onReopen = null, // (task) => Promise — the canonical terminal→open transition
}) {
  const [editing, setEditing] = useState(false);
  const data = entry.data || {};
  const style = EVENT_STYLE[data.event] || { label: 'משימה', cls: 'bg-gray-100 text-gray-600 ring-gray-200' };

  // The control appears only on the entry that IS the task's current state, and
  // only while that state is terminal — a reopened task is in Focus, and its
  // completion line here is history.
  const actionable = !!(live && task && onReopen && task.status && task.status !== 'open');

  if (editing && task) {
    return (
      <TaskEditForm
        dealId={dealId}
        task={task}
        userMap={userMap}
        onDone={() => {
          setEditing(false);
          onChanged?.();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const row = (
    <EventRowShell
      icon={<TaskIcon name={data.icon} channel={data.channel} size={16} />}
      chip={{ label: style.label, tone: style.cls }}
      when={entry.createdAt}
      actor={entry.createdByName || entry.actorLabel || 'מערכת'}
    >
      {data.title || entry.body}
    </EventRowShell>
  );

  if (!actionable) return row;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`עריכת המשימה ${data.title || ''}`}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className="flex cursor-pointer items-start gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
    >
      {/* The checkbox is the quick reopen — the same control, the same two
          directions, as the one that completed the task in Focus. It stops the
          row's own click so ticking never opens the editor. */}
      <span className="mt-0.5 shrink-0">
        <TaskCheckbox status={task.status} onReopen={() => onReopen(task)} />
      </span>
      <div className="min-w-0 flex-1">{row}</div>
    </div>
  );
}
