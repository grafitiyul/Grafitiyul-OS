import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { emitDealTasksChanged } from '../deals/tasks/taskEvents.js';
import { linkifyText } from '../../lib/linkify.jsx';

// Collapsible strip above the composer listing this chat's scheduled
// messages (pending / failed / skipped). Cancel and reschedule inline; a row
// that is being sent RIGHT NOW conflicts server-side (409) and the strip just
// refreshes to the truth.

const STATUS_BADGE = {
  pending: { label: 'ממתינה', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  sending: { label: 'נשלחת…', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  failed: { label: 'נכשלה', cls: 'bg-red-50 text-red-700 ring-red-200' },
  skipped: { label: 'לא נשלחה', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
};

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time.
export function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduledStrip({ chat, nonce = 0, dealId = null }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  // { id, value } = time-only re-arm (failed/skipped);
  // { id, value, text } = full edit — content + time (pending only).
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.whatsapp.scheduledList(chat.id));
    } catch {
      /* strip is auxiliary — next refresh covers it */
    }
  }, [chat.id]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load, nonce]);

  if (rows.length === 0) return null;

  async function run(id, fn) {
    setBusy(id);
    try {
      await fn();
      // In a Deal context, a linked Task may have changed (reschedule/edit/
      // cancel) — refresh the Deal focus area immediately (no page refresh).
      if (dealId) emitDealTasksChanged(dealId);
    } catch {
      /* 409 = state moved on; the reload shows the truth */
    } finally {
      setBusy(null);
      setEditing(null);
      await load();
    }
  }

  return (
    <div className="border-t border-amber-200 bg-amber-50/70">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] font-medium text-amber-900"
      >
        <span>🕓 הודעות מתוזמנות ({rows.length})</span>
        <span className="text-amber-700">{open ? '▾' : '◂'}</span>
      </button>
      {open && (
        <ul className="space-y-1.5 px-3 pb-2">
          {rows.map((s) => {
            const badge = STATUS_BADGE[s.status] || STATUS_BADGE.pending;
            return (
              <li key={s.id} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="text-[12px] text-gray-500" dir="ltr">{fmtWhen(s.scheduledAt)}</span>
                </div>
                <p className="mt-1 truncate text-[13px] text-gray-800" dir="auto">{linkifyText(s.content)}</p>
                {s.failureReason && s.status !== 'pending' && (
                  <p className="mt-0.5 text-[11px] text-red-600" dir="auto">{s.failureReason}</p>
                )}
                {s.status !== 'sending' && (
                  <div className="mt-1.5 space-y-1.5">
                    {editing?.id === s.id ? (
                      <>
                        {editing.text !== undefined && (
                          <textarea
                            rows={2}
                            value={editing.text}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            dir="auto"
                            className="w-full resize-y rounded-lg border border-gray-300 px-2 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
                          />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="datetime-local"
                            value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            className="rounded-lg border border-gray-300 px-2 py-1 text-[12px]"
                          />
                          <button
                            type="button"
                            disabled={busy === s.id || (editing.text !== undefined && !editing.text.trim())}
                            onClick={() =>
                              run(s.id, () =>
                                api.whatsapp.updateScheduled(s.id, {
                                  scheduledAt: new Date(editing.value).toISOString(),
                                  // Local wall-clock parts keep the linked Task's
                                  // due date/time tz-correct (never drift).
                                  dueDate: String(editing.value).slice(0, 10),
                                  dueTime: String(editing.value).slice(11, 16),
                                  ...(editing.text !== undefined ? { text: editing.text.trim() } : {}),
                                }),
                              )
                            }
                            className="rounded-lg bg-blue-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            שמירה
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-[12px] text-gray-500 hover:text-gray-700"
                          >
                            ביטול
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Full edit (content + time) — PENDING only; other
                            states keep their audit trail untouched. */}
                        {s.status === 'pending' && (
                          <button
                            type="button"
                            disabled={busy === s.id}
                            onClick={() =>
                              setEditing({ id: s.id, value: toLocalInputValue(s.scheduledAt), text: s.content })
                            }
                            className="text-[12px] font-medium text-blue-700 hover:underline"
                          >
                            ערוך
                          </button>
                        )}
                        {/* Time-only re-arm for a failed/skipped row. */}
                        {s.status !== 'pending' && (
                          <button
                            type="button"
                            disabled={busy === s.id}
                            onClick={() => setEditing({ id: s.id, value: toLocalInputValue(s.scheduledAt) })}
                            className="text-[12px] font-medium text-blue-700 hover:underline"
                          >
                            שינוי מועד
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy === s.id}
                          onClick={() => run(s.id, () => api.whatsapp.cancelScheduled(s.id))}
                          className="text-[12px] font-medium text-red-600 hover:underline"
                        >
                          {busy === s.id ? 'מבטל…' : 'ביטול הודעה'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
