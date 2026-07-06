import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { callBridge } from '../whatsapp/bridgeClient.js';
import { transitionTask, userOrigin, TASK_PRIORITIES } from '../tasks/taskService.js';

// Deal Tasks (משימות) — mounted at /api/deals, serves /:dealId/tasks*. A task is
// a FUTURE action on a deal. Open tasks live in the deal focus area; terminal
// tasks (completed/cancelled/sent/not_sent) leave that list and surface as
// TimelineEntry events via taskService.
//
// WhatsApp tasks: the Task NEVER sends. Creating one atomically creates a
// WhatsAppScheduledMessage (linked by taskId) and the existing claim-based
// worker owns the send. The task's checkbox/cancel BEFORE send does NOT send —
// it cancels the scheduled message and records 'not_sent' ("בסוף לא נשלחה").
// "Send now" cancels the scheduled row (so the worker can't double-send), then
// sends immediately via the bridge with its own idempotency key.

const router = Router();

const SCHEDULE_MIN_LEAD_MS = 30_000;
// Statuses at which a scheduled message can still be pulled/cancelled by us
// (i.e. not mid-send and not already terminal from WhatsApp's side).
const CANCELLABLE_SCHED = ['pending', 'failed', 'skipped'];

function badDeal(res) {
  return res.status(404).json({ error: 'deal_not_found' });
}

// Combine a "YYYY-MM-DD" date with an optional "HH:MM" into a Date. When no time
// is given the moment is local-midnight of that day (fine for non-timed tasks).
function combineDateTime(dueDate, dueTime) {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  if (dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
    const [h, m] = dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

function normalizePriority(p) {
  if (p == null || p === '' || p === 'none') return null;
  return TASK_PRIORITIES.includes(p) ? p : null;
}

async function serializeTasks(tasks) {
  const schedIds = tasks.map((t) => t.scheduledMessageId).filter(Boolean);
  const schedMap = new Map();
  if (schedIds.length) {
    const rows = await prisma.whatsAppScheduledMessage.findMany({
      where: { id: { in: schedIds } },
      select: { id: true, status: true, scheduledAt: true, failureReason: true, sentAt: true },
    });
    for (const r of rows) schedMap.set(r.id, r);
  }
  return tasks.map((t) => ({
    id: t.id,
    dealId: t.dealId,
    taskTypeId: t.taskTypeId,
    typeName: t.taskType?.nameHe ?? null,
    // Fall back to the channel when the type is gone/unlinked so a WhatsApp task
    // always resolves to the WhatsApp mark.
    icon: t.taskType?.icon ?? (t.channel === 'whatsapp' ? 'whatsapp' : 'check'),
    title: t.title,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    priority: t.priority,
    ownerUserId: t.ownerUserId,
    status: t.status,
    channel: t.channel,
    notes: t.notes,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    scheduledMessageId: t.scheduledMessageId,
    whatsappSenderAccountId: t.whatsappSenderAccountId,
    whatsappChatId: t.whatsappChatId,
    scheduled: t.scheduledMessageId ? schedMap.get(t.scheduledMessageId) ?? null : null,
    createdAt: t.createdAt,
  }));
}

const TASK_INCLUDE = { taskType: { select: { nameHe: true, icon: true, channel: true } } };

// GET /:dealId/tasks?status=open — list (optionally filtered by status).
router.get(
  '/:dealId/tasks',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.dealId }, select: { id: true } });
    if (!deal) return badDeal(res);
    const status = String(req.query.status || '').trim();
    const where = { dealId: deal.id, ...(status ? { status } : {}) };
    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: TASK_INCLUDE,
    });
    res.json(await serializeTasks(tasks));
  }),
);

