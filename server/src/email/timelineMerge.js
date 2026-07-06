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

function toFeedItem(m, { engagement, username } = {}) {
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
      emailMessageId: m.id,
      threadId: m.threadId,
      direction: m.direction,
      subject: m.subject,
      snippet: m.snippet,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toRecipients: m.toRecipients,
      hasAttachments: m.hasAttachments,
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

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  direction: true,
  subject: true,
  snippet: true,
  fromEmail: true,
  fromName: true,
  toRecipients: true,
  hasAttachments: true,
  sentAt: true,
  createdAt: true,
  createdByUserId: true,
  engagement: { select: { openCount: true, firstOpenedAt: true, lastOpenedAt: true } },
  thread: { select: { linkedDealId: true, contactId: true } },
};

// Deal history: messages of threads linked to this deal.
export async function emailFeedItemsForDeal(dealId) {
  const messages = await prisma.emailMessage.findMany({
    where: { thread: { linkedDealId: dealId } },
    select: MESSAGE_SELECT,
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  const names = await usernamesFor(messages);
  return messages.map((m) =>
    toFeedItem(m, { engagement: m.engagement, username: names.get(m.createdByUserId) }),
  );
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
  return messages.map((m) =>
    toFeedItem(m, { engagement: m.engagement, username: names.get(m.createdByUserId) }),
  );
}
