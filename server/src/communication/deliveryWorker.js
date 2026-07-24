// Communication delivery worker — claim-based, modeled on the proven WhatsApp
// scheduledWorker pattern (conditional-updateMany claim + TTL, recovery sweep
// that decrements attemptCount so idempotency keys replay, connection failures
// don't consume attempts, exponential backoff ladder, terminal after
// MAX_ATTEMPTS).
//
// Per-delivery pipeline (every send re-derives the time-sensitive facts):
//   1. config re-check — message/event disabled or version gone → cancelled.
//   2. anchor re-check — tour_datetime deliveries re-resolve the tour: date
//      moved to the future → rescheduled; tour cancelled (for non-cancellation
//      events) → cancelled; anchor still unknown → bounded dependency wait.
//   3. window — the ONE evaluator; outside → waiting_window with the original
//      intendedAt preserved, effectiveAt = next allowed instant, and the
//      winning rule as waitReason. Exceptions are re-read every pass.
//   4. recipient re-resolution — fresh phones/emails/group availability.
//   5. render — frozen version content + live variables/documents. Missing
//      variables/documents NEVER substitute silently: bounded dependency wait
//      (data may arrive), then failed_final with the explicit reason.
//   6. channel adapter send (frozen sender — no account fallback).
//   7. renderedContent frozen onto the delivery + Timeline event.

import { prisma } from '../db.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { loadTriggerContext } from './context.js';
import { resolveAnchorMs, applyOffset } from './timing.js';
import { loadWindowPolicy, evaluateAt, nextAllowedAt } from './windows.js';
import { resolveRecipients, resolveLanguage } from './recipients.js';
import { renderMessage } from './render.js';
import { sendWhatsAppDelivery } from './channels/whatsapp.js';
import { sendEmailDelivery } from './channels/email.js';

const TICK_MS = 60_000;
const TICK_BATCH = 10;
const SEND_PACING_MS = 1200;
const MAX_ATTEMPTS = 8;
const CLAIM_TTL_MS = 5 * 60_000;
const CONNECTION_DEFER_MS = 60_000;
const DEPENDENCY_RECHECK_MS = 10 * 60_000;
const DEPENDENCY_MAX_AGE_MS = 48 * 60 * 60_000; // bounded waiting — never unbounded
const NO_WINDOW_RECHECK_MS = 6 * 60 * 60_000;
const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000, 240 * 60_000];

const WORKER_ID = `gos-comm-${process.pid}-${Date.now()}`;

const CONNECTION_CODES = new Set([
  'whatsapp_not_connected', 'bridge_not_configured', 'bridge_unreachable',
  'send_timeout', 'on_whatsapp_timeout', 'on_whatsapp_failed', 'bridge_auth_failed',
  'email_not_configured', 'no_connected_account',
]);
const TERMINAL_CODES = new Set(['whatsapp_number_not_found', 'invalid_payload']);

