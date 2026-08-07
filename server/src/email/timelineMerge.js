import { prisma } from '../db.js';

// Read-time merge of email messages into the Deal/Contact history feed.
// Emails are NOT copied into TimelineEntry rows — EmailMessage stays the ONE
// source of truth, and linking/unlinking a thread instantly adds/removes its
// history without backfill jobs. The feed shape mimics a TimelineEntry
// (kind='email', synthetic id) so the client renders it like any other event;
// createdAt = the email's sentAt so ordering is truly chronological.

// Batch-resolve GOS senders' usernames so outbound rows show the real actor.
async function usernamesFor(messages) {
  const ids = [...new Set(messages.map((m) => m.createdByUserId).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await prisma.adminUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true },
  });
  return new Map(users.map((u) => [u.id, u.username]));
}

export function toFeedItem(m, { engagement, username } = {}) {
  return {
    id: `email:${m.id}`,
    subjectType: 'deal',
    subjectId: m.thread?.linkedDealId || null,
    kind: 'email',
    body: null,
    isPinned: false,
    pinSortOrder: 0,
    isSystem: true,
    actorType: m.direction === 'outbound' ? 'user' : 'system',
    actorLabel: m.direction === 'outbound' ? null : m.fromName || m.fromEmail || 'אימייל',
    createdBy: m.createdByUserId || null,
    createdByName: username || null,
    createdAt: m.sentAt || m.createdAt,
    updatedAt: m.sentAt || m.createdAt,
    editedAt: null,
    deletedAt: null,
    comments: [],
    data: {
      // CANONICAL IDENTITY — the local ids the thread modal opens by. These
      // are real relations, never a subject match: this feed is derived from
      // EmailMessage at read time, so every row already knows exactly which
      // message and which thread it is.
      emailMessageId: m.id,
      threadId: m.threadId,
      direction: m.direction,
      // A mirrored EmailMessage only exists because Gmail ACCEPTED it (outbound)
      // or delivered it (inbound). So its delivery state is a fact, not a guess.
      // Anything still queued/failed/cancelled has no mirror row and arrives
      // through scheduledFeedItems below instead.
      deliveryState: m.direction === 'outbound' ? 'sent' : 'received',
      // Provenance, only where recorded: Gmail's SENT label cannot tell GOS
      // from someone typing in Gmail. Absence means "not known".
      sentFromGos: m.direction === 'outbound' && !!m.createdByUserId,
      subject: m.subject,
      snippet: m.snippet,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toRecipients: m.toRecipients,
      ccRecipients: m.ccRecipients,
      hasAttachments: m.hasAttachments,
      // The real count, so the row can say "3 קבצים" instead of a bare clip.
      attachmentCount: m._count?.attachments || 0,
      // Thread context: how big the conversation is, and whether it still
      // carries unread mail. Both come from the thread the message belongs to.
      threadMessageCount: m.thread?.messageCount || 0,
      threadUnread: (m.thread?.unreadCount || 0) > 0 || !!m.thread?.manualUnread,
      engagement: engagement
        ? {
            openCount: engagement.openCount,
            firstOpenedAt: engagement.firstOpenedAt,
            lastOpenedAt: engagement.lastOpenedAt,
          }
        : null,
    },
  };
}

// ── mail that has NOT reached Gmail ─────────────────────────────────────────
//
// A ScheduledEmail is a GOS-side intention. It becomes an EmailMessage only
// when Gmail accepts it (the worker stamps gmailMessageId), and from that
// moment the mirror row above IS its history.
//
// So the rule that keeps the feed honest AND duplicate-free is the same rule:
// a scheduled row appears here ONLY while it has no gmailMessageId. Queued,
// failed and cancelled mail is visible and truthfully labelled; accepted mail
// is represented exactly once, by the message Gmail actually has. There is no
// window in which both appear, and none in which a queued send reads as sent.
const SCHEDULED_STATE = { pending: 'queued', sending: 'queued', failed: 'failed', cancelled: 'cancelled' };

