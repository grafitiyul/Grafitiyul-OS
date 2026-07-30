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
  const entry = await (client || prisma).timelineEntry.create({
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
  // Every deal timeline event IS meaningful business activity by definition —
  // this funnel is only ever called for user-visible history (field changes,
  // stage moves, tasks, files, payments, deliveries, questionnaires…), never
  // for technical maintenance. Stamped with the ENTRY's timestamp, so a
  // backdated source event stamps its source time and a replay can never move
  // the deal forward (see touchDealActivity's GREATEST).
  if (subjectType === 'deal') await touchDealActivity(client, subjectId, entry.createdAt);
  return entry;
}

// THE writer for Deal.lastMeaningfulActivityAt — the canonical "when did a
// human-visible thing last happen on this deal" stamp that the Deals list
// orders by. Deliberately NOT updatedAt: reconcilers, mirrors and workers
// touch rows without meaning anything to a person.
//
// Monotonic by construction (GREATEST in one statement): idempotent under
// event replay, safe under out-of-order delivery, and callers can pass the
// SOURCE event's timestamp rather than processing time. Never throws — an
// activity stamp must never break the business write it rides on.
export async function touchDealActivity(client, dealId, at = new Date()) {
  if (!dealId) return;
  try {
    // LEAST(at, now()): a FUTURE-dated entry (imported future activities
    // exist in production) must not pin its deal to the top of the list until
    // that date arrives — activity means "happened", not "planned".
    await (client || prisma).$executeRaw`
      UPDATE "Deal"
         SET "lastMeaningfulActivityAt" = GREATEST(
               COALESCE("lastMeaningfulActivityAt"::timestamptz, '-infinity'::timestamptz),
               LEAST(${at}::timestamptz, now())
             )
       WHERE "id" = ${dealId}`;
  } catch (e) {
    console.error('[timeline] touchDealActivity failed (non-fatal) for deal', dealId, e?.message);
  }
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
