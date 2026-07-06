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
async function taskIcon(taskTypeId) {
  if (!taskTypeId) return null;
  const t = await prisma.taskType.findUnique({ where: { id: taskTypeId }, select: { icon: true } });
  return t?.icon ?? null;
}

// Transition an OPEN task to a terminal status + emit its history event, all in
// one transaction. Returns the updated task, or null if the task was not found
// or was already terminal (idempotent no-op — safe for worker/cancel retries).
export async function transitionTask(taskId, { status, event, origin }) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== OPEN_STATUS) return null;
  const icon = await taskIcon(task.taskTypeId);
  const now = new Date();
  const data = { status };
  if (status === 'completed' || status === 'sent') data.completedAt = now;
  if (status === 'cancelled' || status === 'not_sent') data.cancelledAt = now;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data });
    await emitEvent(tx, {
      dealId: task.dealId,
      event,
      task: { ...updated, icon },
      origin,
    });
    return updated;
  });
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