export function toScheduledFeedItem(s, { username } = {}) {
  const state = SCHEDULED_STATE[s.status] || 'queued';
  const to = Array.isArray(s.toJson) ? s.toJson : [];
  return {
    id: `scheduled-email:${s.id}`,
    subjectType: 'deal',
    subjectId: s.dealId || null,
    kind: 'email',
    body: null,
    isPinned: false,
    pinSortOrder: 0,
    isSystem: true,
    actorType: 'user',
    actorLabel: null,
    createdBy: null,
    createdByName: username || null,
    // Ordered by WHEN IT WAS MEANT TO GO OUT — a queued message belongs at the
    // moment it is due, which is where the operator is looking for it.
    createdAt: s.sentAt || s.scheduledAt || s.createdAt,
    updatedAt: s.updatedAt,
    editedAt: null,
    deletedAt: null,
    comments: [],
    data: {
      scheduledEmailId: s.id,
      // A REPLY carries its thread, so it can still be opened. A brand-new
      // queued message has no thread yet — the row says so instead of opening
      // something unrelated.
      threadId: s.threadId || null,
      emailMessageId: null,
      direction: 'outbound',
      deliveryState: state,
      failureReason: state === 'failed' ? s.failureReason || null : null,
      sentFromGos: true, // by definition — GOS composed and queued it
      subject: s.subject,
      snippet: null,
      fromEmail: null,
      fromName: null,
      toRecipients: to,
      ccRecipients: Array.isArray(s.ccJson) ? s.ccJson : [],
      hasAttachments: Array.isArray(s.attachments) && s.attachments.length > 0,
      attachmentCount: Array.isArray(s.attachments) ? s.attachments.length : 0,
      threadMessageCount: 0,
      threadUnread: false,
      engagement: null,
    },
  };
}

export const SCHEDULED_SELECT = {
  id: true, dealId: true, contactId: true, threadId: true, status: true, subject: true,
  toJson: true, ccJson: true, attachments: true, scheduledAt: true, sentAt: true,
  failureReason: true, createdAt: true, updatedAt: true,
};

// Not-yet-accepted scheduled mail for a deal/contact. `gmailMessageId: null` is
// the whole idempotency contract — see the note above.
async function scheduledFeedItems(where) {
  const rows = await prisma.scheduledEmail.findMany({
    where: { ...where, gmailMessageId: null },
    select: SCHEDULED_SELECT,
    orderBy: { scheduledAt: 'desc' },
    take: 50,
  });
  return rows.map((s) => toScheduledFeedItem(s));
}

export const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  direction: true,
  subject: true,
  snippet: true,
  fromEmail: true,
  fromName: true,
  toRecipients: true,
  ccRecipients: true,
  hasAttachments: true,
  sentAt: true,
  createdAt: true,
  createdByUserId: true,
  engagement: { select: { openCount: true, firstOpenedAt: true, lastOpenedAt: true } },
  // messageCount / unread let the row show how big the conversation is and
  // whether it still needs reading, without a second query per row.
  thread: {
    select: {
      linkedDealId: true, contactId: true,
      messageCount: true, unreadCount: true, manualUnread: true,
    },
  },
  _count: { select: { attachments: true } },
};

// Deal history: messages of threads linked to this deal.
// `dealId` accepts ONE id or a list. The list form serves merge lineage: a
// surviving deal's mail history is its own plus every deal retired into it, and
// the messages are still read from their real threads — nothing is copied,
// nothing is re-linked, and the Gmail thread identity each row carries is
// unchanged, so opening one from the merged deal opens the same canonical
// thread modal it always did.
export async function emailFeedItemsForDeal(dealId) {
  const ids = Array.isArray(dealId) ? dealId.filter(Boolean) : [dealId].filter(Boolean);
  if (!ids.length) return [];
  const messages = await prisma.emailMessage.findMany({
    where: { thread: { linkedDealId: { in: ids } } },
    select: MESSAGE_SELECT,
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  const names = await usernamesFor(messages);
  const sent = messages.map((m) =>
    toFeedItem(m, { engagement: m.engagement, username: names.get(m.createdByUserId) }),
  );
  // …plus anything still on its way out (or that failed on the way).
  return [...sent, ...(await scheduledFeedItems({ dealId: { in: ids } }))];
}

// Contact aggregate: messages of threads matched to this contact. Tagged so the
// aggregate view can badge items that belong to a linked deal.
export async function emailFeedItemsForContact(contactId) {
  const messages = await prisma.emailMessage.findMany({
    where: { thread: { contactId } },
    select: MESSAGE_SELECT,
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  const names = await usernamesFor(messages);
  const sent = messages.map((m) =>
    toFeedItem(m, { engagement: m.engagement, username: names.get(m.createdByUserId) }),
  );
  return [...sent, ...(await scheduledFeedItems({ contactId }))];
}
