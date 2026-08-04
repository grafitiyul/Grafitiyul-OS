// Automatic Deal tasks — THE one module for system-created tasks.
//
//   • ensureInitialCallTask — every genuinely NEW sales lead gets exactly one
//     "שיחה ראשונית" task, due on the deal's creation date (date-only, no
//     clock). Called from every lead-creation path (admin route, WhatsApp,
//     Email, ingress lead pipeline, Pipedrive bridge) — one function, five
//     origins. Deliberately NOT called for: order deals (Woo — a purchase is
//     not a sales call), agent reservations, migration/imports, repair scripts.
//
//   • runMissingTaskSweep — the midnight (Israel) recovery: every OPEN deal
//     with no active/open task gets one "פולואפ — דיל להמשך טיפול" task due
//     the day that just started. Idempotent per (deal, day): the created task
//     is itself open, and a same-day follow-up in ANY status blocks a second
//     one, so reruns and restarts are safe by construction.
//
// Owner resolution: the deal's owner when set, else the oldest active
// AdminUser (production currently has a single admin). Fire-and-forget by
// contract — an auto-task failure must never break the business write it
// rides on.

import { prisma } from '../db.js';
import { israelToday, israelDateOf, startOfDayUtc } from '../lib/israelDate.js';
import { emitTasksChanged } from './events.js';

export const FIRST_CALL_TYPE_KEY = 'first_call';
export const FOLLOW_UP_TYPE_KEY = 'follow_up';
export const FOLLOW_UP_TITLE = 'דיל להמשך טיפול';

async function resolveAutoOwner(db, dealOwnerUserId) {
  if (dealOwnerUserId) {
    const owner = await db.adminUser.findUnique({ where: { id: dealOwnerUserId }, select: { id: true, isActive: true } });
    if (owner?.isActive) return owner.id;
  }
  const fallback = await db.adminUser.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallback?.id || null;
}

/**
 * Exactly one initial-call task per genuinely new sales-lead deal.
 * Idempotent: a deal that ever had a first_call task (any status) is skipped.
 * Never throws — returns { created } | { skipped } | { error }.
 */
export async function ensureInitialCallTask({ dealId }, { db = prisma, log = console } = {}) {
  try {
    const deal = await db.deal.findUnique({
      where: { id: dealId },
      select: { id: true, status: true, ownerUserId: true, createdAt: true },
    });
    if (!deal) return { skipped: 'deal_not_found' };
    if (deal.status !== 'open') return { skipped: 'not_open' };

    const type = await db.taskType.findFirst({
      where: { key: FIRST_CALL_TYPE_KEY, isActive: true },
      select: { id: true, nameHe: true },
    });
    if (!type) return { skipped: 'no_first_call_type' };

    const existing = await db.task.findFirst({ where: { dealId, taskTypeId: type.id }, select: { id: true } });
    if (existing) return { skipped: 'already_has_initial_task' };

    const ownerUserId = await resolveAutoOwner(db, deal.ownerUserId);
    if (!ownerUserId) return { skipped: 'no_owner' };

    // Date-only due date: the deal's creation CALENDAR DATE in Israel, stored
    // as the canonical UTC-midnight anchor (dueTime stays null — no clock).
    const dueDate = startOfDayUtc(israelDateOf(deal.createdAt) || israelToday());

    const task = await db.task.create({
      data: {
        dealId,
        taskTypeId: type.id,
        title: type.nameHe,
        dueDate,
        dueTime: null,
        ownerUserId,
        createdByUserId: null,
        status: 'open',
        channel: 'none',
        notes: 'נוצרה אוטומטית עם פתיחת הדיל',
      },
    });
    emitTasksChanged(db, { taskId: task.id, dealId, reason: 'auto_task_created' });
    return { created: true, taskId: task.id };
  } catch (e) {
    log?.warn?.(`[auto-tasks] initial-call task failed for deal ${dealId}: ${e?.message || e}`);
    return { error: 'auto_task_failed' };
  }
}

/**
 * The midnight recovery sweep. For every OPEN deal without any OPEN task,
 * create one follow-up task due `dateStr` (default: today in Israel).
 *
 * Rules enforced here:
 *   • completed/cancelled/sent/not_sent tasks are NOT active — only status
 *     'open' counts;
 *   • one recovery task per deal per day: a follow-up task with this due date
 *     in ANY status blocks a second one (so completing today's recovery task
 *     does not spawn another on a rerun);
 *   • only status='open' deals (WON/LOST never included);
 *   • dryRun reports what WOULD be created, writing nothing.
 */
export async function runMissingTaskSweep({ dateStr = null, dryRun = false, db = prisma, log = console } = {}) {
  const day = dateStr || israelToday();
  const dueDate = startOfDayUtc(day);

  const type = await db.taskType.findFirst({
    where: { key: FOLLOW_UP_TYPE_KEY, isActive: true },
    select: { id: true },
  });
  if (!type) {
    log?.warn?.('[auto-tasks] follow_up task type missing — sweep skipped');
    return { day, skipped: 'no_follow_up_type', created: 0 };
  }

  const openDeals = await db.deal.findMany({
    where: { status: 'open' },
    select: { id: true, orderNo: true, ownerUserId: true },
  });
  if (!openDeals.length) return { day, created: 0, candidates: 0 };
  const dealIds = openDeals.map((d) => d.id);

  const [openTasks, todaysFollowUps] = await Promise.all([
    db.task.findMany({ where: { dealId: { in: dealIds }, status: 'open' }, select: { dealId: true } }),
    db.task.findMany({
      where: { dealId: { in: dealIds }, taskTypeId: type.id, dueDate },
      select: { dealId: true },
    }),
  ]);
  const hasOpen = new Set(openTasks.map((t) => t.dealId));
  const hasTodayFollowUp = new Set(todaysFollowUps.map((t) => t.dealId));

  const candidates = openDeals.filter((d) => !hasOpen.has(d.id) && !hasTodayFollowUp.has(d.id));
  if (dryRun) {
    return { day, dryRun: true, created: 0, candidates: candidates.length, orderNos: candidates.map((d) => d.orderNo) };
  }

  let created = 0;
  for (const d of candidates) {
    try {
      const ownerUserId = await resolveAutoOwner(db, d.ownerUserId);
      if (!ownerUserId) continue;
      const task = await db.task.create({
        data: {
          dealId: d.id,
          taskTypeId: type.id,
          title: FOLLOW_UP_TITLE,
          dueDate,
          dueTime: null,
          ownerUserId,
          createdByUserId: null,
          status: 'open',
          channel: 'none',
          notes: `נוצרה אוטומטית — לדיל לא הייתה משימה פעילה (סריקת ${day})`,
        },
      });
      created += 1;
      emitTasksChanged(db, { taskId: task.id, dealId: d.id, reason: 'auto_task_created' });
    } catch (e) {
      log?.warn?.(`[auto-tasks] recovery task failed for deal ${d.orderNo}: ${e?.message || e}`);
    }
  }
  if (created) log?.log?.(`[auto-tasks] recovery sweep ${day}: created ${created} follow-up tasks`);
  return { day, created, candidates: candidates.length };
}
