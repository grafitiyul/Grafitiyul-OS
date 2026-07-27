import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { emailIntegrationConfigured, gmail } from './googleClient.js';
import { buildRawMessage, htmlToText, normalizeEmail, normalizeSubject } from './mime.js';
import { sanitizeEmailHtml } from './sanitize.js';
import { ingestGmailMessage } from './ingest.js';

// THE canonical send path for a COMPOSED email (recipients + subject + rich
// HTML + attachments, optionally a reply/forward). Used by:
//   • POST /api/email/send        — send now
//   • scheduledWorker.js          — send later
// Both go through this one function, so a scheduled email is byte-for-byte the
// same message the composer would have sent immediately: same sanitization,
// same direction serialization (via buildRawMessage), same threading headers,
// same mirroring and CRM linking. There is no second send implementation.

export const MAX_ATTACHMENT_TOTAL = 16 * 1024 * 1024; // matches the app-wide JSON limit

function coded(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

export function cleanRecipientList(input) {
  const out = [];
  for (const item of Array.isArray(input) ? input : []) {
    const email = normalizeEmail(typeof item === 'string' ? item : item?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    out.push({ email, name: (typeof item === 'object' && item?.name) || null });
  }
  return out;
}

// Resolve the account a composed email sends from. Explicit id wins; otherwise
// the first active connected account (same rule as getSendAccount).
export async function resolveSendAccount(accountId) {
  const account = accountId
    ? await prisma.emailAccount.findUnique({ where: { id: String(accountId) } })
    : await prisma.emailAccount.findFirst({
        where: { isActive: true, refreshTokenEnc: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
  if (!account || !account.refreshTokenEnc || !account.isActive) throw coded('no_connected_account');
  return account;
}

// Validate + normalize a composition WITHOUT sending. Shared by the immediate
// route and the scheduling route so a scheduled email can never be accepted in
// a shape that would fail at send time.
export function validateComposition({ to, cc, bcc, subject, bodyHtml, bodyText, attachments, replyToMessageId, forwardOfMessageId }) {
  const toList = cleanRecipientList(to);
  if (!toList.length) throw coded('recipient_required');
  const cleanHtml = sanitizeEmailHtml(bodyHtml || null);
  const cleanText = String(bodyText || '').trim() || htmlToText(cleanHtml || '');
  if (!cleanHtml && !cleanText) throw coded('body_required');
  const subj = String(subject || '').trim();
  // A reply/forward may leave the subject empty (Re:/Fwd: is derived at send).
  if (!subj && !replyToMessageId && !forwardOfMessageId) throw coded('subject_required');

  const files = [];
  let bytes = 0;
  for (const a of Array.isArray(attachments) ? attachments : []) {
    const filename = String(a?.filename || '').trim();
    const contentBase64 = String(a?.dataBase64 || a?.contentBase64 || '');
    if (!filename || !contentBase64) continue;
    bytes += Math.floor(contentBase64.length * 0.75);
    if (bytes > MAX_ATTACHMENT_TOTAL) throw coded('attachments_too_large');
    files.push({ filename, mimeType: a?.mimeType || null, contentBase64 });
  }
  return {
    to: toList,
    cc: cleanRecipientList(cc),
    bcc: cleanRecipientList(bcc),
    subject: subj,
    bodyHtml: cleanHtml,
    bodyText: cleanText,
    attachments: files,
  };
}

// Send a composed email. `origin` is the public base URL used for the
// open-tracking pixel. Throws coded errors; the caller maps them to HTTP or to
// a scheduled-row failure.
export async function sendComposedEmail({
  accountId = null,
  to,
  cc,
  bcc,
  subject,
  bodyHtml,
  bodyText,
  attachments,
  replyToMessageId = null,
  forwardOfMessageId = null,
  dealId = null,
  contactId = null,
  createdByUserId = null,
  origin,
}) {
  if (!emailIntegrationConfigured()) throw coded('email_not_configured');
  const account = await resolveSendAccount(accountId);
  const clean = validateComposition({
    to, cc, bcc, subject, bodyHtml, bodyText, attachments, replyToMessageId, forwardOfMessageId,
  });

  // Reply context: inherit the Gmail thread + RFC 822 threading headers.
  let gmailThreadId = null;
  let inReplyTo = null;
  let references = null;
  let finalSubject = clean.subject;
  if (replyToMessageId) {
    const orig = await prisma.emailMessage.findUnique({
      where: { id: String(replyToMessageId) },
      include: { thread: { select: { gmailThreadId: true, accountId: true } } },
    });
    if (!orig) throw coded('reply_source_not_found');
    if (orig.thread.accountId !== account.id) throw coded('reply_account_mismatch');
    gmailThreadId = orig.thread.gmailThreadId;
    inReplyTo = orig.messageIdHeader || null;
    references = [orig.referencesHeader, orig.messageIdHeader].filter(Boolean).join(' ') || null;
    if (!finalSubject) {
      const base = normalizeSubject(orig.subject || '');
      finalSubject = base ? `Re: ${base}` : 'Re:';
    }
  }

  // Forward: stays in the same Gmail conversation and the ORIGINAL files are
  // re-attached SERVER-side (the client never had their bytes).
  const outgoingAttachments = [...clean.attachments];
  if (forwardOfMessageId && !replyToMessageId) {
    const orig = await prisma.emailMessage.findUnique({
      where: { id: String(forwardOfMessageId) },
      include: { attachments: true, thread: { select: { gmailThreadId: true, accountId: true } } },
    });
    if (!orig) throw coded('forward_source_not_found');
    if (orig.thread.accountId !== account.id) throw coded('forward_account_mismatch');
    gmailThreadId = orig.thread.gmailThreadId;
    if (!finalSubject) {
      const base = normalizeSubject(orig.subject || '');
      finalSubject = base ? `Fwd: ${base}` : 'Fwd:';
    }
    for (const att of orig.attachments) {
      if (!att.gmailAttachmentId) continue;
      try {
        const payload = await gmail.getAttachment(prisma, account, orig.gmailMessageId, att.gmailAttachmentId);
        outgoingAttachments.push({
          filename: att.fileName,
          mimeType: att.mimeType || 'application/octet-stream',
          contentBase64: Buffer.from(payload.data || '', 'base64url').toString('base64'),
        });
      } catch (e) {
        throw coded('forward_attachment_failed', { detail: (e?.message || '').slice(0, 200) });
      }
    }
  }
  if (!finalSubject) throw coded('subject_required');

  // Open-tracking pixel (GOS-sent mail only). Public unauthenticated GET — the
  // tracking id is unguessable. Honest signal, not proof of reading.
  const trackingId = crypto.randomBytes(16).toString('base64url');
  const pixelUrl = `${origin}/api/track/email-open/${trackingId}.gif`;
  const htmlOut = `${clean.bodyHtml || `<p>${clean.bodyText.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;

  const raw = buildRawMessage({
    from: { email: account.emailAddress, name: account.displayName },
    to: clean.to,
    cc: clean.cc,
    bcc: clean.bcc,
    subject: finalSubject,
    bodyHtml: htmlOut,
    bodyText: clean.bodyText,
    inReplyTo,
    references,
    attachments: outgoingAttachments,
  });

  let sent;
  try {
    sent = await gmail.sendRaw(prisma, account, raw, gmailThreadId);
  } catch (e) {
    throw coded('send_failed', { detail: (e?.message || '').slice(0, 300), cause: e });
  }

  // Mirror immediately (don't wait for the worker) + engagement row.
  let mirrored = null;
  try {
    const full = await gmail.getMessage(prisma, account, sent.id);
    mirrored = await ingestGmailMessage(account, full, { createdByUserId, trackingId });
    // If the sync worker mirrored the sent message FIRST (rare race), its row
    // has no trackingId/creator — patch them in so opens still count.
    if (mirrored && mirrored.created === false && mirrored.message?.id) {
      await prisma.emailMessage.updateMany({
        where: { id: mirrored.message.id, trackingId: null },
        data: { trackingId, createdByUserId },
      });
    }
    if (mirrored?.message?.id) {
      await prisma.emailEngagement.upsert({
        where: { messageId: mirrored.message.id },
        create: { messageId: mirrored.message.id },
        update: {},
      });
    }
    // Explicit CRM context from the composer wins over auto-linking.
    if (mirrored?.threadId) {
      const t = await prisma.emailThread.findUnique({
        where: { id: mirrored.threadId },
        select: { contactId: true, linkedDealId: true },
      });
      const patch = {};
      if (dealId && !t?.linkedDealId) {
        patch.linkedDealId = String(dealId);
        patch.linkSource = 'manual';
      }
      if (contactId && !t?.contactId) {
        patch.contactId = String(contactId);
        patch.matchSource = 'manual';
      }
      if (Object.keys(patch).length) {
        await prisma.emailThread.update({ where: { id: mirrored.threadId }, data: patch });
      }
    }
  } catch (e) {
    // The send SUCCEEDED — never fail on mirror hiccups; the sync worker will
    // pick the message up within a minute.
    console.error('[email] sent but mirror failed (worker will catch up):', e?.message);
  }

  return {
    ok: true,
    gmailMessageId: sent.id,
    gmailThreadId: sent.threadId,
    threadId: mirrored?.threadId || null,
    messageId: mirrored?.message?.id || null,
  };
}
