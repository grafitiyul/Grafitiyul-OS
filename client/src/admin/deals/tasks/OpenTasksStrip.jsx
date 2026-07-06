import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { PRIORITY_TONE, PRIORITY_OPTIONS, formatDue, toDateInput } from './taskConfig.js';
import TaskIcon from './TaskIcon.jsx';

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

  if (!tasks || tasks.length === 0) return null;

  async function run(fn, id) {
    setBusyId(id);
    setMenuId(null);
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section dir="rtl">
      <h3 className="text-[12px] font-bold tracking-wide text-gray-500 mb-2">
        משימות פתוחות ({tasks.length})
      </h3>
      <ul className="space-y-2">
        {tasks.map((t) => {
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
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
            >
              <button
                type="button"
                title="סמן כבוצע"
                disabled={busyId === t.id}
                onClick={() => run(() => api.dealTasks.complete(dealId, t.id), t.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-gray-300 text-transparent hover:border-green-500 hover:text-green-600 disabled:opacity-50"
              >
                ✓
              </button>
              <span className="shrink-0 text-[15px] leading-none">
                <TaskIcon name={t.icon} channel={t.channel} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-gray-800">{t.title}</div>
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
              {/* Actions */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuId(menuId === t.id ? null : t.id)}
                  className="rounded-md px-1.5 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="פעולות"
                >
                  ⋮
                </button>
                {menuId === t.id && (
                  <div
                    className="absolute left-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                    onMouseLeave={() => setMenuId(null)}
                  >
                    {isWa && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('לשלוח את הודעת הוואטסאפ עכשיו?'))
                            run(() => api.dealTasks.sendNow(dealId, t.id), t.id);
                        }}
                        className="block w-full px-3 py-1.5 text-right text-[13px] text-gray-700 hover:bg-gray-50"
                      >
                        שלח עכשיו
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMenuId(null);
                        setEditId(t.id);
                      }}
                      className="block w-full px-3 py-1.5 text-right text-[13px] text-gray-700 hover:bg-gray-50"
                    >
                      עריכה
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(isWa ? 'לבטל את המשימה? ההודעה המתוזמנת לא תישלח.' : 'לבטל את המשימה?'))
                          run(() => api.dealTasks.cancel(dealId, t.id), t.id);
                      }}
                      className="block w-full px-3 py-1.5 text-right text-[13px] text-red-600 hover:bg-red-50"
                    >
                      ביטול
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
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
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
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
