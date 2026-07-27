import { prisma } from '../db.js';

// Provider-state maintenance for the Gmail mirror — the piece that keeps the
// ACTIVE inbox honest. The mirror is append-only (CRM history never loses
// data); these functions track what Gmail itself would show TODAY:
//
//   labelAdded / labelRemoved  → message.labelIds updated, thread recomputed
//   messageDeleted             → providerDeletedAt stamped (row kept)
//   recomputeThreadState       → inInbox / unreadCount / lastMessageAt /
//                                snippet derived from LIVE messages only
//
// UNREAD CONTRACT (single source of truth): a thread's unread count is exactly
// the number of live messages Gmail itself labels INBOX ∩ UNREAD. GOS never
// second-guesses that label — see recomputeThreadState for why the previous
// direction/lastReadAt filters were removed.
//
// All operations are idempotent — the history window may be replayed after an
// interrupted tick and must converge to the same state.

// Apply one history label change to the mirrored message (no-op when the
// message isn't mirrored — e.g. older than the backfill window).
// Returns the affected threadId or null.
export async function applyLabelChange(account, { message, labelIds }, kind, db = prisma) {
  if (!message?.id || !Array.isArray(labelIds) || !labelIds.length) return null;
  const row = await db.emailMessage.findUnique({
    where: { accountId_gmailMessageId: { accountId: account.id, gmailMessageId: message.id } },
    select: { id: true, threadId: true, labelIds: true },
  });
  if (!row) return null;
  const current = new Set(Array.isArray(row.labelIds) ? row.labelIds : []);
  for (const l of labelIds) {
    if (kind === 'add') current.add(l);
    else current.delete(l);
  }
  await db.emailMessage.update({
    where: { id: row.id },
    data: { labelIds: [...current] },
  });
  return row.threadId;
}

// Gmail reported the message deleted — keep the row (CRM history), flag it so
// active views exclude it. Returns the affected threadId or null.
export async function applyMessageDeleted(account, gmailMessageId, db = prisma) {
  const row = await db.emailMessage.findUnique({
    where: { accountId_gmailMessageId: { accountId: account.id, gmailMessageId } },
    select: { id: true, threadId: true, providerDeletedAt: true },
  });
  if (!row) return null;
  if (!row.providerDeletedAt) {
    await db.emailMessage.update({
      where: { id: row.id },
      data: { providerDeletedAt: new Date() },
    });
  }
  return row.threadId;
}

// Re-derive thread state from its LIVE (non-deleted) messages:
//   inInbox     — any live message carries INBOX
//   unreadCount — live messages carrying BOTH UNREAD and INBOX: the exact set
//                 Gmail's own inbox badge counts. An archived unread message
//                 doesn't bold Gmail's inbox, so it must not bold ours.
//
//                 Deliberately NOT filtered by direction: normal sent mail
//                 never carries INBOX, so the old `direction === 'inbound'`
//                 test excluded exactly one real case — mail the user sends to
//                 THEMSELVES (Gmail stamps it SENT *and* INBOX). Those are
//                 notes-to-self/reminders that Gmail shows as unread, and
//                 hiding them made the GOS badge diverge from Gmail's.
//
//                 Deliberately NOT suppressed by thread.lastReadAt either.
//                 That cutoff dates from the read-only-scope era, when a GOS
//                 read could not clear Gmail's UNREAD label. GOS now holds
//                 gmail.modify and writes read-state back, so Gmail's label is
//                 authoritative: a thread read in GOS is cleared in Gmail and
//                 the label disappears here on the next sync. (Trade-off,
//                 accepted deliberately: if that write-back ever fails, the
//                 thread stays honestly unread instead of silently hiding a
//                 message that is still unread in the real mailbox.)
//   lastMessageAt / snippet — from the newest live message.
export async function recomputeThreadState(threadId, db = prisma) {
  const thread = await db.emailThread.findUnique({
    where: { id: threadId },
    select: { id: true, lastReadAt: true },
  });
  if (!thread) return null;
  const messages = await db.emailMessage.findMany({
    where: { threadId, providerDeletedAt: null },
    select: { labelIds: true, sentAt: true, snippet: true },
    orderBy: { sentAt: 'desc' },
  });
  const has = (m, label) => Array.isArray(m.labelIds) && m.labelIds.includes(label);
  const inInbox = messages.some((m) => has(m, 'INBOX'));
  const unreadCount = messages.filter((m) => has(m, 'UNREAD') && has(m, 'INBOX')).length;
  const newest = messages[0] || null;
  return db.emailThread.update({
    where: { id: threadId },
    data: {
      inInbox,
      unreadCount,
      messageCount: messages.length,
      lastMessageAt: newest?.sentAt ?? null,
      ...(newest ? { snippet: newest.snippet } : {}),
    },
  });
}
