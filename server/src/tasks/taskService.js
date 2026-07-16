// CRM Task service — the single place that transitions a Task's status and
// records the matching history event. Both the HTTP routes (user actions) and
// the WhatsApp scheduled worker (system-driven 'sent') call through here, so a
// task can never change status without a consistent TimelineEntry landing in the
// Deal history.
//
// Design rules:
//   • Tasks are a first-class store; the timeline is NOT a second copy. On a
//     terminal transition we emit ONE TimelineEntry (kind 'task', isSystem) so
//     completed/cancelled/sent/not_sent tasks surface in the existing history
//     feed — no separate History tab.
//   • The worker/cancel sync helpers are DEFENSIVE: they never throw and no-op
//     unless the task is still 'open', so they can never break a send or a
//     scheduled-message cancel, and double-calls are harmless (idempotent).

import { prisma } from '../db.js';
import { emitTimelineEvent, systemOrigin, userOrigin } from '../timeline/events.js';
import { parseTaskPatch, buildScheduledMirror, CANCELLABLE_SCHED } from './taskEdit.js';
import { emitTasksChanged } from './events.js';

export const TASK_STATUSES = ['open', 'completed', 'cancelled', 'sent', 'not_sent'];
export const TASK_PRIORITIES = ['low', 'medium', 'high']; // null = "ללא" (none)
export const OPEN_STATUS = 'open';

// Re-exported so existing callers (routes/whatsapp/…) keep importing these from
// taskService; the single implementation now lives in timeline/events.js.
export { systemOrigin, userOrigin };

// Short Hebrew history line per terminal event. The rich detail (icon, channel,
// priority) rides in `data` so the client can render a proper task-event row.
function eventBody(event, task) {
  const title = task.title || 'משימה';
  switch (event) {
    case 'task_completed':
      return `משימה הושלמה: ${title}`;
    case 'task_cancelled':
      return `משימה בוטלה: ${title}`;
    case 'task_sent':
      return `וואטסאפ נשלח: ${title}`;
    case 'task_not_sent':
      return `בסוף לא נשלחה: ${title}`;
    case 'task_corrected':
      // A record correction on a task that was already closed — the history
      // shows the amendment without reopening anything.
      return `משימה סגורה עודכנה (תיקון): ${title}`;
    case 'task_reopened':
      return `משימה נפתחה מחדש: ${title}`;
    default:
      return title;
  }
}

// Emit the single history event for a terminal task transition. `client` may be
// a prisma transaction client so the event and the status change commit together.
async function emitEvent(client, { dealId, event, task, origin }) {
  await emitTimelineEvent(client, {
    subjectId: dealId,
    kind: 'task',
    body: eventBody(event, task),
    data: {
      event,
      taskId: task.id,
      title: task.title,
      icon: task.icon ?? null,
      channel: task.channel ?? 'none',
      priority: task.priority ?? null,
      status: task.status,
    },
    origin,
  });
}

// Load a task's icon from its type (best-effort; used to enrich the event).
async function taskIcon(taskTypeId, db = prisma) {
  if (!taskTypeId) return null;
  const t = await db.taskType.findUnique({ where: { id: taskTypeId }, select: { icon: true } });
  return t?.icon ?? null;
}

// Transition an OPEN task to a terminal status + emit its history event, all in
// one transaction. Returns the updated task, or null if the task was not found
// or was already terminal (idempotent no-op — safe for worker/cancel retries).
// `db` is injectable for tests (fake-client pattern, cf. tours/completion.test.js).
export async function transitionTask(taskId, { status, event, origin }, db = prisma) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== OPEN_STATUS) return null;
  const icon = await taskIcon(task.taskTypeId, db);
  const now = new Date();
  const data = { status };
  if (status === 'completed' || status === 'sent') data.completedAt = now;
  if (status === 'cancelled' || status === 'not_sent') data.cancelledAt = now;

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.task.update({ where: { id: taskId }, data });
    await emitEvent(tx, {
      dealId: task.dealId,
      event,
      task: { ...row, icon },
      origin,
    });
    return row;
  });
  // Realtime hint AFTER the transaction committed (the emit's own root-client
  // guard additionally skips fakes/tx handles). This single line is what makes
  // worker-driven 'sent' transitions and other admins' actions reach every
  // open workspace.
  emitTasksChanged(db, { taskId, dealId: task.dealId, reason: event });
  return updated;
}

