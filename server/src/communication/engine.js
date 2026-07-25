// The Communication Center delivery engine — trigger intake.
//
// Business sites call `fireCommunicationTrigger(payload)` AFTER their owning
// transaction commits (fire-and-forget: never blocks or fails the business
// operation). The engine then:
//   match active events → evaluate applicability → resolve recipients →
//   compute intendedAt → create one CommunicationDelivery per (message ×
//   recipient), freezing the published version + sender/recipient audit
//   snapshot. The claim-based worker (deliveryWorker.js) does everything
//   time-sensitive: windows, dependency waits, rendering, sending, retries.
//
// Idempotency: the (messageId, triggerKey, recipientKey) unique — replayed
// triggers (double WON, webhook replays, worker restarts) hit P2002 and are
// dropped. triggerKey defaults to `<type>:<entity id>`; sites that may
// legitimately fire repeatedly for the same entity (payment_received) pass an
// explicit triggerRef (e.g. the iCount docnum).
//
// Inapplicable events create NO delivery rows (a busy system would flood the
// log with skip rows for every unrelated event); missing recipients DO create
// a 'skipped' row — that's a per-message configuration signal the operator
// must see.

import { prisma } from '../db.js';
import { loadTriggerContext, applyTriggerOverrides } from './context.js';
import { evaluateApplicability } from './conditions.js';
import { computeIntendedAt } from './timing.js';
import { resolveRecipients, resolveLanguage } from './recipients.js';

const DEPENDENCY_RECHECK_MS = 10 * 60_000;

export async function processTrigger({ type, dealId = null, sessionId = null, tourEventId = null, triggerRef = null, at = null, data = null }, log = console) {
  const events = await prisma.communicationEvent.findMany({
    where: { triggerType: type, status: 'active' },
    include: {
      messages: {
        where: { status: 'active', publishedVersionId: { not: null } },
      },
    },
  });
  if (!events.length) return { created: 0 };

  const ctx = applyTriggerOverrides(await loadTriggerContext({ dealId, sessionId, tourEventId }), data);
  const triggerAtMs = at ? new Date(at).getTime() : Date.now();
  const triggerKey = `${type}:${triggerRef || dealId || sessionId || tourEventId}`;
  let created = 0;

  for (const event of events) {
    const { applicable } = evaluateApplicability(event, ctx);
    if (!applicable) continue;

    const intendedMs = computeIntendedAt(event, ctx, triggerAtMs);

    for (const message of event.messages) {
      const { recipients, error } = await resolveRecipients(message, ctx);

      const base = {
        eventId: event.id,
        messageId: message.id,
        messageNumber: message.publicNumber,
        versionId: message.publishedVersionId,
        channel: message.channel,
        triggerKey,
        triggerData: data ?? undefined,
        dealId: dealId || ctx.reservation?.groups?.find((g) => g.createdDealId)?.createdDealId || null,
        tourEventId: tourEventId || ctx.tour?.id || null,
        sessionId: sessionId || ctx.reservation?.id || null,
      };

      if (!recipients.length) {
        // Visible configuration/data signal — one skip row per trigger.
        await createDelivery({
          ...base,
          recipientKey: 'none',
          language: message.fallbackLanguage || 'he',
          intendedAt: new Date(intendedMs ?? triggerAtMs),
          status: 'skipped',
          skipReason: error || 'לא נמצא נמען עבור ההגדרה',
          recipientSnapshot: { audienceType: message.audienceType, error: error || 'missing_recipient' },
        }, log);
        continue;
      }

      for (const recipient of recipients) {
        if (recipient.missing) {
          await createDelivery({
            ...base,
            recipientKey: recipient.key,
            contactId: recipient.contactId || null,
            language: resolveLanguage(message, recipient),
            intendedAt: new Date(intendedMs ?? triggerAtMs),
            status: 'skipped',
            skipReason: message.channel === 'whatsapp' ? 'לנמען אין מספר טלפון' : 'לנמען אין כתובת אימייל',
            recipientSnapshot: snapshotFor(message, recipient),
          }, log);
          continue;
        }
        const row = await createDelivery({
          ...base,
          recipientKey: recipient.key,
          contactId: recipient.contactId || null,
          language: resolveLanguage(message, recipient),
          // Anchor unavailable (e.g. tour_datetime with no scheduled tour):
          // waiting_dependency — the worker re-resolves periodically.
          intendedAt: intendedMs != null ? new Date(intendedMs) : new Date(triggerAtMs),
          status: intendedMs != null ? 'scheduled' : 'waiting_dependency',
          waitReason: intendedMs != null ? null : 'ממתין לעוגן זמן (לסיור אין עדיין מועד)',
          nextRetryAt: intendedMs != null ? null : new Date(Date.now() + DEPENDENCY_RECHECK_MS),
          recipientSnapshot: snapshotFor(message, recipient),
        }, log);
        if (row) created++;
      }
    }
  }
  return { created };
}

function snapshotFor(message, recipient) {
  return {
    audienceType: message.audienceType,
    name: recipient.name || null,
    phone: recipient.phone || null,
    email: recipient.email || null,
    contactId: recipient.contactId || null,
    personRefId: recipient.personRefId || null,
    waAccountId: message.channel === 'whatsapp' ? message.waAccountId || null : null,
    waDestinationType: message.channel === 'whatsapp' ? message.waDestinationType || 'private' : null,
    groupChatId: recipient.groupChatId || null,
    groupJid: recipient.groupJid || null,
    windowEnabled: !!message.windowEnabled,
    sendingWindowId: message.sendingWindowId || null,
  };
}

async function createDelivery(data, log) {
  try {
    return await prisma.communicationDelivery.create({ data });
  } catch (err) {
    if (err?.code === 'P2002') return null; // idempotency — already created
    log.error(`[communication] delivery create failed: ${err?.message || err}`);
    return null;
  }
}

// Fire-and-forget wrapper for business sites: post-commit, async, isolated.
// A trigger failure can NEVER fail or slow the business operation.
export function fireCommunicationTrigger(payload, log = console) {
  setImmediate(() => {
    processTrigger(payload, log).catch((err) => {
      log.error(`[communication] trigger ${payload?.type} failed: ${err?.message || err}`);
    });
  });
}
