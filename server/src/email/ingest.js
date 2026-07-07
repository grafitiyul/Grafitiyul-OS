import { prisma } from '../db.js';
import {
  headerMap,
  parseAddressList,
  parsePayload,
  decodeMimeWords,
  normalizeEmail,
  normalizeSubject,
  htmlToText,
} from './mime.js';
import { sanitizeEmailHtml } from './sanitize.js';
import { matchContactByEmails, resolveAutoDealId } from './matching.js';

// Idempotent ingest of ONE Gmail message (API `full` format) into the mirror.
// Used by BOTH the sync worker (inbound + externally-sent mail) and the send
// endpoint (mirror-immediately after users.messages.send).
//
// At-most-once import guarantees (safe to interrupt/re-run at ANY point):
//   • message + its attachments: ONE atomic create guarded by the
//     (accountId, gmailMessageId) unique constraint — a concurrent/duplicate
//     ingest hits P2002 and adopts the winner's row.
//   • thread aggregates (messageCount / unreadCount / lastMessageAt / snippet)
//     commit IN THE SAME TRANSACTION as the message create — a crash can never
//     leave a mirrored message with un-applied counters.
//   • thread create is unique-guarded on (accountId, gmailThreadId); a raced
//     create re-fetches the winner.
//   • timeline: emails merge at READ time — no rows exist to duplicate.
//
// Ingest is also where CRM linking happens (thread-level, like WhatsAppChat):
//   contact: exact single address match → link (matchSource='email')
//   deal:    exactly one safe candidate → link (linkSource='auto'), else manual
// A manual UNLINK sets the 'unlinked' sentinel — auto-linking respects it and
// never re-links what a user deliberately disconnected.

// DRAFT/SPAM/TRASH are not inbox material; CHAT is not email AT ALL — legacy
// Hangouts/Google Chat artifacts that Workspace stores inside the mailbox.
// messages.list returns them but Gmail's own UI/search never shows them (the
// exact "conversations that don't exist in Gmail" pollution from live QA).
const SKIP_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH', 'CHAT']);

function participantKey(p) {
  return normalizeEmail(p.email);
}

export function counterparties({ from, to, cc }, accountEmail) {
  const own = normalizeEmail(accountEmail);
  const all = [...(from ? [from] : []), ...(to || []), ...(cc || [])];
  const seen = new Map();
  for (const p of all) {
    const key = participantKey(p);
    if (!key || key === own) continue;
    const existing = seen.get(key);
    if (!existing || (!existing.name && p.name)) seen.set(key, { email: key, name: p.name || null });
  }
  return [...seen.values()];
}

// Auto-linking (idempotent — only ever fills NULLs, honours 'unlinked').
async function ensureThreadCrmLinks(db, thread) {
  let contactId = thread.contactId;
  if (!contactId && thread.matchSource !== 'unlinked') {
    const emails = (thread.participants || []).map((p) => p.email);
    const match = await matchContactByEmails(emails, db);
    if (match.contactId) {
      contactId = match.contactId;
      await db.emailThread.update({
        where: { id: thread.id },
        data: { contactId, matchSource: 'email' },
      });
    }
  }
  if (!thread.linkedDealId && contactId && thread.linkSource !== 'unlinked') {
    const dealId = await resolveAutoDealId(contactId, db);
    if (dealId) {
      await db.emailThread.update({
        where: { id: thread.id },
        data: { linkedDealId: dealId, linkSource: 'auto' },
      });
    }
  }
}