// POST /:dealId/tasks — create a normal OR WhatsApp task.
router.post(
  '/:dealId/tasks',
  handle(async (req, res) => {
    const b = req.body || {};
    const deal = await prisma.deal.findUnique({ where: { id: req.params.dealId }, select: { id: true } });
    if (!deal) return badDeal(res);

    const type = b.taskTypeId
      ? await prisma.taskType.findUnique({ where: { id: String(b.taskTypeId) } })
      : null;
    if (b.taskTypeId && !type) return res.status(400).json({ error: 'invalid_task_type' });

    const channel = type?.channel === 'whatsapp' ? 'whatsapp' : 'none';
    // Text: explicit → type.defaultText → type.nameHe.
    const rawText = typeof b.text === 'string' ? b.text.trim() : '';
    const title = (rawText || type?.defaultText || type?.nameHe || 'משימה').slice(0, 500);

    if (!b.dueDate) return res.status(400).json({ error: 'due_date_required' });
    const priority = normalizePriority(b.priority);
    const ownerUserId = String(b.ownerUserId || req.adminAuth?.userId || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'owner_required' });
    const currentUser = req.adminAuth?.userId || null;
    const dueTime = b.dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.dueTime) ? b.dueTime : null;
    const notes = b.notes != null ? String(b.notes).slice(0, 2000) : null;

    if (channel !== 'whatsapp') {
      const task = await prisma.task.create({
        data: {
          dealId: deal.id,
          taskTypeId: type?.id ?? null,
          title,
          dueDate: new Date(b.dueDate),
          dueTime,
          priority,
          ownerUserId,
          createdByUserId: currentUser,
          status: 'open',
          channel: 'none',
          notes,
        },
        include: TASK_INCLUDE,
      });
      const [out] = await serializeTasks([task]);
      return res.status(201).json(out);
    }

    // ── WhatsApp task ── requires a message, a target chat + a valid future time.
    if (!rawText) return res.status(400).json({ error: 'message_required' });
    const chatId = String(b.whatsappChatId || '').trim();
    if (!chatId) return res.status(400).json({ error: 'whatsapp_chat_required' });
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: chatId },
      select: { id: true, accountId: true },
    });
    if (!chat) return res.status(400).json({ error: 'whatsapp_chat_not_found' });

    // Send time: the CLIENT computes scheduledAt in the user's timezone and
    // sends it as an ISO string (server runs UTC — it must not reinterpret a
    // local wall-clock time). Fallback to a server-side combine only if absent.
    const effectiveTime = dueTime || type?.defaultTime || '10:00';
    const scheduledAt = b.scheduledAt ? new Date(String(b.scheduledAt)) : combineDateTime(b.dueDate, effectiveTime);
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'scheduled_at_invalid' });
    if (scheduledAt.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MS) {
      return res.status(400).json({ error: 'scheduled_at_past' });
    }

    // Atomic: task + its linked scheduled message commit together (§8).
    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          dealId: deal.id,
          taskTypeId: type?.id ?? null,
          title,
          dueDate: new Date(b.dueDate),
          dueTime: effectiveTime,
          priority,
          ownerUserId,
          createdByUserId: currentUser,
          status: 'open',
          channel: 'whatsapp',
          notes,
          whatsappChatId: chat.id,
          whatsappSenderAccountId: chat.accountId,
        },
      });
      const sched = await tx.whatsAppScheduledMessage.create({
        data: {
          accountId: chat.accountId,
          chatId: chat.id,
          content: title,
          scheduledAt,
          createdById: currentUser,
          taskId: t.id,
        },
      });
      return tx.task.update({
        where: { id: t.id },
        data: { scheduledMessageId: sched.id },
        include: TASK_INCLUDE,
      });
    });
    const [out] = await serializeTasks([task]);
    res.status(201).json(out);
  }),
);

// Load a task and verify it belongs to the deal in the path.
async function loadTask(req, res) {
  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task || task.dealId !== req.params.dealId) {
    res.status(404).json({ error: 'task_not_found' });
    return null;
  }
  return task;
}

