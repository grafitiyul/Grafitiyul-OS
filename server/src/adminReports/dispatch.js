// Admin Reports dispatcher — fire → freeze → send, with idempotency and an
// auditable delivery row for every outcome (including "not configured").
//
// Canonical-data discipline: the report's values come from the SAME context
// loader real communications use (loadTriggerContext), augmented by the frozen
// trigger payload. Nothing here re-derives business state.

import { prisma } from '../db.js';
import { loadTriggerContext } from '../communication/context.js';
import { callBridge } from '../whatsapp/bridgeClient.js';
import { reportByNumber, renderReport } from './registry.js';

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
  { number, idempotencyKey, dealId = null, sessionId = null, tourEventId = null, data = null },
  log = console,
) {
  try {
    const report = reportByNumber(number);
    if (!report) return { ok: false, reason: 'unknown_report' };

    const config = await reportConfig(number);

    // Build the canonical context, then layer the frozen trigger payload.
    const ctx = await loadTriggerContext({ dealId, sessionId, tourEventId });
    Object.assign(ctx, data || {});
    const renderedText = renderReport(number, ctx);

    const base = {
      reportNumber: Number(number),
      idempotencyKey: String(idempotencyKey),
      dealId,
      payload: data ?? undefined,
      renderedText,
    };

    // Not configured / disabled → an auditable skipped row (the operator can
    // see the report WOULD have fired and what it would have said).
    if (!config || !config.enabled || !config.waAccountId || !config.waChatId) {
      await createDelivery({
        ...base,
        status: 'skipped',
        skipReason: !config
          ? 'הדיווח לא הוגדר עדיין (לא נבחר יעד)'
          : !config.enabled
            ? 'הדיווח מושבת'
            : 'לא הוגדר יעד WhatsApp מלא',
      }, log);
      return { ok: false, reason: 'not_configured' };
    }

    const row = await createDelivery({
      ...base,
      status: 'pending',
      waAccountId: config.waAccountId,
      waChatId: config.waChatId,
      destinationLabel: await destinationLabel(config),
    }, log);
    if (!row) return { ok: true, reason: 'duplicate' }; // idempotency hit

    await sendDelivery(row, log);
    return { ok: true, deliveryId: row.id };
  } catch (err) {
    log.error?.(`[admin-reports] #${number} dispatch failed: ${err?.message || err}`);
    return { ok: false, reason: 'error' };
  }
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

  try {
    const data = await callBridge(row.waAccountId, '/send', {
      method: 'POST',
      timeoutMs: 25_000,
      body: {
        jid: chat.externalChatId,
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
      },
    });
    log.info?.(`[admin-reports] sent #${row.reportNumber} delivery=${row.id}`);
    return { ok: true };
  } catch (err) {
    const code = err?.data?.error || err?.code || 'send_failed';
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
