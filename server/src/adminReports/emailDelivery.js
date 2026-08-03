// Email delivery for manager reports.
//
// Reuses email/simpleSend.js — the canonical server-initiated sender that the
// rest of GOS already uses. No new SMTP path, no second Gmail integration.
//
// This is an INTERNAL report to our own managers, so it is not subject to the
// "GOS-composed email is never sent to a customer without review" rule: the
// content is code-defined, the recipients are our own addresses, and the
// operator configured them. It IS subject to the sending-window policy for the
// manager audience, exactly like every other outgoing message.

import { prisma } from '../db.js';
import { sendCrmEmail } from '../email/simpleSend.js';
import { checkSendAllowed } from '../communication/sendingPolicy.js';

/** The house address, used unless the office switches it off. */
export const DEFAULT_REPORT_RECIPIENT = process.env.ADMIN_REPORT_EMAIL || null;

/**
 * Everyone this report goes to. Deliberately deduplicated and lowercased —
 * a duplicated address would send one manager the same digest twice.
 */
export function resolveEmailRecipients(config) {
  const out = new Set();
  if (config?.useDefaultRecipient !== false && DEFAULT_REPORT_RECIPIENT) {
    out.add(DEFAULT_REPORT_RECIPIENT.trim().toLowerCase());
  }
  for (const raw of config?.emailRecipients || []) {
    const v = String(raw || '').trim().toLowerCase();
    if (v.includes('@')) out.add(v);
  }
  return [...out];
}

/**
 * Send ONE email report delivery. Mirrors the WhatsApp path exactly: window
 * gate → send → record; a provider problem defers without burning an attempt.
 */
export async function deliverReportEmail(row, log = console) {
  const cfg = await prisma.adminReportConfig.findUnique({ where: { reportNumber: row.reportNumber }, select: { respectSendingWindow: true } });
  const gate = await checkSendAllowed({
    audienceKind: 'manager',
    channel: 'email',
    bypass: cfg?.respectSendingWindow === false,
    atMs: Date.now(),
  });
  if (!gate.allowed) {
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: {
        status: 'pending',
        waitReason: gate.reason,
        effectiveAt: gate.nextAt ? new Date(gate.nextAt) : null,
        nextRetryAt: gate.nextAt ? new Date(gate.nextAt) : new Date(Date.now() + 15 * 60_000),
      },
    });
    return { ok: false, held: true };
  }

  try {
    const res = await sendCrmEmail({
      to: row.recipientEmail,
      subject: row.renderedSubject || 'דיווח מנהלים',
      // The frozen text IS the body. Plain text preserved as-is so the layout
      // the report author wrote survives.
      bodyText: row.renderedText || '',
    });
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: res?.messageId || res?.id || null,
        lastError: null,
        nextRetryAt: null,
        waitReason: null,
        effectiveAt: null,
      },
    });
    log.info?.(`[admin-reports] emailed #${row.reportNumber} to ${row.recipientEmail}`);
    return { ok: true };
  } catch (err) {
    const code = err?.code || 'email_send_failed';
    // Integration-level problems are not this report's fault — preserve the row.
    const isConnection = ['email_not_configured', 'no_connected_account', 'invalid_grant'].includes(code);
    if (isConnection) {
      await prisma.adminReportDelivery.update({
        where: { id: row.id },
        data: {
          status: 'pending',
          connectionDeferredCount: { increment: 1 },
          lastError: String(code).slice(0, 200),
          waitReason: 'חיבור המייל אינו זמין — הדיווח ממתין ויישלח עם חזרת החיבור',
          nextRetryAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      return { ok: false, deferred: true };
    }

    const attempts = row.attemptCount + 1;
    const terminal = attempts >= 6;
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: {
        status: terminal ? 'failed_final' : 'failed',
        attemptCount: attempts,
        lastError: String(code).slice(0, 200),
        nextRetryAt: terminal ? null : new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000),
      },
    });
    log.warn?.(`[admin-reports] email failed #${row.reportNumber} (${code})`);
    return { ok: false };
  }
}
