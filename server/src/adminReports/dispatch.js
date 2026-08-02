// Admin Reports dispatcher — fire → freeze → send, with idempotency and an
// auditable delivery row for every outcome (including "not configured").
//
// Canonical-data discipline: the report's values come from the SAME context
// loader real communications use (loadTriggerContext), augmented by the frozen
// trigger payload. Nothing here re-derives business state.

import { prisma } from '../db.js';
import { loadTriggerContext } from '../communication/context.js';
import { callBridge } from '../whatsapp/bridgeClient.js';
import { phoneToJid } from '../whatsapp/send.js';
import { reserveSendSlot } from '../whatsapp/sendPace.js';
import { reportByNumber, renderReport, renderReportSubject, reportChannel } from './registry.js';
import { deliverReportEmail, resolveEmailRecipients } from './emailDelivery.js';
import { checkSendAllowed, audienceKindFromReport } from '../communication/sendingPolicy.js';
import { enqueueCustomerMessage } from './customerDelivery.js';

/** Resolve destination + enabled state for a report (null when unconfigured). */
export async function reportConfig(number) {
  return prisma.adminReportConfig.findUnique({ where: { reportNumber: Number(number) } });
}

/** Human label for a configured destination (group subject / phone). */
export async function destinationLabel(config) {
  if (!config?.waChatId) return null;
  const chat = await prisma.whatsAppChat.findUnique({
    where: { id: config.waChatId },
    select: { groupSubject: true, phoneNumber: true, savedContactName: true, type: true },
  });
  if (!chat) return null;
  return chat.type === 'group'
    ? (chat.groupSubject || 'קבוצת WhatsApp')
    : (chat.savedContactName || chat.phoneNumber || 'שיחה פרטית');
}

/**
 * Fire an admin report.
 *   number         — catalog number (registry.js)
 *   idempotencyKey — business-event identity; a replay never sends twice
 *   dealId/sessionId/tourEventId — canonical context to load
 *   data           — trigger payload merged onto the context (frozen)
 * Never throws into the caller: a reporting failure must not affect business
 * operations.
 */