export function classify(err) {
  const code = err?.data?.error || err?.code || (err instanceof Error ? err.message : 'send_failed');
  if (TERMINAL_CODES.has(code)) return { kind: 'terminal', code };
  if (CONNECTION_CODES.has(code)) return { kind: 'retryable_connection', code };
  if (code === 'document_unavailable') return { kind: 'dependency', code };
  if (code === 'bridge_error' || /fetch failed|abort/i.test(String(err?.message))) {
    return { kind: 'retryable_connection', code: 'bridge_unreachable' };
  }
  return { kind: 'retryable_send', code: String(code).slice(0, 120) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function release(id, data) {
  await prisma.communicationDelivery.update({
    where: { id },
    data: { ...data, claimedAt: null, claimedBy: null },
  });
}

async function processDelivery(row, log) {
  const now = Date.now();

  // 1. Configuration re-check — disabled/unpublished config cancels queued work.
  const message = await prisma.communicationMessage.findUnique({
    where: { id: row.messageId },
    include: { event: true },
  });
  if (!message || message.status !== 'active' || message.event.status !== 'active') {
    await release(row.id, {
      status: 'cancelled', cancelledAt: new Date(),
      waitReason: 'המסר או האירוע הושבתו בזמן ההמתנה',
    });
    return;
  }
  const version = row.versionId
    ? await prisma.communicationMessageVersion.findUnique({ where: { id: row.versionId } })
    : null;
  if (!version) {
    await release(row.id, { status: 'failed_final', lastError: 'גרסת התוכן אינה קיימת' });
    return;
  }

  const ctx = await loadTriggerContext({
    dealId: row.dealId, sessionId: row.sessionId, tourEventId: row.tourEventId,
  });

  // 2. Anchor re-check for tour-anchored deliveries — the tour may have moved
  //    or been cancelled while this delivery waited.
  if (message.event.anchorType === 'tour_datetime') {
    if (ctx.tour?.status === 'cancelled' && message.event.triggerType !== 'tour_cancelled') {
      await release(row.id, {
        status: 'cancelled', cancelledAt: new Date(), waitReason: 'הסיור בוטל',
      });
      return;
    }
    const anchor = resolveAnchorMs(message.event, ctx, row.intendedAt.getTime());
    if (anchor == null) {
      const age = now - row.createdAt.getTime();
      if (age > DEPENDENCY_MAX_AGE_MS) {
        await release(row.id, { status: 'failed_final', lastError: 'לא נקבע מועד לסיור בתוך חלון ההמתנה' });
      } else {
        await release(row.id, {
          status: 'waiting_dependency',
          waitReason: 'ממתין לעוגן זמן (לסיור אין עדיין מועד)',
          nextRetryAt: new Date(now + DEPENDENCY_RECHECK_MS),
        });
      }
      return;
    }
    const intended = applyOffset(anchor, message.event);
    if (intended > now + 30_000) {
      // Anchor moved into the future — reschedule, preserving honesty.
      await release(row.id, {
        status: 'scheduled', intendedAt: new Date(intended), effectiveAt: null,
        waitReason: null, nextRetryAt: null,
      });
      return;
    }
  }

  // 3. Sending window — re-evaluated every pass so edits are honored.
  const policy = await loadWindowPolicy(prisma, message);
  const gate = evaluateAt(policy, now);
  if (!gate.allowed) {
    const next = nextAllowedAt(policy, now);
    await release(row.id, {
      status: 'waiting_window',
      waitReason: gate.reason,
      effectiveAt: next != null ? new Date(next) : new Date(now + NO_WINDOW_RECHECK_MS),
      nextRetryAt: null,
      // Window waits don't consume send attempts.
      attemptCount: Math.max(0, row.attemptCount - 1),
    });
    return;
  }

  // 4. Fresh recipient resolution (contact data changes honored at send time).
  //    Documented fallback: when the recipient no longer resolves (e.g. guides
  //    removed the moment a tour was cancelled) but the FROZEN snapshot carries
  //    usable contact data for the channel, the snapshot is used — the message
  //    was addressed to the person as they stood at trigger time.
  const { recipients, error: recipientError } = await resolveRecipients(message, ctx);
  let recipient = recipients.find((r) => r.key === row.recipientKey) || null;
  if (!recipient || recipient.missing) {
    const snap = row.recipientSnapshot || {};
    const snapUsable = message.channel === 'whatsapp'
      ? !!(snap.phone || snap.groupJid)
      : !!snap.email;
    if (!recipient && snapUsable) {
      recipient = {
        key: row.recipientKey,
        name: snap.name || null,
        phone: snap.phone || null,
        email: snap.email || null,
        contactId: snap.contactId || null,
        personRefId: snap.personRefId || null,
        groupChatId: snap.groupChatId || null,
        groupJid: snap.groupJid || null,
        language: row.language || null,
        missing: false,
      };
    } else {
      await release(row.id, {
        status: 'skipped',
        skipReason: recipientError
          || (recipient ? 'לנמען חסרים פרטי התקשרות' : 'הנמען אינו זמין עוד עבור ההגדרה'),
      });
      return;
    }
  }
  const language = row.language || resolveLanguage(message, recipient);
  const snapshot = {
    ...(row.recipientSnapshot || {}),
    name: recipient.name, phone: recipient.phone || null, email: recipient.email || null,
    groupChatId: recipient.groupChatId || null, groupJid: recipient.groupJid || null,
    waAccountId: message.channel === 'whatsapp'
      ? (row.recipientSnapshot?.waAccountId || message.waAccountId)
      : null,
    waDestinationType: message.channel === 'whatsapp'
      ? (row.recipientSnapshot?.waDestinationType || message.waDestinationType || 'private')
      : null,
  };

  // 5. Render — frozen version content, live values. Missing values wait
  //    (bounded), never substitute silently.
  const rendered = await renderMessage({ message, versionContent: version.content, language, ctx });
  const missingBits = [
    ...(rendered.missingVariables || []).map((k) => `משתנה חסר: ${k}`),
    ...(rendered.missingDocuments || []).map((d) => d.reason || `מסמך חסר: ${d.kind}`),
    ...(rendered.error === 'no_content' ? ['אין תוכן בשפה המבוקשת'] : []),
    ...(rendered.unknownVariables || []).map((k) => `משתנה לא מוכר: ${k}`),
  ];
  if (missingBits.length) {
    const age = now - row.createdAt.getTime();
    if (age > DEPENDENCY_MAX_AGE_MS) {
      await release(row.id, { status: 'failed_final', lastError: missingBits.join(' · ') });
    } else {
      await release(row.id, {
        status: 'waiting_dependency',
        waitReason: missingBits.join(' · '),
        nextRetryAt: new Date(now + DEPENDENCY_RECHECK_MS),
        attemptCount: Math.max(0, row.attemptCount - 1),
      });
    }
    return;
  }

  // 6. Send via the channel adapter (frozen sender, no fallback).
  try {
    const send = message.channel === 'whatsapp' ? sendWhatsAppDelivery : sendEmailDelivery;
    const result = await send({ delivery: row, rendered, snapshot });

    await release(row.id, {
      status: 'sent',
      sentAt: new Date(),
      effectiveAt: new Date(),
      providerMessageId: result.providerMessageId || null,
      lastError: null,
      waitReason: row.waitReason, // preserve WHY it waited — part of the audit
      recipientSnapshot: snapshot,
      renderedContent: {
        language: rendered.language,
        subject: rendered.subject || null,
        body: rendered.body,
        attachments: (rendered.attachments || []).map((a) => ({
          kind: a.kind, filename: a.filename || null, documentId: a.documentId || null,
        })),
        links: (rendered.links || []).map((l) => ({ kind: l.kind, url: l.url, documentId: l.documentId || null })),
      },
    });

    // 7. Timeline — linked to the business entity, rendered by the feed.
    const subjectId = row.dealId || null;
    if (subjectId) {
      await emitTimelineEvent(prisma, {
        subjectType: 'deal',
        subjectId,
        kind: 'communication',
        body: null,
        data: {
          event: 'communication_sent',
          deliveryId: row.id,
          messageNumber: row.messageNumber,
          channel: message.channel,
          language: rendered.language,
          recipientName: snapshot.name || null,
          eventName: message.event.internalName,
          messageName: message.internalName || null,
          subject: rendered.subject || null,
        },
        origin: systemOrigin(),
      }).catch(() => {});
    }
    log.info(`[communication] sent #${row.messageNumber} delivery=${row.id} channel=${message.channel}`);
  } catch (err) {
    const c = classify(err);
    if (c.kind === 'retryable_connection') {
      await release(row.id, {
        status: row.status === 'waiting_window' ? 'waiting_window' : 'scheduled',
        lastError: c.code,
        attemptCount: Math.max(0, row.attemptCount - 1), // not this delivery's fault
        nextRetryAt: new Date(Date.now() + CONNECTION_DEFER_MS),
      });
      log.warn(`[communication] deferred delivery=${row.id} (${c.code})`);
    } else if (c.kind === 'dependency') {
      await release(row.id, {
        status: 'waiting_dependency',
        waitReason: 'המסמך המצורף אינו זמין עדיין',
        nextRetryAt: new Date(Date.now() + DEPENDENCY_RECHECK_MS),
        attemptCount: Math.max(0, row.attemptCount - 1),
      });
    } else {
      const isTerminal = c.kind === 'terminal' || row.attemptCount >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.min(Math.max(row.attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
      await release(row.id, {
        status: isTerminal ? 'failed_final' : 'failed',
        lastError: c.code,
        nextRetryAt: isTerminal ? null : new Date(Date.now() + delay),
      });
      log.warn(`[communication] ${isTerminal ? 'FAILED' : 'retry scheduled'} delivery=${row.id} (${c.code})`);
    }
  }
}

async function tick(log) {
  const now = new Date();
  const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS);

  // 0. Recovery sweep — expired 'sending' claims. attemptCount decremented so
  //    the re-claim regenerates the SAME per-part idempotency keys and the
  //    bridge replays instead of resending.
  const stuck = await prisma.communicationDelivery.findMany({
    where: { status: 'sending', OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
    select: { id: true, attemptCount: true },
  });
  for (const r of stuck) {
    log.warn(`[communication] recovering stuck 'sending' delivery ${r.id}`);
    await prisma.communicationDelivery.update({
      where: { id: r.id },
      data: {
        status: 'scheduled', claimedAt: null, claimedBy: null,
        attemptCount: Math.max(0, r.attemptCount - 1),
      },
    });
  }

  // 1. Due candidates across the waiting states.
  const candidates = await prisma.communicationDelivery.findMany({
    where: {
      OR: [
        { status: 'scheduled', intendedAt: { lte: now }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        { status: 'waiting_window', effectiveAt: { lte: now } },
        { status: 'waiting_dependency', nextRetryAt: { lte: now } },
        { status: 'failed', nextRetryAt: { lte: now } },
      ],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] }],
    },
    orderBy: { intendedAt: 'asc' },
    take: TICK_BATCH,
    select: { id: true, status: true },
  });

  for (let i = 0; i < candidates.length; i++) {
    const { id, status } = candidates[i];
    const claimed = await prisma.communicationDelivery.updateMany({
      where: { id, status, OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
      data: {
        status: 'sending', claimedAt: now, claimedBy: WORKER_ID,
        attemptCount: { increment: 1 }, lastAttemptAt: now,
      },
    });
    if (claimed.count === 0) continue;

    const row = await prisma.communicationDelivery.findUnique({ where: { id } });
    if (!row || row.claimedBy !== WORKER_ID || row.status !== 'sending') continue;

    try {
      await processDelivery({ ...row, status }, log);
    } catch (err) {
      log.error(`[communication] delivery ${id} crashed: ${err?.message || err}`);
      await release(id, {
        status: 'failed',
        lastError: String(err?.message || err).slice(0, 300),
        nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MS[0]),
      }).catch(() => {});
    }
    if (i < candidates.length - 1) await sleep(SEND_PACING_MS);
  }
}

export function startCommunicationWorker(log = console) {
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick(log);
    } catch (err) {
      log.error(`[communication] tick crashed: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info('[communication] delivery worker started (60s tick)');
  return timer;
}