// Create an open WhatsApp Task bound to an ALREADY-created scheduled message and
// back-link the two. Used when a WhatsApp message is scheduled from the Deal
// WhatsApp panel — it becomes a first-class Task just like one made in the task
// composer. Runs inside the caller's transaction so the pair is atomic.
export async function createWhatsappTaskForScheduledMessage(
  tx,
  { dealId, scheduledMessageId, chatId, accountId, title, dueDate, dueTime, ownerUserId, createdByUserId },
) {
  // Snapshot the WhatsApp task type when one exists (for the type label); the
  // icon is derived from channel='whatsapp' regardless, so a missing type is fine.
  const type = await tx.taskType.findFirst({
    where: { channel: 'whatsapp' },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  const task = await tx.task.create({
    data: {
      dealId,
      taskTypeId: type?.id ?? null,
      title,
      dueDate,
      dueTime: dueTime || null,
      ownerUserId,
      createdByUserId: createdByUserId ?? null,
      status: 'open',
      channel: 'whatsapp',
      whatsappChatId: chatId,
      whatsappSenderAccountId: accountId,
      scheduledMessageId,
    },
  });
  await tx.whatsAppScheduledMessage.update({ where: { id: scheduledMessageId }, data: { taskId: task.id } });
  return task;
}

// ── The canonical write path ─────────────────────────────────────────────────
// Every task mutation — the Deal tab's routes, the workspace's inline cells,
// and every bulk action — flows through these three functions. Result objects
// (`{ok:false, status, error}`) rather than throws, so the routes stay thin
// translators and bulk can collect honest per-row outcomes.

// Pull a WhatsApp task's scheduled message out of the send queue (best-effort,
// compare-and-swap guarded: only from statuses we may still touch).
async function pullScheduled(scheduledMessageId, db = prisma) {
  if (!scheduledMessageId) return;
  await db.whatsAppScheduledMessage.updateMany({
    where: { id: scheduledMessageId, status: { in: CANCELLABLE_SCHED } },
    data: { status: 'cancelled', claimedAt: null, claimedBy: null, nextRetryAt: null },
  });
}

async function loadOpen(taskId, db) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, status: 404, error: 'task_not_found' };
  if (task.status !== OPEN_STATUS) return { ok: false, status: 409, error: 'task_not_open' };
  return { ok: true, task };
}

// Complete: normal task → 'completed'; WhatsApp task (still open ⇒ not yet
// sent) → cancel the scheduled message + 'not_sent' ("בסוף לא נשלחה").
// Ticking the checkbox NEVER sends a WhatsApp message.
export async function completeTask(taskId, origin, db = prisma) {
  const loaded = await loadOpen(taskId, db);
  if (!loaded.ok) return loaded;
  const { task } = loaded;
  let updated;
  if (task.channel === 'whatsapp') {
    await pullScheduled(task.scheduledMessageId, db);
    updated = await transitionTask(task.id, { status: 'not_sent', event: 'task_not_sent', origin }, db);
  } else {
    updated = await transitionTask(task.id, { status: 'completed', event: 'task_completed', origin }, db);
  }
  // transitionTask returning null here means we raced another actor to the
  // terminal state — idempotent, not an error.
  return { ok: true, task: updated ?? task };
}

// Cancel: normal task → 'cancelled'; WhatsApp task → pull the send + 'not_sent'.
// There is NO delete — cancel is the only removal path, and it is auditable.
export async function cancelTask(taskId, origin, db = prisma) {
  const loaded = await loadOpen(taskId, db);
  if (!loaded.ok) return loaded;
  const { task } = loaded;
  let updated;
  if (task.channel === 'whatsapp') {
    await pullScheduled(task.scheduledMessageId, db);
    updated = await transitionTask(task.id, { status: 'not_sent', event: 'task_not_sent', origin }, db);
  } else {
    updated = await transitionTask(task.id, { status: 'cancelled', event: 'task_cancelled', origin }, db);
  }
  return { ok: true, task: updated ?? task };
}

