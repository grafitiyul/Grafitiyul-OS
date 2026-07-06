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
// endpoint (mirror-immediately after users.messages.send). Duplicate deliveries
// are absorbed by the (accountId, gmailMessageId) unique constraint.
//
// Ingest is where CRM linking happens (thread-level, like WhatsAppChat):
//   contact: exact single address match → link (matchSource='email')
//   deal:    exactly one safe candidate → link (linkSource='auto'), else manual

const SKIP_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH']);

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

// → { created: boolean, message, threadId } | { skipped: true, reason }
export async function ingestGmailMessage(account, full, { createdByUserId = null, trackingId = null } = {}) {
  const labels = new Set(full.labelIds || []);
  for (const l of labels) if (SKIP_LABELS.has(l)) return { skipped: true, reason: l.toLowerCase() };

  // Fast path: already mirrored (backfill re-passes hit this constantly).
  const existing = await prisma.emailMessage.findUnique({
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

  // ── Thread upsert ──────────────────────────────────────────────────────────
  let thread = await prisma.emailThread.findUnique({
    where: { accountId_gmailThreadId: { accountId: account.id, gmailThreadId: full.threadId } },
  });
  const parties = counterparties({ from, to, cc }, account.emailAddress);
  if (!thread) {
    thread = await prisma.emailThread.create({
      data: {
        accountId: account.id,
        gmailThreadId: full.threadId,
        subject,
        normalizedSubject: normalizeSubject(subject),
        participants: parties,
        snippet,
        lastMessageAt: sentAt,
      },
    });
  }

  // ── Message create (idempotent on the unique constraint) ─────────────────
  let message;
  let created = true;
  try {
    message = await prisma.emailMessage.create({
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
  } catch (e) {
    if (e.code === 'P2002') {
      // Raced with a parallel ingest — the other write won; nothing to do.
      const row = await prisma.emailMessage.findUnique({
        where: { accountId_gmailMessageId: { accountId: account.id, gmailMessageId: full.id } },
        select: { id: true, threadId: true },
      });
      return { created: false, message: row, threadId: row?.threadId || thread.id };
    }
    throw e;
  }

  // ── Thread aggregates ─────────────────────────────────────────────────────
  const isNewer = !thread.lastMessageAt || (sentAt && sentAt >= thread.lastMessageAt);
  const mergedParticipants = (() => {
    const seen = new Map((thread.participants || []).map((p) => [participantKey(p), p]));
    for (const p of parties) {
      const prev = seen.get(p.email);
      if (!prev || (!prev.name && p.name)) seen.set(p.email, p);
    }
    return [...seen.values()];
  })();
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: {
      subject: thread.subject || subject,
      normalizedSubject: thread.normalizedSubject || normalizeSubject(subject),
      participants: mergedParticipants,
      messageCount: { increment: 1 },
      ...(isNewer ? { lastMessageAt: sentAt, snippet } : {}),
      // GOS-side unread only (never written to Gmail). Outbound resets it —
      // replying from anywhere means the conversation was handled.
      ...(direction === 'inbound' ? { unreadCount: { increment: 1 } } : { unreadCount: 0, lastReadAt: new Date() }),
    },
  });

  // ── CRM auto-linking (safe rules only) ────────────────────────────────────
  let contactId = thread.contactId;
  if (!contactId) {
    const match = await matchContactByEmails(mergedParticipants.map((p) => p.email));
    if (match.contactId) {
      contactId = match.contactId;
      await prisma.emailThread.update({
        where: { id: thread.id },
        data: { contactId, matchSource: 'email' },
      });
    }
  }
  if (!thread.linkedDealId && contactId) {
    const dealId = await resolveAutoDealId(contactId);
    if (dealId) {
      await prisma.emailThread.update({
        where: { id: thread.id },
        data: { linkedDealId: dealId, linkSource: 'auto' },
      });
    }
  }

  return { created, message, threadId: thread.id };
}
