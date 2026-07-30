// Hard delete for Communication Center events — a REAL delete, not disable and
// not archive (both of those stay as separate, unchanged actions).
//
// ── the relation graph this delete has to respect ────────────────────────────
// CommunicationEvent
//   ├─ messages   CommunicationMessage[]              FK eventId   → CASCADE
//   │    ├─ versions    CommunicationMessageVersion[] FK messageId → CASCADE
//   │    ├─ deliveries  CommunicationDelivery[]       FK messageId → CASCADE
//   │    ├─ testSends   CommunicationTestSend[]       FK messageId → CASCADE
//   │    └─ sendingWindow → CommunicationSendingWindow (message → window;
//   │         a window is SHARED policy, never owned by an event — untouched,
//   │         and the FK points the other way so nothing can orphan it)
//   └─ deliveries CommunicationDelivery[]             FK eventId   → CASCADE
//        └─ version → CommunicationMessageVersion     FK versionId → SET NULL
//
// Every child edge is a real foreign key with ON DELETE CASCADE at the DATABASE
// level (see migrations/20260827090000_communication_center/migration.sql), so
// the event row is the single cascade root: one delete removes the whole subtree
// atomically, no manual per-table deletes, no path that leaves an orphan.
// `publicNumber` gaps afterwards are expected and by design — numbers are never
// reused.
//
// ── the references that are NOT foreign keys ─────────────────────────────────
// A delivery that actually SENT also writes a Deal TimelineEntry
// (kind='communication', data.deliveryId). That row is permanent business
// history on the deal: it has no FK, and it renders entirely from its own frozen
// snapshot (message number, event name, recipient, subject), so it would keep
// displaying correctly — but its deliveryId would become a dangling pointer.
//
// That is the core reason deletion is BLOCKED once any delivery exists. The
// delivery log is the audit record of what GOS said to a customer; "we messaged
// this person" is not a fact a configuration screen may erase. Archive exists
// for that case.
//
// ── the race that cannot happen ─────────────────────────────────────────────
// A deletable event has no message with a publishedVersionId, and the engine
// (processTrigger) only ever creates deliveries for messages matching
// `status: 'active' AND publishedVersionId != null`. So no trigger can turn a
// deletable event into one with history mid-delete, whatever the event's own
// status is. The guard is still re-evaluated inside the transaction, so the
// invariant survives a future change to that query.

import { emitTimelineEvent } from '../timeline/events.js';

// Exactly the shape evaluateDeletability() needs — used by the DELETE guard and
// by GET /events/:id so the UI and the API can never disagree about the verdict.
export const DELETION_SELECT = {
  id: true,
  internalName: true,
  description: true,
  status: true,
  triggerType: true,
  createdAt: true,
  messages: {
    orderBy: { publicNumber: 'asc' },
    select: {
      id: true,
      publicNumber: true,
      internalName: true,
      channel: true,
      status: true,
      publishedVersionId: true,
      _count: { select: { versions: true, deliveries: true, testSends: true } },
    },
  },
  _count: { select: { deliveries: true } },
};

export function loadDeletionState(client, id) {
  return client.communicationEvent.findUnique({ where: { id }, select: DELETION_SELECT });
}

const count = (messages, field) => messages.reduce((n, m) => n + (m._count?.[field] || 0), 0);

/**
 * The ONE deletion verdict.
 *
 * Deletable = nothing was ever sent and nothing was ever published:
 *   • zero deliveries (scheduled, waiting, sent, failed, cancelled — any row)
 *   • zero published versions, on any message
 * Draft messages and internal test-send log rows do NOT block — no customer
 * communication exists and no business history references them — but they are
 * always reported in `cascade` so the confirmation can name what disappears.
 * Nothing is ever deleted silently.
 */
