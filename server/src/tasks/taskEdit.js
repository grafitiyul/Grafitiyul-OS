// Pure validation for editing an OPEN task — the shape half of the canonical
// write path (taskService.applyTaskPatch is the DB half; routes are thin).
//
// One validator serves every editor: the Deal tab's PATCH, the workspace's
// inline cells, and every bulk action that is a field edit. If a rule about
// what a task edit may contain lives anywhere else, that is a second write
// path — the thing this module exists to prevent.
//
// Pure: no Prisma, no I/O, injectable clock. DB-dependent checks (owner exists,
// task type exists / channel guards) live in taskService, which owns the client.

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Minimum lead time when (re)arming a scheduled WhatsApp send.
export const SCHEDULE_MIN_LEAD_MS = 30_000;

// Statuses at which a scheduled message can still be pulled/cancelled by us
// (i.e. not mid-send and not already terminal from WhatsApp's side).
export const CANCELLABLE_SCHED = ['pending', 'failed', 'skipped'];

/** Combine "YYYY-MM-DD" + optional "HH:MM" into a Date (local wall-clock). */
export function combineDateTime(dueDate, dueTime) {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  if (dueTime && TIME_RE.test(dueTime)) {
    const [h, m] = dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/**
 * Parse an edit body into a Prisma-ready `data` object.
 * Only fields PRESENT in the body are validated/applied (PATCH semantics).
 *
 * @returns {{ok:true, data:object} | {ok:false, error:string}}
 */
export function parseTaskPatch(body) {
  const b = body || {};
  const data = {};

  if (b.text !== undefined) {
    const t = String(b.text).trim();
    if (!t) return { ok: false, error: 'text_required' };
    data.title = t.slice(0, 500);
  }
  if (b.priority !== undefined) {
    // none/''/null all mean "ללא"; anything unrecognised is dropped to null
    // rather than stored (same normalisation the Deal tab always applied).
    const p = b.priority;
    data.priority = p === 'low' || p === 'medium' || p === 'high' ? p : null;
  }
  if (b.ownerUserId !== undefined) {
    const o = String(b.ownerUserId).trim();
    if (!o) return { ok: false, error: 'owner_required' };
    data.ownerUserId = o; // existence is checked in the service (needs DB)
  }
  if (b.notes !== undefined) data.notes = b.notes != null ? String(b.notes).slice(0, 2000) : null;
  if (b.dueTime !== undefined) data.dueTime = b.dueTime && TIME_RE.test(b.dueTime) ? b.dueTime : null;
  if (b.dueDate !== undefined) {
    const d = new Date(b.dueDate);
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'due_date_invalid' };
    data.dueDate = d;
  }
  if (b.taskTypeId !== undefined) {
    const t = String(b.taskTypeId).trim();
    if (!t) return { ok: false, error: 'task_type_required' };
    data.taskTypeId = t; // existence + channel guards live in the service
  }

  if (!Object.keys(data).length) return { ok: false, error: 'nothing_to_update' };
  return { ok: true, data };
}

/**
 * The scheduled-message mirror for a WhatsApp task edit: what to write onto the
 * linked WhatsAppScheduledMessage, and from which statuses the write is allowed.
 * Returns { ok:true, sched:null } when no mirror is needed (not a WhatsApp task,
 * or the edit touches nothing the message carries).
 *
 * Semantics preserved verbatim from the original Deal-tab PATCH:
 *  - content edits only while the row is still 'pending';
 *  - a time-only change may RE-ARM a failed/skipped row (reset attempts);
 *  - the client-computed timezone-correct `scheduledAt` wins; the server
 *    combine is only the fallback;
 *  - a (re)armed send must be at least SCHEDULE_MIN_LEAD_MS in the future.
 *
 * @returns {{ok:true, sched:null|{data:object, allowedStatuses:string[]}}
 *          | {ok:false, error:string}}
 */
export function buildScheduledMirror(task, body, data, nowMs = Date.now()) {
  if (task.channel !== 'whatsapp' || !task.scheduledMessageId) return { ok: true, sched: null };

  const b = body || {};
  const touchesTime = b.scheduledAt !== undefined || b.dueDate !== undefined || b.dueTime !== undefined;
  if (data.title === undefined && !touchesTime) return { ok: true, sched: null };

  const schedData = { status: 'pending', attemptCount: 0, nextRetryAt: null, failureReason: null, claimedAt: null, claimedBy: null };
  if (data.title !== undefined) schedData.content = data.title;

  if (touchesTime) {
    const nextDate = b.dueDate !== undefined ? b.dueDate : task.dueDate;
    const nextTime = data.dueTime !== undefined ? data.dueTime : task.dueTime || '10:00';
    const scheduledAt = b.scheduledAt
      ? new Date(String(b.scheduledAt))
      : combineDateTime(nextDate, nextTime || '10:00');
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return { ok: false, error: 'scheduled_at_invalid' };
    if (scheduledAt.getTime() < nowMs + SCHEDULE_MIN_LEAD_MS) return { ok: false, error: 'scheduled_at_past' };
    schedData.scheduledAt = scheduledAt;
  }

  const allowedStatuses = schedData.content !== undefined ? ['pending'] : ['pending', 'failed', 'skipped'];
  return { ok: true, sched: { data: schedData, allowedStatuses } };
}
