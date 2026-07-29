import { prisma } from '../db.js';

// Single writer for system-generated TimelineEntry events (task lifecycle, deal
// files, …). Keeping ONE creator means every module emits history events the
// same way — kind + isSystem + a non-anonymous origin + a light `data` payload —
// and the feed's renderers stay the only place that knows how each kind looks.
//
// `client` may be a prisma transaction client so the event commits atomically
// with the state change that caused it.
// `createdAt` is optional and almost always omitted — the column default is
// correct for a standalone event. Pass it only when several entries are written
// inside ONE transaction and their relative order matters: PostgreSQL's
// CURRENT_TIMESTAMP is the transaction start time, so same-transaction rows
// would otherwise share an identical timestamp and sort arbitrarily.
export async function emitTimelineEvent(
  client,
  { subjectType = 'deal', subjectId, kind, body, data, origin, createdAt = null },
) {
  return (client || prisma).timelineEntry.create({
    data: {
      subjectType,
      subjectId,
      kind,
      body: body ?? null,
      isSystem: true,
      data: data ?? undefined,
      ...origin,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

// Non-anonymous origin fields (same shape the timeline routes use).
export function systemOrigin() {
  return { actorType: 'system', actorLabel: 'מערכת', createdBy: null, createdByName: null };
}

export async function userOrigin(userId) {
  if (!userId) return systemOrigin();
  const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
  return { actorType: 'user', actorLabel: null, createdBy: userId, createdByName: u?.username || null };
}