// → { created: boolean, message, threadId } | { skipped: true, reason }
// opts.db lets tests inject a fake client; production always uses the singleton.
export async function ingestGmailMessage(account, full, { createdByUserId = null, trackingId = null, db = prisma } = {}) {
  const labels = new Set(full.labelIds || []);
  for (const l of labels) if (SKIP_LABELS.has(l)) return { skipped: true, reason: l.toLowerCase() };

  // Fast path: already mirrored (backfill re-passes + races hit this).
  const existing = await db.emailMessage.findUnique({
    where: { accountId_gmailMessageId: { accountId: account.id, gmailMessageId: full.id } },
    select: { id: true, threadId: true },
  });
  if (existing) return { created: false, message: existing, threadId: existing.threadId };

  const h = headerMap(full.payload?.headers);
  const from = parseAddressList(h.from)[0] || null;
  const to = parseAddressList(h.to);
  const cc = parseAddressList(h.cc);
  const subject = decodeMimeWords(h.subject || '') || null;
  const sentAt = full.internalDate ? new Date(Number(full.internalDate)) : null;
  const direction =
    labels.has('SENT') || (from && normalizeEmail(from.email) === normalizeEmail(account.emailAddress))
      ? 'outbound'
      : 'inbound';

  const { bodyText, bodyHtml, attachments } = parsePayload(full.payload);
  const snippet = htmlToText(full.snippet || '').slice(0, 300) || null;
  // Provider state, straight from Gmail: INBOX membership drives the active
  // inbox; UNREAD drives unread (so backfilled already-read history never
  // shows as unread, and live mail matches Gmail exactly).
  const labelIds = full.labelIds || [];
  const inGmailInbox = labels.has('INBOX');
  const isGmailUnread = labels.has('UNREAD');

  // ── Thread upsert (unique-guarded against a concurrent creator) ──────────
  let thread = await db.emailThread.findUnique({
    where: { accountId_gmailThreadId: { accountId: account.id, gmailThreadId: full.threadId } },
  });
  const parties = counterparties({ from, to, cc }, account.emailAddress);
  if (!thread) {
    try {
      thread = await db.emailThread.create({
        data: {
          accountId: account.id,
          gmailThreadId: full.threadId,
          subject,
          normalizedSubject: normalizeSubject(subject),
          participants: parties,
          snippet,
          lastMessageAt: sentAt,
          inInbox: inGmailInbox,
        },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      // A parallel ingest of a sibling message created it first — adopt it.
      thread = await db.emailThread.findUnique({
        where: { accountId_gmailThreadId: { accountId: account.id, gmailThreadId: full.threadId } },
      });
      if (!thread) throw e;
    }
  }

  // ── Message + thread aggregates: ONE transaction ─────────────────────────
  // Either the message row, its attachments AND the counters all commit, or
  // none do — an interrupt can never strand a message with drifted counters.
  const isNewer = !thread.lastMessageAt || (sentAt && sentAt >= thread.lastMessageAt);
  const mergedParticipants = (() => {
    const seen = new Map((thread.participants || []).map((p) => [participantKey(p), p]));
    for (const p of parties) {
      const prev = seen.get(p.email);
      if (!prev || (!prev.name && p.name)) seen.set(p.email, p);
    }
    return [...seen.values()];
  })();

  let message;
  let created = true;
  try {
    message = await db.$transaction(async (tx) => {
      const row = await tx.emailMessage.create({
        data: {
          accountId: account.id,
          threadId: thread.id,
          gmailMessageId: full.id,
          messageIdHeader: h['message-id'] || null,
          inReplyTo: h['in-reply-to'] || null,
          referencesHeader: h.references || null,
          direction,
          fromEmail: from ? normalizeEmail(from.email) : null,
          fromName: from?.name || null,
          toRecipients: to,
          ccRecipients: cc,
          subject,
          snippet,
          bodyText: bodyText || null,
          bodyHtml: sanitizeEmailHtml(bodyHtml),
          sentAt,
          hasAttachments: attachments.length > 0,
          labelIds,
          createdByUserId,
          trackingId,
          ...(attachments.length
            ? {
                attachments: {
                  create: attachments.map((a) => ({
                    gmailAttachmentId: a.gmailAttachmentId,
                    partId: a.partId,
                    fileName: a.fileName,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                  })),
                },
              }
            : {}),
        },
      });
      await tx.emailThread.update({
        where: { id: thread.id },
        data: {
          subject: thread.subject || subject,
          normalizedSubject: thread.normalizedSubject || normalizeSubject(subject),
          participants: mergedParticipants,
          messageCount: { increment: 1 },
          ...(isNewer ? { lastMessageAt: sentAt, snippet } : {}),
          // An INBOX-labeled message puts/keeps the thread in the active inbox
          // (Gmail behavior: a new message revives an archived conversation).
          // Non-inbox messages never FLIP it off here — that only happens via
          // label-change events (recomputeThreadState).
          ...(inGmailInbox ? { inInbox: true } : {}),
          // Unread mirrors Gmail's inbox badge: only UNREAD messages that are
          // ALSO in the INBOX count (an archived-but-never-opened message
          // doesn't bold Gmail's inbox — it must not bold ours). Outbound
          // resets (replying from anywhere means the conversation was handled).
          ...(direction === 'inbound'
            ? isGmailUnread && inGmailInbox
              ? { unreadCount: { increment: 1 } }
              : {}
            : { unreadCount: 0, lastReadAt: new Date(), manualUnread: false }),
        },
      });
      return row;
    });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    // Raced with a parallel ingest of the SAME message — the whole transaction
    // rolled back (no double counters); adopt the winner's row.
    created = false;
    message = await db.emailMessage.findUnique({
      where: { accountId_gmailMessageId: { accountId: account.id, gmailMessageId: full.id } },
      select: { id: true, threadId: true },
    });
    if (!message) throw e;
  }

  // ── CRM auto-linking (idempotent; outside the tx — safe to re-run) ───────
  await ensureThreadCrmLinks(db, { ...thread, participants: mergedParticipants });

  return { created, message, threadId: thread.id };
}
