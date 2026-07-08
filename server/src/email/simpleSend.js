import { prisma } from '../db.js';
import { emailIntegrationConfigured, gmail } from './googleClient.js';
import { buildRawMessage } from './mime.js';
import { ingestGmailMessage } from './ingest.js';

// Minimal server-initiated CRM email (no composer): a plain-text message
// through the first connected Gmail account, mirrored like any GOS-sent mail
// so it shows up in the email module and the deal's read-time timeline merge.
// Used by flows that must not dead-end when a provider fails (e.g. the iCount
// document-send Gmail fallback). No reply/forward threading and no
// open-tracking pixel — those stay in POST /api/email/send.

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

export async function sendSimpleEmail({ to, subject, bodyText, dealId = null, contactId = null, createdByUserId = null }) {
  if (!emailIntegrationConfigured()) throw coded('email_not_configured');
  const account = await prisma.emailAccount.findFirst({
    where: { isActive: true, refreshTokenEnc: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  if (!account) throw coded('no_connected_account');

  const raw = buildRawMessage({
    from: { email: account.emailAddress, name: account.displayName },
    to: [{ email: to, name: null }],
    subject,
    bodyText,
  });
  const sent = await gmail.sendRaw(prisma, account, raw, null);

  // Mirror immediately + link the thread to the CRM context (best-effort — the
  // send already succeeded; the sync worker catches anything missed here).
  try {
    const full = await gmail.getMessage(prisma, account, sent.id);
    const mirrored = await ingestGmailMessage(account, full, { createdByUserId });
    if (mirrored?.threadId && (dealId || contactId)) {
      const t = await prisma.emailThread.findUnique({
        where: { id: mirrored.threadId },
        select: { contactId: true, linkedDealId: true },
      });
      const patch = {};
      if (dealId && !t?.linkedDealId) {
        patch.linkedDealId = dealId;
        patch.linkSource = 'manual';
      }
      if (contactId && !t?.contactId) {
        patch.contactId = contactId;
        patch.matchSource = 'manual';
      }
      if (Object.keys(patch).length) {
        await prisma.emailThread.update({ where: { id: mirrored.threadId }, data: patch });
      }
    }
  } catch (e) {
    console.error('[email] sent but mirror failed (worker will catch up):', e?.message);
  }
  return { gmailMessageId: sent.id, accountEmail: account.emailAddress };
}
