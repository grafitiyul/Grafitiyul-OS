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
//     `excludeLegacyTasks` narrows what counts as an active task to NATIVE GOS
//     tasks — see the option's docs on the function. Default OFF: the nightly
//     worker's behaviour is unchanged.
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

// Prisma `IN` lists are bounded here rather than trusted to stay small — the
// legacy lookup below runs over historical volumes, not just today's tasks.
const IN_CHUNK = 1000;
function chunk(arr, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Tasks that were IMPORTED from Pipedrive rather than created by GOS.
 *
 * The authoritative marker is the crosswalk row both import paths write —
 * the bulk enrichment import (migration/import/enrichmentImport.js) and the
 * live mirror creator (mirror/creators.js) each record a LegacyRecord with
 * entityType 'Task'. Task columns are NOT a discriminator: production holds 13
 * imported tasks that the owner-approved type backfill gave a real GOS
 * taskTypeId, and zero native tasks with a null type — so classifying by
 * taskTypeId would get it backwards.
 *
 * @returns {Promise<Set<string>>} the subset of `taskIds` that are imported
 */
async function legacyTaskIds(db, taskIds) {
  const ids = new Set();
  if (!taskIds.length) return ids;
  // Deliberately NOT defensive: if the crosswalk cannot be read we must fail
  // loudly. Degrading to "no task is legacy" would silently do nothing while
  // reporting success — the exact failure this sweep exists to fix.
  for (const slice of chunk(taskIds)) {
    const rows = await db.legacyRecord.findMany({
      where: { entityType: 'Task', entityId: { in: slice } },
      select: { entityId: true },
    });
    for (const r of rows) ids.add(r.entityId);
  }
  return ids;
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
 *
 * `excludeLegacyTasks` (default false) narrows "active task" to a NATIVE GOS
 * task: an open task that was imported from Pipedrive no longer satisfies the
 * follow-up requirement. Imported tasks are read-only history here — the sweep
 * never modifies, converts, closes or deletes them. This is OFF for the
 * nightly worker (whose contract is "any open task means the deal is being
 * worked") and ON only for the one-time historical backfill
 * (scripts/backfill-legacy-followup-tasks.mjs).
 *
 * @returns counts: audited, alreadyActive, legacyOnly, noOpenTask,
 *          needRecovery, sameDayBlocked, candidates, created.
 */
export async function runMissingTaskSweep({
  dateStr = null,
  dryRun = false,
  excludeLegacyTasks = false,
  db = prisma,
  log = console,
} = {}) {
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
  const stats = {
    audited: openDeals.length,
    alreadyActive: 0,
    legacyOnly: 0,
    noOpenTask: 0,
    needRecovery: 0,
    sameDayBlocked: 0,
  };
  if (!openDeals.length) return { day, created: 0, candidates: 0, ...stats };
  const dealIds = openDeals.map((d) => d.id);

  const [openTasks, todaysFollowUps] = await Promise.all([
    db.task.findMany({ where: { dealId: { in: dealIds }, status: 'open' }, select: { id: true, dealId: true } }),
    db.task.findMany({
      where: { dealId: { in: dealIds }, taskTypeId: type.id, dueDate },
      select: { dealId: true },
    }),
  ]);
  // Deals holding an open task of ANY origin — the wider set, kept so the
  // report can separate "only legacy tasks" from "no task at all".
  const hasAnyOpen = new Set(openTasks.map((t) => t.dealId));
  const legacyIds = excludeLegacyTasks ? await legacyTaskIds(db, openTasks.map((t) => t.id)) : new Set();
  const hasOpen = excludeLegacyTasks
    ? new Set(openTasks.filter((t) => !legacyIds.has(t.id)).map((t) => t.dealId))
    : hasAnyOpen;
  const hasTodayFollowUp = new Set(todaysFollowUps.map((t) => t.dealId));

  const needRecovery = openDeals.filter((d) => !hasOpen.has(d.id));
  stats.alreadyActive = openDeals.length - needRecovery.length;
  stats.needRecovery = needRecovery.length;
  stats.legacyOnly = needRecovery.filter((d) => hasAnyOpen.has(d.id)).length;
  stats.noOpenTask = needRecovery.length - stats.legacyOnly;

  const candidates = needRecovery.filter((d) => !hasTodayFollowUp.has(d.id));
  stats.sameDayBlocked = needRecovery.length - candidates.length;
  if (dryRun) {
    return {
      day, dryRun: true, created: 0, candidates: candidates.length,
      orderNos: candidates.map((d) => d.orderNo), ...stats,
    };
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
  return { day, created, candidates: candidates.length, ...stats };
}
