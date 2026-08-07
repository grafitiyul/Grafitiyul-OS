import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { PRIORITY_TONE, PRIORITY_OPTIONS, formatDue, toDateInput } from './taskConfig.js';
import TaskIcon from './TaskIcon.jsx';
import TaskCheckbox from './TaskCheckbox.jsx';
import AnchoredMenu from '../../common/AnchoredMenu.jsx';
import { DateField, TimeField } from '../../common/pickers/DateTimeFields.jsx';

// Open-tasks strip — lives in the Deal focus area (above the timeline FOCUS).
// Compact rows: checkbox (mark done), type icon, title, due, priority, owner.
// WhatsApp tasks get a 3-dot menu (send now / edit / cancel). Completing a
// WhatsApp task before it sends does NOT send — the backend cancels the
// scheduled message and records "בסוף לא נשלחה".

export default function OpenTasksStrip({ dealId, tasks, onChanged }) {
  const [userMap, setUserMap] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [editId, setEditId] = useState(null);
  // Tasks completed from THIS strip, held on screen so the completion stays
  // reversible from the same checkbox: id -> { task, index }.
  const [closedHere, setClosedHere] = useState(() => new Map());

  useEffect(() => {
    // /api/admin-users returns { users: [...] } — normalize to an array.
    api.adminUsers
      .list()
      .then((res) => {
        const arr = Array.isArray(res) ? res : res?.users || [];
        setUserMap(Object.fromEntries(arr.map((u) => [u.id, u.username])));
      })
      .catch(() => {});
  }, []);

  // A task completed HERE stays on screen, in its place, in its completed
  // state — so the checkbox that completed it is still under the pointer and
  // clicking it again reopens. Without this the row vanished on the next
  // refetch (the strip is fed `status=open`) and an accidental completion had
  // no way back from where it happened.
  //
  // It is a display memory only: `id -> { task, index }`, dropped as soon as
  // the task is reopened (the refetch owns it again) or the Deal is left.
  const openIds = new Set((tasks || []).map((t) => t.id));
  const rows = [...(tasks || [])];
  for (const [id, held] of closedHere) {
    if (openIds.has(id)) continue; // reopened — the live list has it
    rows.splice(Math.min(held.index, rows.length), 0, { ...held.task, status: 'completed' });
  }

  if (rows.length === 0) return null;

  // `cause` names WHY the tasks changed. Completing the last open task on an
  // OPEN deal is the one case the timeline reacts to (it offers the next task),
  // so a completion says so; everything else stays an ordinary refresh.
  async function run(fn, id, cause = null) {
    setBusyId(id);
    setMenuId(null);
    try {
      await fn();
      onChanged?.(cause);
      return true;
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const forget = (id) =>
    setClosedHere((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Map(cur);
      next.delete(id);
      return next;
    });

  // Hold the row FIRST, so the tick is instant and the row never blinks out
  // between the request and the refetch. A refusal puts it straight back.
  async function completeTask(t, index) {
    setClosedHere((cur) => new Map(cur).set(t.id, { task: t, index }));
    const ok = await run(() => api.dealTasks.complete(dealId, t.id), t.id, {
      reason: 'completed',
      taskId: t.id,
    });
    if (!ok) forget(t.id);
  }

  // The canonical terminal→open transition — same row, same id, history kept.
  async function reopenTask(t) {
    const ok = await run(() => api.tasks.bulk({ action: 'reopen', ids: [t.id] }), t.id, {
      reason: 'task_reopened',
      taskId: t.id,
    });
    if (ok) forget(t.id); // the refetch owns it again
  }

  return (
    <section dir="rtl">
      <h3 className="text-[12px] font-bold tracking-wide text-gray-500 mb-2">
        משימות פתוחות ({openIds.size})
      </h3>
      <ul className="space-y-2">
        {rows.map((t, rowIndex) => {
          const done = t.status && t.status !== 'open';
          const tone = t.priority ? PRIORITY_TONE[t.priority] : null;
          const isWa = t.channel === 'whatsapp';
          if (editId === t.id) {
            return (
              <li key={t.id}>
                <TaskEditForm
                  dealId={dealId}
                  task={t}
                  userMap={userMap}
                  onDone={() => {
                    setEditId(null);
                    onChanged?.();
                  }}
                  onCancel={() => setEditId(null)}
                />
              </li>
            );
          }
          return (
            // The WHOLE row opens the editor — the 3-dot menu is for SECONDARY
            // actions, not the primary one. Direct controls inside the row
            // (the done checkbox, the ⋮ button and its menu) stop the click
            // themselves, so they keep doing only their own job.
            <li
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`עריכת המשימה ${t.title}`}
              onClick={() => setEditId(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditId(t.id);
                }
              }}
              // NO hover tint or border change. The row is clickable (it opens
              // the editor), but lighting it up on hover read as "this task is
              // about to be selected/ticked" while the pointer was merely on
              // its way to the checkbox. The only hover feedback in this row
              // belongs to the controls inside it. Keyboard focus still shows a
              // ring — that is focus, which is never triggered by a mouse.
              className={`flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                done ? 'bg-gray-50' : 'bg-white'
              }`}
            >
              <TaskCheckbox
                status={t.status || 'open'}
                busy={busyId === t.id}
                onComplete={() => completeTask(t, rowIndex)}
                onReopen={() => reopenTask(t)}
              />
              <span className="shrink-0 text-[15px] leading-none">
                <TaskIcon name={t.icon} channel={t.channel} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13.5px] font-medium ${
                    done ? 'text-gray-400 line-through' : 'text-gray-800'
                  }`}
                >
                  {t.title}
                </div>
                <div className="flex items-center gap-2 text-[11.5px] text-gray-500">
                  <span>{formatDue(t.dueDate, t.dueTime)}</span>
                  {isWa && t.scheduled?.status && (
                    <span className="text-green-600">· מתוזמן</span>
                  )}
                  {t.ownerUserId && userMap[t.ownerUserId] && (
                    <span>· {userMap[t.ownerUserId]}</span>
                  )}
                </div>
              </div>
              {tone && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${tone.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  {tone.label}
                </span>
              )}
              {/* Actions — the canonical AnchoredMenu (portaled, tap-dismissable):
                  the old hand-rolled absolute menu could only be dismissed by
                  mouseleave (impossible on touch) and was clipped by the
                  workspace's overflow container.
                  A row held here in its COMPLETED state offers no menu: send-now
                  and cancel are transitions of an open task, and the way back is
                  the checkbox itself — not a menu item. */}
              {!done && (
              <TaskRowMenu
                open={menuId === t.id}
                onToggle={() => setMenuId(menuId === t.id ? null : t.id)}
                onRowClick={(e) => e.stopPropagation()}
                onClose={() => setMenuId(null)}
                isWa={isWa}
                onSendNow={() => {
                  if (confirm('לשלוח את הודעת הוואטסאפ עכשיו?'))
                    run(() => api.dealTasks.sendNow(dealId, t.id), t.id);
                }}
                onEdit={() => {
                  setMenuId(null);
                  setEditId(t.id);
                }}
                onCancelTask={() => {
                  if (confirm(isWa ? 'לבטל את המשימה? ההודעה המתוזמנת לא תישלח.' : 'לבטל את המשימה?'))
                    run(() => api.dealTasks.cancel(dealId, t.id), t.id);
                }}
              />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Per-row ⋮ actions — anchored popover (portal): never clipped, closes on
// outside tap / Esc, works identically with mouse and touch.
function TaskRowMenu({ open, onToggle, onClose, isWa, onSendNow, onEdit, onCancelTask, onRowClick }) {
  const btnRef = useRef(null);
  return (
    // onRowClick stops the row's own click handler: pressing ⋮ (or anything in
    // its menu) must open the menu, not the editor behind it.
    <span onClick={onRowClick} className="contents">
      <button
        ref={btnRef}
        type="button"
        onClick={onToggle}
        className="rounded-md px-1.5 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        aria-label="פעולות"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={onClose} width={160}>
        {isWa && (
          <button
            type="button"
            onClick={onSendNow}
            className="block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50"
          >
            שלח עכשיו
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50"
        >
          עריכה
        </button>
        <button
          type="button"
          onClick={onCancelTask}
          className="block w-full px-3 py-2 text-right text-[13px] text-red-600 hover:bg-red-50"
        >
          ביטול
        </button>
      </AnchoredMenu>
    </span>
  );
}

// Inline editor for an open task. Text/date/time/priority/owner. For WhatsApp
// tasks a text/time change is mirrored to the scheduled message server-side.
function TaskEditForm({ dealId, task, userMap, onDone, onCancel }) {
  const [text, setText] = useState(task.title || '');
  const [dueDate, setDueDate] = useState(() => toDateInput(new Date(task.dueDate)));
  const [dueTime, setDueTime] = useState(task.dueTime || '');
  const [priority, setPriority] = useState(task.priority || 'none');
  const [ownerUserId, setOwnerUserId] = useState(task.ownerUserId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isWa = task.channel === 'whatsapp';
      // WhatsApp reschedule must be timezone-correct — compute ISO in local time.
      const scheduledAt = isWa ? new Date(`${dueDate}T${dueTime || '10:00'}`).toISOString() : undefined;
      await api.dealTasks.update(dealId, task.id, {
        text: text.trim(),
        dueDate,
        dueTime: dueTime || (isWa ? '10:00' : null),
        priority,
        ownerUserId,
        ...(isWa ? { scheduledAt } : {}),
      });
      onDone?.();
    } catch (e) {
      setError(e.payload?.error || e.message);
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-3 py-2.5 space-y-2" dir="rtl">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Date required; a WhatsApp task keeps a concrete send time (save
            falls back to 10:00), so its time is not clearable. */}
        <DateField value={dueDate} onChange={setDueDate} clearable={false} />
        <TimeField
          value={dueTime}
          onChange={setDueTime}
          placeholder={task.channel === 'whatsapp' ? 'בחירת שעה' : 'שעה (רשות)'}
          clearable={task.channel !== 'whatsapp'}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {Object.entries(userMap).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>
      {error && <div className="text-[12px] text-red-600">שגיאה: {error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-50">
          ביטול
        </button>
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </div>
  );
}
