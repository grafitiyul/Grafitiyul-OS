// THE server-side reader for canonical email delivery state.
//
// Every surface that wants to know "did this email actually go out?" calls in
// here — the confirmation send archive, the deal timeline, the בקרה detectors,
// the review cards, the send endpoints. The vocabulary and the derivation live
// in shared/emailDelivery.mjs so the client renders the same answer.
//
// Nothing else may read ScheduledEmail.status directly to make a
// sent/not-sent decision. That divergence is what produced #27099/#27100.

import { prisma as defaultPrisma } from '../db.js';
import { deliveryFromScheduledEmail } from '../../../shared/emailDelivery.mjs';

/** The lean select every delivery read uses. Never pulls bodyHtml. */
export const DELIVERY_SELECT = {
  id: true,
  status: true,
  sentAt: true,
  failureReason: true,
  attemptCount: true,
  waitReason: true,
  effectiveAt: true,
  nextRetryAt: true,
  connectionDeferredCount: true,
  claimedAt: true,
  gmailMessageId: true,
};

/** One queue row → canonical delivery, or null when there is no row. */
export async function resolveDelivery(scheduledEmailId, { db = defaultPrisma } = {}) {
  if (!scheduledEmailId) return null;
  const row = await db.scheduledEmail.findUnique({
    where: { id: String(scheduledEmailId) },
    select: DELIVERY_SELECT,
  });
  return deliveryFromScheduledEmail(row);
}

/**
 * Batch form for feeds — one query for a page of timeline rows.
 * → Map<scheduledEmailId, delivery>
 */
export async function resolveDeliveries(scheduledEmailIds, { db = defaultPrisma } = {}) {
  const ids = [...new Set((scheduledEmailIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await db.scheduledEmail.findMany({
    where: { id: { in: ids } },
    select: DELIVERY_SELECT,
  });
  return new Map(rows.map((r) => [r.id, deliveryFromScheduledEmail(r)]));
}

/**
 * Enrich a page of TimelineEntry rows in place (returns new objects).
 * Any entry whose data carries a `scheduledEmailId` — or a confirmation
 * `sendId` we can resolve — gets `data.delivery`, so the feed row can render
 * the TRUE state instead of the intent frozen at queue time.
 *
 * Confirmation snapshots hold the queue-row id, so one extra query maps
 * sendId → scheduledEmailId for the whole page.
 */
export async function attachDeliveryToTimeline(entries, { db = defaultPrisma } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const sendIds = [];
  const directQueueIds = [];
  for (const e of list) {
    const d = e?.data;
    if (!d) continue;
    if (d.scheduledEmailId) directQueueIds.push(d.scheduledEmailId);
    else if (d.sendId && d.channel === 'email') sendIds.push(d.sendId);
  }
  if (!sendIds.length && !directQueueIds.length) return list;

  // sendId → scheduledEmailId (the confirmation snapshot holds the loose ref).
  const snapshots = sendIds.length
    ? await db.confirmationEmailSend.findMany({
      where: { id: { in: [...new Set(sendIds)] } },
      select: { id: true, scheduledEmailId: true },
    })
    : [];
  const queueIdBySendId = new Map(snapshots.map((s) => [s.id, s.scheduledEmailId]));

  const deliveries = await resolveDeliveries(
    [...directQueueIds, ...snapshots.map((s) => s.scheduledEmailId)],
    { db },
  );

  return list.map((e) => {
    const d = e?.data;
    if (!d) return e;
    const queueId = d.scheduledEmailId || (d.sendId ? queueIdBySendId.get(d.sendId) : null);
    const delivery = queueId ? deliveries.get(queueId) : null;
    if (!delivery) return e;
    return { ...e, data: { ...d, delivery } };
  });
}