// Reopen: the ONLY terminal→open transition (owner decision 2026-07-16 — a
// task completed by mistake returns to Open; never faked with a new task).
//
//   • The SAME row reopens: creation date, id, deal linkage — everything
//     stays. completedAt/cancelledAt clear on the ROW (an open task cannot
//     carry them), but the completion DATE is preserved where history lives:
//     the original task_completed TimelineEntry remains untouched, and the
//     reopen writes its own entry — so the deal history reads
//     "completed → reopened → completed again", every transition auditable.
//   • WHATSAPP: reopening must never resend, recreate or reconnect. A SENT
//     task is refused outright — the message went; reopening would
//     misrepresent messaging history. A not_sent task reopens with a
//     PERMANENT DETACH: scheduledMessageId → null and the channel snapshot →
//     'none', so it continues life as a normal task. Send-now is gated on
//     scheduledMessageId and the worker claims only 'pending' rows, so after
//     the detach no code path can reach the old message — verified against
//     both call sites, not assumed. The message row itself is not touched
//     (it is settled history); only the task lets go of it.
//   • Reopening changes ONLY the task: no communication, no automation.
export async function reopenTask(taskId, origin, db = prisma) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, status: 404, error: 'task_not_found' };
  if (task.status === OPEN_STATUS) return { ok: false, status: 409, error: 'task_already_open' };
  if (task.status === 'sent') return { ok: false, status: 409, error: 'sent_task_final' };

  const icon = await taskIcon(task.taskTypeId, db);
  const data = { status: OPEN_STATUS, completedAt: null, cancelledAt: null };
  if (task.channel === 'whatsapp') {
    data.scheduledMessageId = null;
    data.channel = 'none';
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.task.update({ where: { id: task.id }, data });
    await emitEvent(tx, {
      dealId: task.dealId,
      event: 'task_reopened',
      task: { ...row, icon },
      origin: origin ?? systemOrigin(),
    });
    return row;
  });
  emitTasksChanged(db, { taskId: task.id, dealId: task.dealId, reason: 'task_reopened' });
  return { ok: true, task: updated };
}

// Field edits — the ONE rule for every editor (Deal tab, inline cells, bulk).
//
// PRODUCT RULE (owner decision 2026-07-16): tasks stay editable in ANY status.
// A terminal task (completed/cancelled/sent/not_sent) accepts RECORD
// CORRECTIONS — fixing a due date, an owner, a priority after the fact — under
// hard invariants:
//   • status / completedAt / cancelledAt are NEVER touched (parseTaskPatch has
//     no way to express them — preserved by construction, not by discipline);
//     a correction can never reopen a task;
//   • the scheduled WhatsApp message of a TERMINAL task is NEVER touched: the
//     send is settled (sent or cancelled) and a record correction must not
//     re-arm, resend or recreate anything. The mirror runs for OPEN WhatsApp
//     tasks only — exactly where task and pending message must stay in
//     lockstep;
//   • retyping stays structurally guarded in BOTH directions at ANY status;
//   • a terminal-task correction writes a Timeline audit entry
//     ('task_corrected', atomically with the update), so the deal history
//     records that a closed task was amended. Open-task edits keep their
//     long-standing behaviour (no entry — routine work, not history).
export async function applyTaskPatch(taskId, body, { origin = null, db = prisma } = {}) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, status: 404, error: 'task_not_found' };
  const isOpen = task.status === OPEN_STATUS;

  const parsed = parseTaskPatch(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { data } = parsed;

  if (data.ownerUserId !== undefined) {
    const owner = await db.adminUser.findUnique({ where: { id: data.ownerUserId }, select: { id: true } });
    if (!owner) return { ok: false, status: 400, error: 'owner_not_found' };
  }

  if (data.taskTypeId !== undefined) {
    // The SAFE canonical path for retyping (the only one), at ANY status:
    //  • a WhatsApp task is bound to a real scheduled send — retyping it would
    //    orphan that message, so it is locked;
    //  • retyping a normal task INTO a WhatsApp type would claim a channel with
    //    no scheduled message behind it — equally forbidden. WhatsApp tasks are
    //    born in the composer, never made by edit.
    // The `channel` snapshot is never touched by an edit.
    if (task.channel === 'whatsapp') return { ok: false, status: 409, error: 'whatsapp_type_locked' };
    const type = await db.taskType.findUnique({ where: { id: data.taskTypeId }, select: { id: true, channel: true } });
    if (!type) return { ok: false, status: 400, error: 'invalid_task_type' };
    if (type.channel === 'whatsapp') return { ok: false, status: 400, error: 'type_channel_not_allowed' };
  }

  // The scheduled-message mirror applies to OPEN WhatsApp tasks only (see the
  // rule above). A refused mirror still blocks the edit — task and PENDING
  // message can never drift.
  if (isOpen) {
    const mirror = buildScheduledMirror(task, body, data);
    if (!mirror.ok) return { ok: false, status: 400, error: mirror.error };
    if (mirror.sched) {
      const updated = await db.whatsAppScheduledMessage.updateMany({
        where: { id: task.scheduledMessageId, status: { in: mirror.sched.allowedStatuses } },
        data: mirror.sched.data,
      });
      if (updated.count === 0) return { ok: false, status: 409, error: 'scheduled_not_editable' };
    }
  }

  let updated;
  if (isOpen) {
    updated = await db.task.update({ where: { id: task.id }, data });
  } else {
    // Terminal correction: the update and its audit entry commit together.
    const icon = await taskIcon(task.taskTypeId, db);
    updated = await db.$transaction(async (tx) => {
      const row = await tx.task.update({ where: { id: task.id }, data });
      await emitEvent(tx, {
        dealId: task.dealId,
        event: 'task_corrected',
        task: { ...row, icon },
        // The correcting USER when the route knows one; system otherwise
        // (defensive sync paths).
        origin: origin ?? systemOrigin(),
      });
      return row;
    });
  }
  emitTasksChanged(db, { taskId: task.id, dealId: task.dealId, reason: isOpen ? 'task_edited' : 'task_corrected' });
  return { ok: true, task: updated };
}

