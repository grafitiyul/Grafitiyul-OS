// Task search provider.
//
// A Task ALWAYS belongs to a Deal (dealId is required), so the parent entity
// is always resolvable for the result row. Task.ownerUserId is a LOOSE key
// with no FK to AdminUser, so the owner cannot be `include`d — it is resolved
// with one bounded batch query instead of one lookup per row.

import { CANDIDATE_CAP } from '../lookups.js';
import { scoreOf, bestReason } from '../ranking.js';
import { contains, startsWith, equals, snippet } from '../text.js';

const INCLUDE = {
  taskType: { select: { key: true, nameHe: true } },
  deal: {
    select: {
      id: true,
      orderNo: true,
      title: true,
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: { contact: { select: { firstNameHe: true, lastNameHe: true } } },
      },
    },
  },
};

function ci(q) {
  return { contains: q, mode: 'insensitive' };
}

function reasonsForTask(t, q, ownerNames) {
  const out = [];
  if (equals(t.title, q)) out.push({ key: 'name_exact', text: t.title });
  else if (startsWith(t.title, q)) out.push({ key: 'title_prefix', text: t.title });
  else if (contains(t.title, q)) out.push({ key: 'task_title_partial', text: t.title });

  if (contains(t.taskType?.nameHe, q)) out.push({ key: 'task_title_partial', text: t.taskType.nameHe });
  if (contains(t.notes, q)) out.push({ key: 'note_partial', text: snippet(t.notes, q) });
  if (contains(t.deal?.title, q)) out.push({ key: 'title_partial', text: t.deal.title });
  if (contains(t.status, q)) out.push({ key: 'status_partial', text: t.status });

  const owner = ownerNames.get(t.ownerUserId);
  if (owner && contains(owner, q)) out.push({ key: 'name_partial', text: owner });
  return out;
}

function toDto(t, reasons, ownerNames) {
  const c = t.deal?.contacts?.[0]?.contact;
  return {
    type: 'task',
    id: t.id,
    // Tasks have no standalone page — they live on their parent Deal.
    path: `/admin/crm/deals/${t.deal?.orderNo ?? t.dealId}`,
    title: t.title,
    taskTypeLabel: t.taskType?.nameHe || null,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    dueTime: t.dueTime || null,
    ownerName: ownerNames.get(t.ownerUserId) || null,
    parent: t.deal
      ? {
          type: 'deal',
          id: t.deal.id,
          orderNo: t.deal.orderNo,
          title: t.deal.title,
          contactName: c ? [c.firstNameHe, c.lastNameHe].filter(Boolean).join(' ') : null,
        }
      : null,
    reasons,
  };
}

// One batch query for every distinct owner id on the candidate rows — never
// one per task.
async function resolveOwners(rows, db) {
  const ids = [...new Set(rows.map((r) => r.ownerUserId).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await db.adminUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true },
  });
  return new Map(users.map((u) => [u.id, u.username]));
}

export async function searchTasks(q, pq, limit, todayIso, db) {
  // Owner matching needs names resolved BEFORE the where clause can filter on
  // them, so owner-name hits are found by resolving matching admins first.
  const matchingOwners = await db.adminUser.findMany({
    where: { username: ci(q) },
    select: { id: true },
  });

  const or = [
    { title: ci(q) },
    { notes: ci(q) },
    { status: ci(q) },
    { taskType: { is: { OR: [{ nameHe: ci(q) }, { key: ci(q) }] } } },
    { deal: { is: { title: ci(q) } } },
  ];
  if (matchingOwners.length) or.push({ ownerUserId: { in: matchingOwners.map((o) => o.id) } });

  const rows = await db.task.findMany({
    where: { OR: or },
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATE_CAP,
  });

  const ownerNames = await resolveOwners(rows, db);

  const hits = [];
  for (const t of rows) {
    const reasons = reasonsForTask(t, q, ownerNames);
    if (!reasons.length) continue;
    hits.push({
      score: scoreOf(reasons),
      groupRank: 0,
      updatedAt: t.updatedAt?.getTime?.() ?? 0,
      best: bestReason(reasons),
      dto: () => toDto(t, reasons, ownerNames),
    });
  }
  return { hits, truncated: rows.length >= CANDIDATE_CAP };
}