export function evaluateDeletability(event) {
  const messages = event?.messages || [];
  // Deliveries hang off BOTH the event and the message; the same rows, two FKs.
  // Take the larger of the two counts so a hypothetically mis-parented row
  // still blocks instead of slipping through.
  const deliveries = Math.max(event?._count?.deliveries || 0, count(messages, 'deliveries'));
  const publishedMessages = messages.filter((m) => m.publishedVersionId).length;
  const versions = count(messages, 'versions');
  const testSends = count(messages, 'testSends');

  const blockers = [];
  if (deliveries > 0) {
    blockers.push({
      code: 'has_deliveries',
      count: deliveries,
      he: `לאירוע יש ${deliveries} שליחות ביומן השליחות. יומן השליחות הוא רשומת ביקורת של מה שנשלח ללקוחות — הוא לא נמחק.`,
    });
  }
  if (publishedMessages > 0 || versions > 0) {
    blockers.push({
      code: 'has_published_version',
      count: versions || publishedMessages,
      he: `לאירוע יש ${versions || publishedMessages} גרסאות מסר שפורסמו. גרסה שפורסמה היא תצלום תוכן בלתי משתנה, ולכן היא נשמרת.`,
    });
  }

  return {
    deletable: blockers.length === 0,
    blockers,
    // What a successful delete removes with the event (cascade), so the
    // confirmation dialog can state it explicitly.
    cascade: {
      messages: messages.length,
      messageNumbers: messages.map((m) => m.publicNumber),
      testSends,
    },
    // Context for the blocked explanation.
    counts: { deliveries, publishedMessages, versions, testSends },
  };
}

/**
 * Delete an event and its whole subtree, or refuse.
 *
 * `client` is injected (prisma, or a fake in tests). `origin` is a resolved
 * timeline-origin object (userOrigin(userId)) — resolved by the caller BEFORE
 * the transaction so the audit write needs no extra lookup inside it.
 *
 * Returns { status, body } so the route stays a thin adapter.
 */
export async function deleteCommunicationEvent(client, { id, origin }) {
  const event = await loadDeletionState(client, id);
  if (!event) return { status: 404, body: { error: 'not_found' } };

  const verdict = evaluateDeletability(event);
  if (!verdict.deletable) {
    return { status: 422, body: { error: 'event_has_history', blockers: verdict.blockers, deletion: verdict } };
  }

  const deleted = await client.$transaction(async (tx) => {
    // Re-evaluate under the transaction: the verdict must hold at delete time,
    // not merely when the button was rendered.
    const fresh = await loadDeletionState(tx, id);
    if (!fresh) return null;
    const recheck = evaluateDeletability(fresh);
    if (!recheck.deletable) {
      const err = new Error('event_has_history');
      err.blockers = recheck.blockers;
      err.deletion = recheck;
      throw err;
    }

    // Audit INSIDE the transaction — an event is never deleted without its
    // audit row, and never audited without being deleted. The row outlives the
    // event: subjectId is a loose id with no FK, so it is not cascaded away.
    await emitTimelineEvent(tx, {
      subjectType: 'communication_event',
      subjectId: fresh.id,
      kind: 'change',
      body: null,
      data: {
        event: 'communication_event_deleted',
        snapshot: {
          internalName: fresh.internalName,
          description: fresh.description || null,
          status: fresh.status,
          triggerType: fresh.triggerType,
          createdAt: fresh.createdAt,
        },
        cascade: {
          messages: fresh.messages.map((m) => ({
            publicNumber: m.publicNumber,
            channel: m.channel,
            internalName: m.internalName || null,
            status: m.status,
          })),
          testSends: recheck.cascade.testSends,
        },
      },
      origin,
    });

    await tx.communicationEvent.delete({ where: { id: fresh.id } });
    return fresh;
  }).catch((err) => {
    if (err?.message === 'event_has_history') return { conflict: err };
    throw err;
  });

  if (!deleted) return { status: 404, body: { error: 'not_found' } };
  if (deleted.conflict) {
    return {
      status: 422,
      body: {
        error: 'event_has_history',
        blockers: deleted.conflict.blockers,
        deletion: deleted.conflict.deletion,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      deleted: {
        id: deleted.id,
        internalName: deleted.internalName,
        messages: verdict.cascade.messages,
        testSends: verdict.cascade.testSends,
      },
    },
  };
}