export async function fireAdminReport(
  { number, idempotencyKey, dealId = null, sessionId = null, tourEventId = null, data = null, recipient = null },
  log = console,
) {
  try {
    const report = reportByNumber(number);
    if (!report) return { ok: false, reason: 'unknown_report' };
    // A guide- or customer-audience report addresses ONE PERSON; the caller
    // resolves who and passes them in. The configured group chat is irrelevant
    // for these — only the sending account is.
    const toPerson = report.audience === 'guides' || report.audience === 'customer';
    if (toPerson && !recipient) return { ok: false, reason: 'recipient_required' };

    const config = await reportConfig(number);

    // Build the canonical context, then layer the frozen trigger payload.
    const ctx = await loadTriggerContext({ dealId, sessionId, tourEventId });
    Object.assign(ctx, data || {});
    if (recipient) ctx.recipient = recipient;
    // Language. Guide-audience reports may follow the guide's own preferred
    // language when the office enables it; manager reports stay Hebrew unless
    // the same switch is turned on for them. Falls back to Hebrew whenever the
    // report has no English version, so an untranslated report still arrives.
    // A CUSTOMER report always follows the customer's own language: "send in
    // the guide's language" is a staff setting and has no meaning here, and a
    // customer must never receive Hebrew because an internal toggle is off.
    const lang = report.audience === 'customer'
      ? (recipient?.preferredLanguage || 'he')
      : (config?.sendInGuideLanguage ? (recipient?.preferredLanguage || 'he') : 'he');
    const renderedText = renderReport(number, ctx, lang);

    const base = {
      reportNumber: Number(number),
      idempotencyKey: String(idempotencyKey),
      dealId,
      payload: data ?? undefined,
      renderedText,
      recipientPersonRefId: recipient?.personRefId || null,
      recipientPhone: recipient?.phone || null,
      recipientName: recipient?.name || null,
    };

    // Not configured / disabled → an auditable skipped row (the operator can
    // see the report WOULD have fired and what it would have said).
    const isEmail = reportChannel(report) === 'email';
    const destinationMissing = isEmail
      ? resolveEmailRecipients(config).length === 0
      : (toPerson ? !config?.waAccountId : !(config?.waAccountId && config?.waChatId));
    if (!config || !config.enabled || destinationMissing) {
      await createDelivery({
        ...base,
        status: 'skipped',
        skipReason: !config
          ? 'הדיווח לא הוגדר עדיין (לא נבחר יעד)'
          : !config.enabled
            ? 'הדיווח מושבת'
            : isEmail ? 'לא הוגדרו נמעני אימייל' : toPerson ? 'לא נבחר חשבון שולח' : 'לא הוגדר יעד WhatsApp מלא',
      }, log);
      return { ok: false, reason: 'not_configured' };
    }

    // A guide with no phone (or a revoked portal) is an honest skip, not a
    // silent drop — operations can see exactly who was unreachable.
    if (toPerson && !recipient.phone) {
      await createDelivery({
        ...base, status: 'skipped', waAccountId: config.waAccountId,
        skipReason: `אין מספר טלפון ל${recipient.name || 'מדריך'}`,
      }, log);
      return { ok: false, reason: 'recipient_unreachable' };
    }

    if (reportChannel(report) === 'email') return fireEmailReport({ report, config, base, ctx }, log);

    const row = await createDelivery({
      ...base,
      status: 'pending',
      waAccountId: config.waAccountId,
      waChatId: toPerson ? null : config.waChatId,
      destinationLabel: toPerson ? (recipient.name || recipient.phone) : await destinationLabel(config),
    }, log);
    if (!row) return { ok: true, reason: 'duplicate' }; // idempotency hit

    // Customer messages are TRANSPORTED by the shared queue (customer windows,
    // connection deferral, retries, attachments). The row above is the
    // exactly-once gate; the queue is what actually sends.
    if (report.audience === 'customer') {
      await enqueueCustomerMessage(row, { attachments: data?.attachments || [] }, log);
      return { ok: true, deliveryId: row.id };
    }

    await sendDelivery(row, log);
    return { ok: true, deliveryId: row.id };
  } catch (err) {
    log.error?.(`[admin-reports] #${number} dispatch failed: ${err?.message || err}`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Email reports fan out to ONE delivery row per recipient, so every address has
 * its own auditable outcome and its own retry — a bounced manager address must
 * not hide a successful send to the others.
 */
async function fireEmailReport({ report, config, base, ctx }, log) {
  const recipients = resolveEmailRecipients(config);
  const subject = renderReportSubject(report.number, ctx);
  let created = 0;
  for (const email of recipients) {
    const row = await createDelivery({
      ...base,
      channel: 'email',
      status: 'pending',
      emailAccountId: config.emailAccountId || null,
      recipientEmail: email,
      renderedSubject: subject,
      destinationLabel: email,
      // One row per (business event × recipient).
      idempotencyKey: `${base.idempotencyKey}:${email}`,
    }, log);
    if (!row) continue; // idempotency hit — already sent to this address
    created++;
    await sendDelivery(row, log);
  }
  return { ok: created > 0, reason: created ? undefined : 'duplicate' };
}

async function createDelivery(data, log) {
  try {
    return await prisma.adminReportDelivery.create({ data });
  } catch (err) {
    if (err?.code === 'P2002') return null; // same business event — already recorded
    log.error?.(`[admin-reports] delivery create failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Send one delivery through the canonical WhatsApp bridge. The message text is
 * the FROZEN renderedText — a retry re-sends exactly what was reported.
 */
export async function sendDelivery(row, log = console) {
  // Email deliveries have their own transport; everything else goes to the
  // WhatsApp bridge exactly as before.
  if (row.channel === 'email') return deliverReportEmail(row, log);

  // Per-person delivery (guide-audience report): the destination is the frozen
  // phone, normalised by the canonical phoneToJid. No chat row is involved.
  if (!row.waChatId && row.recipientPhone) {
    const jid = phoneToJid(row.recipientPhone);
    if (!jid) {
      await prisma.adminReportDelivery.update({
        where: { id: row.id },
        data: { status: 'failed_final', lastError: 'מספר הטלפון של הנמען אינו תקין' },
      });
      return { ok: false };
    }
    return deliverText(row, jid, log);
  }

  const chat = await prisma.whatsAppChat.findUnique({
    where: { id: row.waChatId },
    select: { externalChatId: true, accountId: true },
  });
  if (!chat) {
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: { status: 'failed_final', lastError: 'יעד ה-WhatsApp אינו קיים עוד' },
    });
    return { ok: false };
  }
  if (chat.accountId !== row.waAccountId) {
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: { status: 'failed_final', lastError: 'היעד אינו נגיש לחשבון השולח שנבחר' },
    });
    return { ok: false };
  }

  return deliverText(row, chat.externalChatId, log);
}

// Bridge/connection problems are NOT the report's fault. Deferring on these
// preserves the row without burning a real attempt — the same contract the
// WhatsApp and email schedulers already had. Before this, a day-long outage
// could exhaust the 6-attempt ladder and lose internal reports permanently.
const CONNECTION_CODES = new Set([
  'whatsapp_not_connected', 'bridge_not_configured', 'bridge_unreachable',
  'send_timeout', 'bridge_auth_failed',
]);
const CONNECTION_DEFER_MS = 60_000;

/** Send the FROZEN text to a resolved JID and record the outcome. */
async function deliverText(row, jid, log = console) {
  // Sending window. Internal reports follow the manager policy unless the
  // report addresses a guide. A held report WAITS with a visible reason — an
  // overnight backlog must not land at 03:00.
  const report = reportByNumber(row.reportNumber);
  const gate = await checkSendAllowed({
    audienceKind: audienceKindFromReport(report),
    channel: 'whatsapp',
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
    // Central anti-burst pacing. Manager reports used to be the worst offender:
    // this loop had no spacing at all and fired every due delivery back to back.
    await reserveSendSlot(prisma, row.waAccountId);
    const data = await callBridge(row.waAccountId, '/send', {
      method: 'POST',
      timeoutMs: 25_000,
      body: {
        jid,
        text: row.renderedText || '',
        // Attempt-stable key: a recovered retry replays at the bridge instead
        // of delivering a second message.
        idempotencyKey: `gos-report-${row.id}-a${row.attemptCount}`,
      },
    });
    await prisma.adminReportDelivery.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: data?.externalMessageId ?? null,
        lastError: null,
        nextRetryAt: null,
        waitReason: null,
        effectiveAt: null,
      },
    });
    log.info?.(`[admin-reports] sent #${row.reportNumber} delivery=${row.id}`);
    return { ok: true };
  } catch (err) {
    const code = err?.data?.error || err?.code || 'send_failed';

    // Provider unreachable → defer WITHOUT consuming an attempt. The message is
    // preserved and retried; only real send failures walk the ladder.
    if (CONNECTION_CODES.has(code)) {
      await prisma.adminReportDelivery.update({
        where: { id: row.id },
        data: {
          status: 'pending',
          connectionDeferredCount: { increment: 1 },
          lastError: String(code).slice(0, 200),
          waitReason: 'החיבור ל-WhatsApp אינו זמין — הדיווח ממתין וישלח אוטומטית עם חזרת החיבור',
          nextRetryAt: new Date(Date.now() + CONNECTION_DEFER_MS),
        },
      });
      log.warn?.(`[admin-reports] deferred #${row.reportNumber} (${code}) — connection unavailable`);
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
    log.warn?.(`[admin-reports] send failed #${row.reportNumber} (${code})`);
    return { ok: false };
  }
}