// PATCH /:dealId/tasks/:taskId — edit an OPEN task. For WhatsApp tasks a text /
// time change is mirrored onto the linked scheduled message (content edits only
// while it is still pending; a time change may re-arm a failed/skipped row).
router.patch(
  '/:dealId/tasks/:taskId',
  handle(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.status !== 'open') return res.status(409).json({ error: 'task_not_open' });
    const b = req.body || {};

    const data = {};
    if (b.text !== undefined) {
      const t = String(b.text).trim();
      if (!t) return res.status(400).json({ error: 'text_required' });
      data.title = t.slice(0, 500);
    }
    if (b.priority !== undefined) data.priority = normalizePriority(b.priority);
    if (b.ownerUserId !== undefined) {
      const o = String(b.ownerUserId).trim();
      if (!o) return res.status(400).json({ error: 'owner_required' });
      data.ownerUserId = o;
    }
    if (b.notes !== undefined) data.notes = b.notes != null ? String(b.notes).slice(0, 2000) : null;
    if (b.dueTime !== undefined)
      data.dueTime = b.dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.dueTime) ? b.dueTime : null;
    if (b.dueDate !== undefined) {
      const d = new Date(b.dueDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'due_date_invalid' });
      data.dueDate = d;
    }

    // Mirror onto the scheduled message for WhatsApp tasks.
    if (task.channel === 'whatsapp' && task.scheduledMessageId) {
      const nextDate = b.dueDate !== undefined ? b.dueDate : task.dueDate;
      const nextTime =
        data.dueTime !== undefined ? data.dueTime : task.dueTime || '10:00';
      const schedData = { status: 'pending', attemptCount: 0, nextRetryAt: null, failureReason: null, claimedAt: null, claimedBy: null };
      if (data.title !== undefined) schedData.content = data.title;
      if (b.scheduledAt !== undefined || b.dueDate !== undefined || b.dueTime !== undefined) {
        // Prefer the client-computed (timezone-correct) scheduledAt; fall back to
        // a server combine only when the client didn't send one.
        const scheduledAt = b.scheduledAt
          ? new Date(String(b.scheduledAt))
          : combineDateTime(nextDate, nextTime || '10:00');
        if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'scheduled_at_invalid' });
        if (scheduledAt.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MS) {
          return res.status(400).json({ error: 'scheduled_at_past' });
        }
        schedData.scheduledAt = scheduledAt;
      }
      // Content edits only while pending; a time-only change may re-arm failed/skipped.
      const allowed = schedData.content !== undefined ? ['pending'] : ['pending', 'failed', 'skipped'];
      const updated = await prisma.whatsAppScheduledMessage.updateMany({
        where: { id: task.scheduledMessageId, status: { in: allowed } },
        data: schedData,
      });
      if (updated.count === 0) return res.status(409).json({ error: 'scheduled_not_editable' });
    }

    await prisma.task.update({ where: { id: task.id }, data });
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: TASK_INCLUDE });
    const [out] = await serializeTasks([fresh]);
    res.json(out);
  }),
);

// Cancel a WhatsApp task's scheduled message (best-effort, guarded).
async function pullScheduled(scheduledMessageId) {
  if (!scheduledMessageId) return;
  await prisma.whatsAppScheduledMessage.updateMany({
    where: { id: scheduledMessageId, status: { in: CANCELLABLE_SCHED } },
    data: { status: 'cancelled', claimedAt: null, claimedBy: null, nextRetryAt: null },
  });
}

// POST /:dealId/tasks/:taskId/complete — normal task → completed; WhatsApp task
// (still open ⇒ not yet sent) → cancel the scheduled message + 'not_sent'
// ("בסוף לא נשלחה"). Ticking the checkbox NEVER sends a WhatsApp message.
router.post(
  '/:dealId/tasks/:taskId/complete',
  handle(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.status !== 'open') return res.status(409).json({ error: 'task_not_open' });
    const origin = await userOrigin(req.adminAuth?.userId);

    if (task.channel === 'whatsapp') {
      await pullScheduled(task.scheduledMessageId);
      await transitionTask(task.id, { status: 'not_sent', event: 'task_not_sent', origin });
    } else {
      await transitionTask(task.id, { status: 'completed', event: 'task_completed', origin });
    }
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: TASK_INCLUDE });
    const [out] = await serializeTasks([fresh]);
    res.json(out);
  }),
);