// ── System / cross-surface sync helpers (never throw) ───────────────────────

// Called by the scheduled worker the instant a WhatsApp message actually sends.
export async function markTaskSentByScheduled(taskId) {
  try {
    await transitionTask(taskId, {
      status: 'sent',
      event: 'task_sent',
      origin: systemOrigin(),
    });
  } catch (e) {
    console.warn('[task] markTaskSentByScheduled failed', taskId, e?.message);
  }
}

// Called when a linked scheduled message is rescheduled/edited from the WhatsApp
// thread's scheduled strip. Keeps the Task's due date/time (and title) in lockstep
// with the scheduled message so the two never drift. dueDate/dueTime are the
// user's LOCAL wall-clock parts (the strip sends them from its datetime picker) —
// the same convention the task composer uses — so no timezone reinterpretation.
export async function syncTaskFromScheduledEdit(taskId, { dueDate, dueTime, title }) {
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, status: true } });
    if (!task || task.status !== OPEN_STATUS) return;
    const data = {};
    if (dueDate) {
      const d = new Date(dueDate);
      if (!Number.isNaN(d.getTime())) data.dueDate = d;
    }
    if (dueTime !== undefined) {
      data.dueTime = dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime) ? dueTime : null;
    }
    if (title !== undefined && String(title).trim()) data.title = String(title).trim().slice(0, 500);
    if (Object.keys(data).length) {
      const updated = await prisma.task.update({ where: { id: taskId }, data });
      emitTasksChanged(prisma, { taskId, dealId: updated.dealId, reason: 'task_sched_synced' });
    }
  } catch (e) {
    console.warn('[task] syncTaskFromScheduledEdit failed', taskId, e?.message);
  }
}

// Called when a scheduled message is cancelled OUTSIDE the task flow (e.g. from
// the WhatsApp thread's scheduled strip). Moves the linked task to 'not_sent'
// ("בסוף לא נשלחה") so the two surfaces stay consistent.
export async function markTaskNotSentByScheduled(taskId) {
  try {
    await transitionTask(taskId, {
      status: 'not_sent',
      event: 'task_not_sent',
      origin: systemOrigin(),
    });
  } catch (e) {
    console.warn('[task] markTaskNotSentByScheduled failed', taskId, e?.message);
  }
}