// POST /:dealId/tasks/:taskId/cancel — normal task → cancelled; WhatsApp task →
// cancel the scheduled message + 'not_sent'.
router.post(
  '/:dealId/tasks/:taskId/cancel',
  handle(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.status !== 'open') return res.status(409).json({ error: 'task_not_open' });
    const origin = await userOrigin(req.adminAuth?.userId);

    if (task.channel === 'whatsapp') {
      await pullScheduled(task.scheduledMessageId);
      await transitionTask(task.id, { status: 'not_sent', event: 'task_not_sent', origin });
    } else {
      await transitionTask(task.id, { status: 'cancelled', event: 'task_cancelled', origin });
    }
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: TASK_INCLUDE });
    const [out] = await serializeTasks([fresh]);
    res.json(out);
  }),
);

// POST /:dealId/tasks/:taskId/send-now — WhatsApp task only. Claims the scheduled
// row (so the worker can't also send it), sends immediately via the bridge with
// a dedicated idempotency key, then marks the task 'sent'. On failure the row is
// left 'failed' (NOT re-armed to pending) so a lost-ack can never double-send;
// the user can retry send-now (same idempotency key → bridge replays).
router.post(
  '/:dealId/tasks/:taskId/send-now',
  handle(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.status !== 'open') return res.status(409).json({ error: 'task_not_open' });
    if (task.channel !== 'whatsapp' || !task.scheduledMessageId) {
      return res.status(400).json({ error: 'not_a_whatsapp_task' });
    }
    const sched = await prisma.whatsAppScheduledMessage.findUnique({
      where: { id: task.scheduledMessageId },
      include: { chat: { select: { externalChatId: true, accountId: true } } },
    });
    if (!sched || !sched.chat) return res.status(409).json({ error: 'scheduled_missing' });

    // Atomic claim: only a pending/failed/skipped row can be pulled; a row
    // mid-send or already sent conflicts (the worker owns it).
    const now = new Date();
    const claimed = await prisma.whatsAppScheduledMessage.updateMany({
      where: { id: sched.id, status: { in: CANCELLABLE_SCHED } },
      data: { status: 'sending', claimedAt: now, claimedBy: `sendnow-${req.adminAuth?.userId || 'admin'}` },
    });
    if (claimed.count === 0) return res.status(409).json({ error: 'not_sendable' });

    try {
      const data = await callBridge(sched.chat.accountId, '/send', {
        method: 'POST',
        timeoutMs: 25_000,
        body: {
          jid: sched.chat.externalChatId,
          text: sched.content,
          idempotencyKey: `gos-task-sendnow-${task.id}`,
        },
      });
      await prisma.whatsAppScheduledMessage.update({
        where: { id: sched.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          externalMessageId: data?.externalMessageId ?? null,
          failureReason: null,
          claimedAt: null,
          claimedBy: null,
        },
      });
      await transitionTask(task.id, {
        status: 'sent',
        event: 'task_sent',
        origin: await userOrigin(req.adminAuth?.userId),
      });
      const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: TASK_INCLUDE });
      const [out] = await serializeTasks([fresh]);
      res.json(out);
    } catch (err) {
      // Leave the row 'failed' (worker won't auto-pick a non-pending row) so a
      // lost network ack can't be resent under a different key. Task stays open.
      const code = err?.data?.error || err?.code || 'send_failed';
      await prisma.whatsAppScheduledMessage.update({
        where: { id: sched.id },
        data: { status: 'failed', failureReason: String(code).slice(0, 80), claimedAt: null, claimedBy: null },
      });
      if (err?.code === 'bridge_not_configured') return res.status(503).json({ error: 'bridge_not_configured' });
      return res.status(502).json({ error: 'send_failed', detail: String(code).slice(0, 80) });
    }
  }),
);

export default router;
